import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../../src/server/data/sqlite.js';
import { createAgentWorkbenchRepository } from '../../src/server/data/agentWorkbenchRepository.js';
import { createAgentWorkbenchService } from '../../src/server/application/agentWorkbench/service.js';
import { grokApprovalPolicy } from '../../src/agent/engines/grokWorkbench.js';

async function until(predicate) {
  for (let i = 0; i < 400; i++) { const result = predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Policy condition timed out');
}
async function fixture(t, prompt, { verified = true, liveMode = true, modeError, opening } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-workbench-policy-'));
  const db = initDb(':memory:'), repo = createAgentWorkbenchRepository(db), opened = [];
  await mkdir(path.join(root, 'data'));
  const service = await createAgentWorkbenchService({ repo, dataDir: path.join(root, 'data'), initiallyEnabled: true, codexVerified: true, executionConfig: () => ({}), async openEngine(_settings, callbacks) {
    opened.push(callbacks.approvalMode);
    await opening;
    const capabilities = { verified, approvalMode: callbacks.approvalMode };
    return { ...(callbacks.engine === 'antigravity-acp' && liveMode && { async setApprovalMode(mode) { if (modeError) throw modeError; capabilities.approvalMode = mode; } }), sessionId: 'synthetic', version: 'test', capabilities, cancel() {}, async close() {}, async prompt(text, delivery) { delivery('attempted'); await prompt(callbacks, text); return { stopReason: 'end_turn' }; } };
  } });
  t.after(async () => { await service.close(); db.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('wiki-workbench-policy-')); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const workspace = await service.workspace({ kind: 'scratch', trusted: true });
  return { service, repo, workspace, opened, root };
}
const permission = callbacks => callbacks.onRequest('session/request_permission', {
  toolCall: { toolName: 'write', title: '写入结果', rawInput: { path: 'result.txt' } },
  options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }],
});
const decide = (service, approval, decision = 'allow') => service.decide(approval.id, { decision, revision: approval.policyRevision, operationHash: approval.operationHash });

test('Antigravity auto approves known project reads, audits decisions, and still asks for other commands and manual mode', async t => {
  const decisions = [];
  const f = await fixture(t, async (callbacks, text) => {
    const allowed = await callbacks.onRequest('engine/antigravity_approval', { toolCall: {
      toolCallId: text, kind: 'execute', title: 'Run command',
      rawInput: { CommandLine: text === 'outside' ? 'git status' : text, Cwd: text === 'outside' ? f.root : callbacks.cwd, WaitMsBeforeAsync: 5000 },
    } });
    decisions.push(allowed);
  });
  const session = f.service.createSession({ engine: 'antigravity-acp', model: 'fixture-model', nativeReadAccepted: true, workspaceId: f.workspace.id, approvalMode: 'auto' });
  const first = f.service.submit(session.id, { text: 'git status', requestKey: 'antigravity-safe-command' });
  await until(() => f.repo.turn(first.id).state === 'completed');
  assert.equal(f.service.detail(session.id).approvals.length, 0);
  const automatic = f.repo.events(session.id, 0).filter(event => event.type === 'approval.automatic');
  assert.equal(automatic.length, 1);
  assert.equal(automatic[0].data.reason, 'read_only_command');
  assert.equal(automatic[0].data.mode, 'auto');
  for (const [index, text] of ['git status; echo unsafe', 'outside', 'npm test'].entries()) {
    const turn = f.service.submit(session.id, { text, requestKey: `antigravity-confirm-command-${index}` });
    const approval = await until(() => f.service.detail(session.id).approvals[0]);
    assert.equal(f.repo.turn(turn.id).state, 'awaiting_approval');
    decide(f.service, approval, 'reject');
    await until(() => f.repo.turn(turn.id).state === 'completed');
  }
  await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'ask' });
  const manual = f.service.submit(session.id, { text: 'git status', requestKey: 'antigravity-manual-command' });
  const approval = await until(() => f.service.detail(session.id).approvals[0]);
  const changed = await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'auto' });
  assert.equal(changed.approvalUpdate.status, 'applied');
  assert.equal(f.repo.approval(approval.id).state, 'approved');
  await until(() => f.repo.turn(manual.id).state === 'completed');
  const next = f.service.submit(session.id, { text: 'git status', requestKey: 'antigravity-auto-next-round' });
  await until(() => f.repo.turn(next.id).state === 'completed');
  assert.deepEqual(decisions, [true, false, false, false, true, true]);
});

