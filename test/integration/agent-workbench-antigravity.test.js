import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openAntigravityWorkbench, describeAntigravityWorkbench, antigravityModels } from '../../src/agent/engines/antigravityWorkbench.js';
import { collectTurnChanges } from '../../src/server/application/agentWorkbench/changes.js';
import { initDb } from '../../src/server/data/sqlite.js';
import { createAgentWorkbenchRepository } from '../../src/server/data/agentWorkbenchRepository.js';
import { createAgentWorkbenchService } from '../../src/server/application/agentWorkbench/service.js';

async function fixture(t, authenticated = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-antigravity-fixture-'));
  const executable = path.join(root, 'antigravity.mjs'), clients = [];
  await writeFile(executable, await readFile(new URL('../fixtures/antigravity-acp.txt', import.meta.url)));
  if (authenticated) await writeFile(path.join(root, '.authenticated'), 'yes');
  t.after(async () => {
    for (const client of clients) await client.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('wiki-antigravity-fixture-'));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const settings = { executable, model: 'fixture-model', effort: 'medium' }, events = [], requests = [];
  const callbacks = { cwd: root, neutralCwd: root, signal: AbortSignal.timeout(10000), onExit() {}, onEvent(type, data) { events.push({ type, data }); }, onRequest(method, value) { requests.push({ method, value }); return false; } };
  return { root, settings, callbacks, events, requests, async open(extra = {}, options = {}) { const client = await openAntigravityWorkbench({ ...settings, ...extra }, { ...callbacks, ...options }); clients.push(client); return client; } };
}

test('Antigravity enumerates models from flat/grouped config and preserves the selected model', () => {
  assert.deepEqual(antigravityModels({ configOptions: [{ id: 'model', currentValue: 'b', options: [{ group: 'group', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }] }] }), { models: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], defaultModel: 'b' });
  assert.throws(() => antigravityModels({}), /未返回可用模型/);
});
test('Antigravity reuses authentication, verifies manual mode and model/effort, streams images and restores without replay', async t => {
  const f = await fixture(t);
  assert.equal((await describeAntigravityWorkbench(f.settings, f.callbacks)).defaultModel, 'fixture-model');
  const client = await f.open();
  assert.equal(client.capabilities.approvalMode, 'ask'); assert.equal(client.capabilities.effort, 'medium'); assert.equal(client.capabilities.applicationTools, false);
  const attachment = { path: path.join(f.root, '报告.pdf'), name: '报告.pdf', mimeType: 'application/pdf', size: 12 };
  assert.equal((await client.prompt('REMEMBER bamboo42', () => {}, [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }], [attachment])).stopReason, 'end_turn');
  const prompt = JSON.parse(await readFile(path.join(f.root, 'last-prompt.json'), 'utf8'));
  assert.equal(prompt.prompt[1].type, 'image');
  assert.equal(prompt.prompt[2].type, 'resource_link');
  assert.equal(prompt.prompt[2].name, '报告.pdf');
  assert.equal(prompt.prompt[2].mimeType, 'application/pdf');
  assert.match(prompt.prompt[2].uri, /^file:\/\//);
  await client.close();
  const restored = await f.open({}, { sessionId: client.sessionId });
  await restored.prompt('RECALL');
  assert.equal(f.events.filter(event => event.type === 'message.delta').map(event => event.data.text).join(''), 'rememberedbamboo42');
  await assert.rejects(f.open({}, { sessionId: 'missing' }), /session\/load 请求失败/);
  await assert.rejects(f.open({ model: 'unavailable' }), /不在当前账号/);
  await assert.rejects(f.open({ effort: 'xhigh' }), /不支持此推理强度/);
  await assert.rejects(f.open({}, { tools: [{ name: 'wiki_search' }] }), /不支持受限/);
  await assert.rejects(f.open({}, { restricted: true }), /不支持受限/);
  await assert.rejects(f.open({}, { approvalMode: 'invalid' }), /无效/);
});
test('Antigravity authentication is explicit and model detection never silently logs in', async t => {
  const f = await fixture(t, false);
  await assert.rejects(describeAntigravityWorkbench(f.settings, f.callbacks), { code: 'AUTH_REQUIRED' });
  await assert.rejects(readFile(path.join(f.root, '.authenticated')), { code: 'ENOENT' });
  const connected = await describeAntigravityWorkbench(f.settings, { ...f.callbacks, authenticate: true });
  assert.equal(connected.models[0].id, 'fixture-model');
  const client = await f.open(); await client.prompt('hello');
});

