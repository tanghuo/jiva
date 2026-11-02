import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readGeminiRemoteQuota, googleQuotaRequest } from '../../src/agent/executors/geminiRemoteQuota.js';
import { readGeminiQuota, normalizeGeminiQuota } from '../../src/agent/executors/geminiQuota.js';
import { quotaError } from '../../src/agent/executors/quotaIdentity.js';

const summary = (fraction = 0.4) => ({ groups: [{ displayName: 'Gemini Models', buckets: [
  { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: fraction, resetTime: '2026-11-06T14:42:40Z' },
  { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.8 },
] }] });
const secret = 'PRIVATE_TOKEN_+&%';
const token = { client_id: 'fixture-client', client_secret: secret, refresh_token: secret, project_id: 'fixture-project', token_uri: 'https://untrusted.invalid' };
const context = () => ({ salt: 'fixture-salt', signal: AbortSignal.timeout(5000) });
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wiki-gemini-quota-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('wiki-gemini-quota-'));
    await rm(dir, { recursive: true, force: true });
  });
  const credentialPath = path.join(dir, 'acp_token.json');
  await writeFile(credentialPath, JSON.stringify(token));
  return credentialPath;
}
const responder = (url) => url.includes('oauth2.googleapis.com/token') ? { access_token: secret }
  : url.includes('/userinfo') ? { id: 'fixture-user', email: 'test@example.test' } : summary();

test('ACP credentials read quota headlessly, verify stable identity and never write or expose credentials', async t => {
  const credentialPath = await setup(t), calls = [];
  const before = await readFile(credentialPath, 'utf8');
  const request = async (url, options) => { calls.push({ url, ...options }); return responder(url); };
  let observed;
  const first = await readGeminiRemoteQuota({ ...context(), onIdentity: value => { observed = value; } }, { credentialPath, request });
  const second = await readGeminiRemoteQuota(context(), { credentialPath, request });
  assert.equal(first.identityStatus, 'verified');
  assert.equal(first.accountKey, second.accountKey);
  assert.equal(first.accountKey, observed.accountKey);
  assert.equal(first.accountLabel, 't***@example.test');
  assert.equal(first.buckets[0].remainingPercent, 40);
  assert.equal(first.buckets[0].windowMinutes, 10080);
  assert.equal(first.buckets[1].windowMinutes, 300);
  assert.equal(await readFile(credentialPath, 'utf8'), before);
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.equal(JSON.stringify(first).includes('fixture-user'), false);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(new URLSearchParams(calls[0].body).get('refresh_token'), secret);
  assert.match(calls[2].headers['User-Agent'], /^antigravity\/acp\/1\.4\.5 /);
  assert.deepEqual(JSON.parse(calls[2].body), { project: 'fixture-project' });
  assert.equal(calls[2].headers.Authorization, `Bearer ${secret}`);
});

test('nonempty third-party-only response tries the other Google endpoint and cannot count as Gemini success', async t => {
  const credentialPath = await setup(t), called = [];
  const thirdParty = { groups: [{ displayName: 'Claude and GPT models', buckets: [{ bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 }] }] };
  const request = async url => {
    if (!url.includes('retrieveUserQuotaSummary')) return responder(url);
    called.push(url);
    return url.startsWith('https://daily-') ? thirdParty : summary(0);
  };
  assert.equal((await readGeminiRemoteQuota(context(), { credentialPath, request })).buckets[0].remainingPercent, 0);
  assert.equal(called.length, 2);
  await assert.rejects(readGeminiRemoteQuota(context(), { credentialPath, request: async url =>
    url.includes('retrieveUserQuotaSummary') ? thirdParty : responder(url) }), { code: 'QUOTA_UNAVAILABLE' });
});