test('manual approval has no deadline, accepts a late decision, and cancellation revokes waiting writes', async t => {
  let writes = 0;
  const f = await fixture(t, async callbacks => {
    await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, 'result.txt'), content: 'late approval' });
    writes++;
  });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id });
  const turn = f.service.submit(session.id, { text: 'write', requestKey: 'late-approval' });
  const approval = await until(() => f.service.detail(session.id).approvals[0]);
  assert.equal(approval.expiresAt, 0);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  try {
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    assert.equal(f.repo.approval(approval.id).state, 'pending');
    assert.equal(f.repo.turn(turn.id).state, 'awaiting_approval');
    assert.equal(writes, 0);
    decide(f.service, approval);
    assert.equal(f.repo.approval(approval.id).state, 'approved');
  } finally { t.mock.timers.reset(); }
  await until(() => f.repo.turn(turn.id).state === 'completed');
  assert.equal(writes, 1);
  const next = f.service.submit(session.id, { text: 'write again', requestKey: 'cancel-infinite-approval' });
  const pending = await until(() => f.service.detail(session.id).approvals[0]);
  await f.service.cancel(next.id);
  assert.equal(f.repo.turn(next.id).state, 'cancelled');
  assert.equal(writes, 1);
  assert.throws(() => decide(f.service, pending), { statusCode: 409 });
});

test('Grok maps unified modes and keeps restricted sessions out of bypass/auto', () => {
  assert.deepEqual(grokApprovalPolicy('ask'), { mode: 'ask', yoloMode: true, autoMode: false });
  assert.deepEqual(grokApprovalPolicy('auto'), { mode: 'auto', yoloMode: false, autoMode: true });
  assert.deepEqual(grokApprovalPolicy('allow'), { mode: 'allow', yoloMode: true, autoMode: false });
  for (const mode of ['ask', 'auto', 'allow']) assert.deepEqual(grokApprovalPolicy(mode, true), { mode: 'ask', yoloMode: false, autoMode: false });
  assert.throws(() => grokApprovalPolicy('typo'), { code: 'INVALID_POLICY' });
});

test('Grok switching into Auto without a native classifier keeps this round manual and enables Auto next round', async t => {
  const f = await fixture(t, async callbacks => {
    assert.equal((await permission(callbacks)).outcome.optionId, 'yes');
    await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, 'result.txt'), content: 'approved' });
  });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id });
  assert.equal(session.policy.approvalMode, 'ask');
  const turn = f.service.submit(session.id, { text: 'write', requestKey: 'manual-policy-turn' });
  const approval = await until(() => f.service.detail(session.id).approvals[0]);
  assert.equal(approval.operation.kind, 'file.write');
  const live = f.repo.session(session.id);
  const changed = await f.service.policy(session.id, { revision: live.revision, approvalMode: 'auto' });
  assert.equal(changed.policy.approvalMode, 'auto');
  assert.equal(changed.approvalUpdate.status, 'partial');
  assert.equal(changed.approvalUpdate.mode, 'ask');
  assert.equal(changed.policy.write, live.policy.write);
  assert.equal(changed.revision, live.revision);
  assert.equal(f.repo.approval(approval.id).state, 'pending');
  await assert.rejects(f.service.policy(session.id, { revision: live.revision, readRoots: [f.workspace.path] }), { code: 'ACTIVE_TURN' });
  decide(f.service, approval);
  await until(() => f.repo.turn(turn.id).state === 'completed');
  assert.equal(f.repo.events(session.id, 0).filter(event => event.type === 'approval.requested').length, 1);
  const revision = f.repo.session(session.id).revision;
  const updated = await f.service.policy(session.id, { revision, approvalMode: 'auto' });
  assert.equal(updated.policy.approvalMode, 'auto');
  assert.equal(updated.revision, revision + 1);
  await assert.rejects(f.service.policy(session.id, { revision, approvalMode: 'allow' }), { statusCode: 409 });
  await f.service.resume(session.id);
  assert.deepEqual(f.opened, ['ask', 'auto']);
  const legacy = f.repo.updatePolicy(session.id, f.repo.session(session.id).revision, { write: 'allow_workspace', readRoots: [] });
  const manual = await f.service.policy(session.id, { revision: legacy.revision, approvalMode: 'ask' });
  assert.equal(manual.policy.write, 'ask');
});