test('Antigravity model detection recovers from one process exit without logging in', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.startup-failure'), 'network-once');
  assert.equal((await describeAntigravityWorkbench(f.settings, f.callbacks)).defaultModel, 'fixture-model');
  assert.equal(await readFile(path.join(f.root, '.startup-attempts'), 'utf8'), '2');
});

test('Antigravity startup failure is bounded, diagnosed and never exposes raw stderr', async t => {
  for (const [mode, attempts, code, reason] of [
    ['network', '2', 'ACP_PROCESS_EXIT', /网络连接失败/],
    ['auth', '1', 'AUTH_REQUIRED', /授权已失效/],
    ['unknown', '2', 'ACP_PROCESS_EXIT', /未识别的进程错误/],
  ]) await t.test(mode, async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.root, '.startup-failure'), mode);
    await assert.rejects(describeAntigravityWorkbench(f.settings, f.callbacks), error => {
      assert.equal(error.code, code);
      assert.match(error.message, reason);
      assert.match(error.message, /initialize.*17/);
      assert.ok(!error.message.includes('private-account-secret'));
      return true;
    });
    assert.equal(await readFile(path.join(f.root, '.startup-attempts'), 'utf8'), attempts);
  });
});

test('Antigravity successful silent refresh is not treated as a startup failure', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.startup-failure'), 'refresh-ok');
  assert.equal((await describeAntigravityWorkbench(f.settings, f.callbacks)).defaultModel, 'fixture-model');
  assert.equal(await readFile(path.join(f.root, '.startup-attempts'), 'utf8'), '1');
});

test('Antigravity account connection and cancellation never restart a failed process', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.startup-failure'), 'network');
  await assert.rejects(describeAntigravityWorkbench(f.settings, { ...f.callbacks, authenticate: true }), { code: 'ACP_PROCESS_EXIT' });
  assert.equal(await readFile(path.join(f.root, '.startup-attempts'), 'utf8'), '1');
  const controller = new AbortController();
  const pending = describeAntigravityWorkbench(f.settings, { ...f.callbacks, signal: controller.signal });
  // Abort during the recovery delay, after observing the failed attempt.
  for (;;) {
    if (await readFile(path.join(f.root, '.startup-attempts'), 'utf8') === '2') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  controller.abort();
  await assert.rejects(pending);
  assert.equal(await readFile(path.join(f.root, '.startup-attempts'), 'utf8'), '2');
});

test('Antigravity uses native auto-edit and yolo modes and reapplies policy on restore', async t => {
  const f = await fixture(t);
  const automatic = await f.open({}, { approvalMode: 'auto' });
  assert.equal(automatic.capabilities.approvalMode, 'auto');
  await automatic.prompt('WRITE');
  assert.equal(await readFile(path.join(f.root, 'result.txt'), 'utf8'), 'approved\n');
  assert.equal(f.requests.length, 0);
  await automatic.prompt('EXECUTE');
  assert.equal(f.requests.length, 1, 'commands still require a decision in auto-edit mode');
  await automatic.close();
  const allowed = await f.open({}, { approvalMode: 'allow', sessionId: automatic.sessionId });
  assert.equal(allowed.capabilities.approvalMode, 'allow');
  await allowed.prompt('EXECUTE');
  assert.equal(f.requests.length, 1, 'yolo delegates execution to the provider');
  await allowed.close();
  const manual = await f.open({}, { approvalMode: 'ask', sessionId: automatic.sessionId });
  await manual.prompt('WRITE');
  assert.equal(f.requests.length, 2, 'restoring with manual mode must reset the native yolo policy');
});

test('Antigravity refuses to send when the server does not confirm the selected mode', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.ignore-mode'), 'yes');
  await assert.rejects(f.open({}, { approvalMode: 'auto' }), /未确认/);
  await assert.rejects(readFile(path.join(f.root, 'last-prompt.json')), { code: 'ENOENT' });
});