test('missing credentials alone allow desktop fallback; auth and missing Gemini quota never substitute a desktop account', async t => {
  const credentialPath = await setup(t);
  await unlink(credentialPath);
  let networkCalls = 0, desktopCalls = 0;
  assert.equal(await readGeminiRemoteQuota(context(), { credentialPath, request: async () => { networkCalls++; } }), null);
  assert.equal(networkCalls, 0);
  const readDesktop = async () => { desktopCalls++; return 'desktop'; };
  assert.equal(await readGeminiQuota({}, context(), { readRemote: async () => null, readDesktop }), 'desktop');
  assert.equal(await readGeminiQuota({}, context(), { readRemote: async () => 'remote', readDesktop }), 'remote');
  for (const code of ['AUTH_REQUIRED', 'QUOTA_UNAVAILABLE', 'READ_FAILED']) {
    await assert.rejects(readGeminiQuota({}, context(), { readRemote: async () => { throw quotaError(code); }, readDesktop }), { code });
  }
  assert.equal(desktopCalls, 1);
});

test('account changes or logout during a request discard the quota result', async t => {
  const credentialPath = await setup(t);
  for (const remove of [false, true]) {
    await writeFile(credentialPath, JSON.stringify(token));
    await assert.rejects(readGeminiRemoteQuota(context(), { credentialPath, request: async url => {
      if (url.includes('retrieveUserQuotaSummary')) {
        if (remove) await unlink(credentialPath);
        else await writeFile(credentialPath, JSON.stringify({ ...token, refresh_token: 'other-account' }));
      }
      return responder(url);
    } }), { code: 'IDENTITY_CHANGED' });
  }
});

test('userinfo failure keeps identity unverified; cancellation stops the fallback pipeline', async t => {
  const credentialPath = await setup(t);
  const request = async url => {
    if (url.includes('/userinfo')) throw quotaError('READ_FAILED');
    return responder(url);
  };
  const first = await readGeminiRemoteQuota(context(), { credentialPath, request });
  const second = await readGeminiRemoteQuota(context(), { credentialPath, request });
  assert.equal(first.identityStatus, 'unverified');
  assert.notEqual(first.accountKey, second.accountKey);
  const controller = new AbortController();
  let summaries = 0;
  await assert.rejects(readGeminiRemoteQuota({ salt: 'fixture', signal: controller.signal }, { credentialPath, request: async url => {
    if (url.includes('retrieveUserQuotaSummary')) { summaries++; controller.abort(); throw quotaError('READ_FAILED'); }
    return responder(url);
  } }), { name: 'AbortError' });
  assert.equal(summaries, 1);
});

test('malformed, oversized and expired credentials fail without making an alternate login request', async t => {
  const credentialPath = await setup(t);
  for (const [text, code] of [['{', 'PROTOCOL_ERROR'], ['x'.repeat(65537), 'PROTOCOL_ERROR'], ['{}', 'AUTH_REQUIRED']]) {
    await writeFile(credentialPath, text);
    await assert.rejects(readGeminiRemoteQuota(context(), { credentialPath, request: async () => assert.fail('no request expected') }), { code });
  }
  await writeFile(credentialPath, JSON.stringify(token));
  let calls = 0;
  await assert.rejects(readGeminiRemoteQuota(context(), { credentialPath, request: async () => { calls++; throw quotaError('AUTH_REQUIRED'); } }), { code: 'AUTH_REQUIRED' });
  assert.equal(calls, 1);
  for (const url of ['http://oauth2.googleapis.com/token', 'https://evil.invalid', 'https://oauth2.googleapis.com:8443/token']) {
    assert.throws(() => googleQuotaRequest(url), { code: 'PROTOCOL_ERROR' });
  }
});

test('empty quota is not success; legacy and incomplete payloads remain partial', () => {
  assert.throws(() => normalizeGeminiQuota({ groups: [] }), { code: 'QUOTA_UNAVAILABLE' });
  assert.throws(() => normalizeGeminiQuota({ groups: [null] }), { code: 'PROTOCOL_ERROR' });
  const legacy = normalizeGeminiQuota({ userStatus: { cascadeModelConfigData: { clientModelConfigs: [{ model: 'gemini', quotaInfo: { remainingFraction: 0.2 } }] } } });
  assert.equal(legacy.completeness, 'partial');
  const unknown = summary(); delete unknown.groups[0].buckets[0].remainingFraction;
  assert.equal(normalizeGeminiQuota(unknown).completeness, 'partial');
});