for (const mode of ['auto', 'allow']) test(`${mode} mode executes approved host operations without another prompt and preserves path boundaries`, async t => {
  const f = await fixture(t, async callbacks => {
    await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, 'result.txt'), content: mode });
    await assert.rejects(callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, '.grok', 'config.toml'), content: 'bad' }), { code: 'PROTECTED_PATH' });
    await assert.rejects(callbacks.onRequest('fs/write_text_file', { path: path.join(f.root, 'outside.txt'), content: 'bad' }), { code: 'PATH_DENIED' });
    await assert.rejects(callbacks.onRequest('terminal/create', { command: process.execPath, args: ['-e', ''], cwd: f.root }), { code: 'PATH_DENIED' });
    const terminal = await callbacks.onRequest('terminal/create', { command: process.execPath, args: ['-e', "process.stdout.write('policy-ok')"], cwd: callbacks.cwd });
    await callbacks.onRequest('terminal/wait_for_exit', { terminalId: terminal.terminalId });
  });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id, approvalMode: mode });
  const turn = f.service.submit(session.id, { text: 'execute', requestKey: `${mode}-policy-turn` });
  await until(() => ['completed', 'failed', 'unknown'].includes(f.repo.turn(turn.id).state));
  assert.equal(f.repo.turn(turn.id).state, 'completed', JSON.stringify(f.repo.turn(turn.id).data));
  assert.equal(await readFile(path.join(f.workspace.path, 'result.txt'), 'utf8'), mode);
  const events = f.repo.events(session.id, 0);
  assert.equal(events.filter(event => event.type === 'approval.requested').length, 0);
  assert.deepEqual(events.filter(event => event.type === 'approval.automatic').map(event => event.data.operation.kind), ['file.write', 'command']);
});

test('Auto asks once when Grok requests a decision; rejection prevents execution and acceptance needs no second approval', async t => {
  let writes = 0;
  const f = await fixture(t, async callbacks => {
    if ((await permission(callbacks)).outcome.optionId !== 'yes') return;
    await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, 'result.txt'), content: 'accepted' }); writes++;
  });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id, approvalMode: 'auto' });
  for (const decision of ['reject', 'allow']) {
    const turn = f.service.submit(session.id, { text: decision, requestKey: `auto-${decision}-turn` });
    const approval = await until(() => f.service.detail(session.id).approvals[0]);
    assert.equal(approval.operation.kind, 'engine.permission');
    decide(f.service, approval, decision);
    await until(() => f.repo.turn(turn.id).state === 'completed');
    assert.equal(writes, decision === 'allow' ? 1 : 0);
  }
  assert.equal(f.repo.events(session.id, 0).filter(event => event.type === 'approval.requested').length, 2);
});

test('Codex releases pending and subsequent native approvals immediately, with explicit native policy limits', async t => {
  const f = await fixture(t, async callbacks => {
    for (let i = 0; i < 2; i++) assert.equal(await callbacks.onRequest('engine/native_approval', { kind: 'native.command', cwd: callbacks.cwd, command: 'git status' }), true);
  });
  const session = f.service.createSession({ engine: 'codex-cli', workspaceId: f.workspace.id, nativeReadAccepted: true, model: 'test' });
  const turn = f.service.submit(session.id, { text: 'first', requestKey: 'codex-mode-first' });
  const approval = await until(() => f.service.detail(session.id).approvals[0]);
  const changed = await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'allow' });
  assert.equal(changed.approvalUpdate.status, 'partial');
  assert.equal(changed.approvalUpdate.mode, 'allow');
  assert.equal(f.repo.approval(approval.id).state, 'approved');
  await until(() => f.repo.turn(turn.id).state === 'completed');
  assert.deepEqual(f.opened, ['ask']);
  assert.equal(f.repo.events(session.id, 0).filter(event => event.type === 'approval.requested').length, 1);
  const next = f.service.submit(session.id, { text: 'second', requestKey: 'codex-mode-second' });
  await until(() => f.repo.turn(next.id).state === 'completed');
  assert.deepEqual(f.opened, ['ask', 'allow']);
});