test('Antigravity confirms live mode changes while a permission request is waiting, then uses the new native mode', async t => {
  const f = await fixture(t);
  const waiting = Promise.withResolvers(), decision = Promise.withResolvers();
  const client = await f.open({}, { onRequest() { waiting.resolve(); return decision.promise; } });
  const prompt = client.prompt('WRITE');
  await waiting.promise;
  await writeFile(path.join(f.root, '.reject-live-mode'), 'yes');
  await assert.rejects(client.setApprovalMode('allow'), { code: 'ACP_ERROR', rpcCode: -32601 });
  assert.equal(client.capabilities.approvalMode, 'ask');
  await rm(path.join(f.root, '.reject-live-mode'));
  await client.setApprovalMode('allow');
  assert.equal(client.capabilities.approvalMode, 'allow');
  decision.resolve(true);
  await prompt;
  await client.prompt('EXECUTE');
  assert.equal(await readFile(path.join(f.root, 'result.txt'), 'utf8'), 'approved\n');
  await client.setApprovalMode('ask');
  assert.equal(client.capabilities.approvalMode, 'ask');
  // A provider ignoring a live request must never be advertised as changed.
  await writeFile(path.join(f.root, '.ignore-mode'), 'yes');
  await assert.rejects(client.setApprovalMode('auto'), /未确认本轮审批模式/);
  assert.equal(client.capabilities.approvalMode, 'ask');
});
test('Antigravity native approvals accept/reject once, never grant always, and expose provider diffs without undo', async t => {
  const f = await fixture(t);
  const denied = await f.open(); await denied.prompt('WRITE');
  await assert.rejects(readFile(path.join(f.root, 'result.txt')), { code: 'ENOENT' });
  assert.equal(f.requests[0].method, 'engine/antigravity_approval');
  await denied.close();
  const allowed = await f.open({}, { onRequest() { return true; } });
  await allowed.prompt('ALWAYS');
  await assert.rejects(readFile(path.join(f.root, 'result.txt')), { code: 'ENOENT' });
  await allowed.prompt('WRITE');
  assert.equal(await readFile(path.join(f.root, 'result.txt'), 'utf8'), 'approved\n');
  const changes = collectTurnChanges(f.events, { path: f.root });
  assert.equal(changes.files.length, 1); assert.equal(changes.files[0].source, 'antigravity');
  assert.equal(changes.files[0].canUndo, false); assert.equal(changes.files[0].added, 1);
});
test('Antigravity cancels hanging prompts and refuses abnormal stop/model policy changes', async t => {
  const f = await fixture(t);
  const client = await f.open();
  let delivered;
  const dispatched = new Promise(resolve => { delivered = resolve; });
  const hanging = client.prompt('HANG', delivered);
  await dispatched; await new Promise(resolve => setTimeout(resolve, 20)); client.cancel();
  assert.equal((await hanging).stopReason, 'cancelled');
  await assert.rejects(client.prompt('UNKNOWN_STOP'), /未正常结束/);
  await assert.rejects(client.prompt('BAD_MODE'), /切换了模型或审批模式/);
});
test('Antigravity process death rejects its prompt rather than leaving approvals running', async t => {
  const f = await fixture(t), client = await f.open();
  await assert.rejects(client.prompt('DISCONNECT'), /进程已退出/);
});

