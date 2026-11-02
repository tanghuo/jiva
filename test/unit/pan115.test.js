import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { create115Adapter } from '../../src/server/adapters/pan115.js';

async function setup(t, reply) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pan115-cache-'));
  await mkdir(path.join(dir, '.secrets/115'), { recursive: true });
  await writeFile(path.join(dir, '.secrets/115/123.dpapi'), 'encrypted-test-fixture');
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = 0;
  const calls = [];
  const adapter = create115Adapter({ dataDir: dir, now: () => now, processRunner: async (exe, _args, input) => {
    if (exe === 'powershell.exe') return JSON.stringify({ UID: 'fixture', CID: 'fixture', SEID: 'fixture' });
    const request = JSON.parse(input); calls.push(request.action);
    return JSON.stringify(reply(request));
  } });
  return { adapter, calls, advance(ms) { now += ms; } };
}

test('one account shares a bounded task snapshot; submission invalidates it', async t => {
  const h = await setup(t, ({ action }) => ({ ok: true, data: action === 'tasks' ? [{ info_hash: 'a', status: 0 }] : ['a'] }));
  const first = await h.adapter.call('123', 'tasks'); first[0].status = 2;
  assert.equal((await h.adapter.call('123', 'tasks'))[0].status, 0);
  assert.deepEqual(h.calls, ['tasks']);
  h.advance(30001); await h.adapter.call('123', 'tasks');
  await h.adapter.call('123', 'submit'); await h.adapter.call('123', 'tasks');
  assert.deepEqual(h.calls, ['tasks', 'tasks', 'submit', 'tasks']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.adapter.call('123', 'tasks', {}, { signal: controller.signal }), e => e.name === 'AbortError');
});

test('gateway failures cool down and remain distinguishable from expired login', async t => {
  let code = 'REMOTE_BLOCKED';
  const h = await setup(t, () => ({ ok: false, code }));
  for (let i = 0; i < 3; i++) await assert.rejects(h.adapter.call('123', 'tasks'), e => e.code === 'REMOTE_BLOCKED' && e.statusCode === 409 && /405/.test(e.message));
  assert.equal(h.calls.length, 1);
  h.advance(60001); code = 'AUTH_REQUIRED';
  await assert.rejects(h.adapter.call('123', 'tasks'), e => e.code === 'AUTH_REQUIRED' && /重新扫码登录/.test(e.message));
  assert.equal(h.calls.length, 2);
});