test('unverified engines cannot enable automatic execution; unknown modes and unsupported engines fail explicitly', async t => {
  let dispatched = false;
  const f = await fixture(t, async () => { dispatched = true; }, { verified: false });
  assert.throws(() => f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id, approvalMode: 'typo' }), { code: 'INVALID_POLICY' });
  const codex = f.service.createSession({ engine: 'codex-cli', workspaceId: f.workspace.id, approvalMode: 'auto', nativeReadAccepted: true, model: 'test' });
  assert.equal(codex.policy.approvalMode, 'auto');
  await assert.rejects(f.service.policy(codex.id, { revision: codex.revision, readRoots: [f.workspace.path] }), { code: 'NATIVE_POLICY' });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id, approvalMode: 'auto' });
  const turn = f.service.submit(session.id, { text: 'do not dispatch', requestKey: 'unverified-policy-turn' });
  await until(() => f.repo.turn(turn.id).state === 'failed');
  assert.equal(f.repo.turn(turn.id).data.code, 'UNSUPPORTED_POLICY');
  assert.equal(f.repo.turn(turn.id).delivery, 'not_sent');
  assert.equal(dispatched, false);
  const restricted = f.repo.createSession({ workspaceId: f.workspace.id, engine: 'grok-build', purpose: 'workflow', policy: { write: 'ask', readRoots: [] }, data: {} });
  await assert.rejects(f.service.policy(restricted.id, { revision: restricted.revision, approvalMode: 'allow' }), { code: 'TOOL_DENIED' });
});

test('Grok switches Ask/Allow in both directions without replaying the prompt', async t => {
  const firstWrite = Promise.withResolvers(), nextWrite = Promise.withResolvers();
  const f = await fixture(t, async callbacks => {
    for (const [index, gate] of [null, nextWrite.promise].entries()) {
      if (gate) await gate;
      assert.equal((await permission(callbacks)).outcome.optionId, 'yes');
      await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, `result-${index}.txt`), content: 'ok' });
      if (!index) firstWrite.resolve();
    }
  });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id });
  const turn = f.service.submit(session.id, { text: 'two writes', requestKey: 'grok-live-modes' });
  const pending = await until(() => f.service.detail(session.id).approvals[0]);
  const change = mode => f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: mode });
  assert.equal((await change('allow')).approvalUpdate.status, 'applied');
  await firstWrite.promise;
  assert.equal(f.repo.approval(pending.id).state, 'approved');
  assert.equal((await change('ask')).approvalUpdate.mode, 'ask');
  nextWrite.resolve();
  const second = await until(() => f.service.detail(session.id).approvals[0]);
  assert.equal(second.operation.kind, 'file.write');
  await assert.rejects(readFile(path.join(f.workspace.path, 'result-1.txt')), { code: 'ENOENT' });
  // Two simultaneous updates are serialized; the last requested mode wins.
  await Promise.all([change('allow'), change('ask')]);
  await until(() => f.repo.turn(turn.id).state === 'completed');
  assert.equal(f.repo.session(session.id).policy.approvalMode, 'ask');
  assert.deepEqual(f.opened, ['ask']);
  assert.equal(await readFile(path.join(f.workspace.path, 'result-1.txt'), 'utf8'), 'ok');
});

test('Grok switching out of native Auto uses the current host policy for permission callbacks and writes', async t => {
  const proceed = Promise.withResolvers();
  const f = await fixture(t, async callbacks => {
    await proceed.promise;
    assert.equal((await permission(callbacks)).outcome.optionId, 'yes');
    await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, 'result.txt'), content: 'ask' });
  });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id, approvalMode: 'auto' });
  const turn = f.service.submit(session.id, { text: 'wait', requestKey: 'auto-to-ask' });
  await until(() => f.repo.session(session.id).engineSessionId);
  await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'ask' });
  proceed.resolve();
  const pending = await until(() => f.service.detail(session.id).approvals[0]);
  assert.equal(pending.operation.kind, 'file.write');
  decide(f.service, pending);
  await until(() => f.repo.turn(turn.id).state === 'completed');
});

test('a mode selected while the engine is opening is reconciled before dispatch', async t => {
  const opening = Promise.withResolvers();
  const f = await fixture(t, async callbacks => {
    await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, 'result.txt'), content: 'ok' });
  }, { opening: opening.promise });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id });
  const turn = f.service.submit(session.id, { text: 'write', requestKey: 'opening-mode-change' });
  await until(() => f.opened.length);
  assert.equal((await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'allow' })).approvalUpdate.status, 'pending');
  opening.resolve();
  await until(() => f.repo.turn(turn.id).state === 'completed');
  assert.equal(f.service.detail(session.id).approvals.length, 0);
  assert.deepEqual(f.opened, ['ask']);
});