test('Antigravity excludes unlimited human approval waiting from its prompt timeout', async t => {
  const f = await fixture(t);
  const client = await f.open({}, { onRequest() { t.mock.timers.tick(24 * 60 * 60 * 1000); return true; } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try { assert.equal((await client.prompt('WRITE')).stopReason, 'end_turn'); }
  finally { t.mock.timers.reset(); }
  assert.equal(await readFile(path.join(f.root, 'result.txt'), 'utf8'), 'approved\n');
});

test('workbench exposes Antigravity, requires native trust, disables application tools and routes unlimited native approval', async t => {
  const f = await fixture(t), db = initDb(':memory:'), repo = createAgentWorkbenchRepository(db);
  let engineOptions;
  const service = await createAgentWorkbenchService({ repo, dataDir: f.root, initiallyEnabled: true, executionConfig: () => ({ chat: { grokBuild: { model: 'grok-model', effort: 'xhigh' } } }), applicationToolsVerified: true,
    tools: { catalog: [{ name: 'wiki_search' }], forTurn() {}, proposals() { return []; }, draft() { return {}; } },
    describeAntigravity(settings, options) { return describeAntigravityWorkbench(f.settings, { ...options, cwd: f.root }); },
    async openEngine(settings, options) { engineOptions = options; return f.open(settings, { ...options, cwd: f.root, neutralCwd: f.root }); },
  });
  t.after(async () => { await service.close(); db.close(); });
  assert.ok(service.status().engines.some(engine => engine.id === 'antigravity-acp'));
  assert.equal((await service.models('antigravity-acp')).models[0].id, 'fixture-model');
  const workspace = await service.workspace({ kind: 'scratch', trusted: true });
  const input = { workspaceId: workspace.id, engine: 'antigravity-acp', model: 'fixture-model', nativeReadAccepted: true };
  assert.throws(() => service.createSession({ ...input, nativeReadAccepted: false }), { code: 'NATIVE_READ_CONFIRMATION' });
  assert.throws(() => service.createSession({ ...input, model: '' }), { code: 'MODEL_REQUIRED' });
  assert.throws(() => service.createSession({ ...input, model: 123 }), { code: 'MODEL_REQUIRED' });
  const automatic = service.createSession({ ...input, approvalMode: 'auto' });
  assert.equal(automatic.policy.approvalMode, 'auto');
  const updated = await service.policy(automatic.id, { revision: automatic.revision, approvalMode: 'allow' });
  assert.equal(updated.policy.approvalMode, 'allow');
  await assert.rejects(service.policy(automatic.id, { revision: updated.revision, readRoots: [] }), { code: 'NATIVE_POLICY' });
  const session = service.createSession(input);
  assert.equal(session.data.effort, 'medium');
  assert.equal(session.data.applicationTools, false);
  const turn = service.submit(session.id, { text: 'WRITE', requestKey: 'antigravity-write-1' });
  const until = async fn => { for (let i = 0; i < 400; i++) { const result = fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('timeout'); };
  const approval = await until(() => service.detail(session.id).approvals[0]);
  assert.equal(approval.operation.provider, 'Antigravity'); assert.equal(approval.expiresAt, 0); assert.deepEqual(engineOptions.tools, []);
  await service.policy(session.id, { revision: repo.session(session.id).revision, approvalMode: 'allow' });
  assert.equal(engineOptions.approvalMode, 'ask', 'changing policy leaves the active turn manual');
  service.decide(approval.id, { decision: 'allow', revision: approval.policyRevision, operationHash: approval.operationHash });
  await until(() => repo.turn(turn.id).state === 'completed');
  const automaticTurn = service.submit(session.id, { text: 'EXECUTE', requestKey: 'antigravity-allow' });
  await until(() => repo.turn(automaticTurn.id).state === 'completed');
  assert.equal(engineOptions.approvalMode, 'allow');
  assert.equal(service.detail(session.id).approvals.length, 0);
  await service.policy(session.id, { revision: repo.session(session.id).revision, approvalMode: 'ask' });
  const second = service.submit(session.id, { text: 'WRITE', requestKey: 'antigravity-write-2' });
  const pending = await until(() => service.detail(session.id).approvals[0]);
  await service.cancel(second.id);
  assert.equal(repo.turn(second.id).state, 'cancelled');
  assert.throws(() => service.decide(pending.id, { decision: 'allow', revision: pending.policyRevision, operationHash: pending.operationHash }), { statusCode: 409 });
});

test('repeated account connection shares one attempt and shutdown aborts it', async t => {
  const f = await fixture(t), db = initDb(':memory:'), repo = createAgentWorkbenchRepository(db);
  let attempts = 0;
  const service = await createAgentWorkbenchService({ repo, dataDir: f.root, initiallyEnabled: true, executionConfig: () => ({}),
    async describeAntigravity(_settings, { signal, authenticate }) {
      assert.equal(authenticate, true); attempts++;
      await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('connection aborted')), { once: true }); });
    },
  });
  t.after(async () => { await service.close(); db.close(); });
  const first = service.connectAntigravity(), second = service.connectAntigravity();
  const firstFailure = assert.rejects(first, /connection aborted/), secondFailure = assert.rejects(second, /connection aborted/);
  assert.equal(attempts, 1);
  await service.close(); await Promise.all([firstFailure, secondFailure]);
});