test('unsupported Antigravity live changes stay pending with an explicit next-round status', async t => {
  const f = await fixture(t, async callbacks => callbacks.onRequest('engine/antigravity_approval', { toolCall: { toolCallId: 'command', kind: 'execute' } }), { modeError: Object.assign(new Error('Unsupported method'), { code: 'ACP_ERROR', rpcCode: -32601 }) });
  const session = f.service.createSession({ engine: 'antigravity-acp', workspaceId: f.workspace.id, nativeReadAccepted: true, model: 'fixture-model' });
  const turn = f.service.submit(session.id, { text: 'command', requestKey: 'unsupported-live' });
  const pending = await until(() => f.service.detail(session.id).approvals[0]);
  const changed = await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'allow' });
  assert.equal(changed.approvalUpdate.status, 'deferred');
  assert.equal(f.repo.approval(pending.id).state, 'pending');
  await f.service.cancel(turn.id);
  assert.notEqual(f.repo.approval(pending.id).state, 'approved');
  assert.equal(f.service.detail(session.id).approvals.length, 0);
});

test('switching native Grok Auto to Ask moves a waiting permission decision to the mandatory write gateway', async t => {
  const f = await fixture(t, async callbacks => {
    if ((await permission(callbacks)).outcome.optionId !== 'yes') return;
    await callbacks.onRequest('fs/write_text_file', { path: path.join(callbacks.cwd, 'result.txt'), content: 'ok' });
  });
  const session = f.service.createSession({ engine: 'grok-build', workspaceId: f.workspace.id, approvalMode: 'auto' });
  const turn = f.service.submit(session.id, { text: 'write', requestKey: 'waiting-auto-to-ask' });
  const first = await until(() => f.service.detail(session.id).approvals[0]);
  assert.equal(first.operation.kind, 'engine.permission');
  await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'ask' });
  const actualWrite = await until(() => f.service.detail(session.id).approvals.find(item => item.operation.kind === 'file.write'));
  assert.equal(f.repo.approval(first.id).state, 'approved');
  await assert.rejects(readFile(path.join(f.workspace.path, 'result.txt')), { code: 'ENOENT' });
  decide(f.service, actualWrite, 'reject');
  await until(() => ['failed', 'unknown'].includes(f.repo.turn(turn.id).state));
  await assert.rejects(readFile(path.join(f.workspace.path, 'result.txt')), { code: 'ENOENT' });
});

test('Codex cannot claim stricter native permissions applied when the turn started in Allow', async t => {
  const proceed = Promise.withResolvers();
  const f = await fixture(t, async () => { await proceed.promise; });
  const session = f.service.createSession({ engine: 'codex-cli', workspaceId: f.workspace.id, nativeReadAccepted: true, model: 'test', approvalMode: 'allow' });
  const turn = f.service.submit(session.id, { text: 'wait', requestKey: 'codex-tighten-live' });
  await until(() => f.repo.session(session.id).engineSessionId);
  const changed = await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'ask' });
  assert.equal(changed.approvalUpdate.status, 'deferred');
  assert.equal(changed.approvalUpdate.mode, 'allow');
  assert.equal(changed.policy.approvalMode, 'ask');
  proceed.resolve();
  await until(() => f.repo.turn(turn.id).state === 'completed');
});

test('ambiguous Antigravity mode failure stops the turn and revokes its pending operation', async t => {
  let executed = false;
  const f = await fixture(t, async callbacks => {
    executed = await callbacks.onRequest('engine/antigravity_approval', { toolCall: { toolCallId: 'write', kind: 'edit' } });
  }, { modeError: new Error('Mode confirmation mismatch') });
  const session = f.service.createSession({ engine: 'antigravity-acp', workspaceId: f.workspace.id, nativeReadAccepted: true, model: 'fixture-model' });
  const turn = f.service.submit(session.id, { text: 'write', requestKey: 'ambiguous-live-change' });
  const pending = await until(() => f.service.detail(session.id).approvals[0]);
  await assert.rejects(f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'allow' }), /confirmation mismatch/);
  await until(() => f.repo.turn(turn.id).state === 'cancelled');
  assert.equal(executed, false);
  assert.notEqual(f.repo.approval(pending.id).state, 'approved');
});
