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
async function fixture(t, prompt, { verified = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-workbench-policy-'));
  const db = initDb(':memory:'), repo = createAgentWorkbenchRepository(db), opened = [];
  await mkdir(path.join(root, 'data'));
  const service = await createAgentWorkbenchService({ repo, dataDir: path.join(root, 'data'), initiallyEnabled: true, codexVerified: true, executionConfig: () => ({}), async openEngine(_settings, callbacks) {
    opened.push(callbacks.approvalMode);
    return { sessionId: 'synthetic', version: 'test', capabilities: { verified, approvalMode: callbacks.approvalMode }, cancel() {}, async close() {}, async prompt(text, delivery) { delivery('attempted'); await prompt(callbacks, text); return { stopReason: 'end_turn' }; } };
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
  // Changing the picker while waiting must not approve this round retroactively.
  await f.service.policy(session.id, { revision: f.repo.session(session.id).revision, approvalMode: 'auto' });
  assert.equal(f.repo.turn(manual.id).state, 'awaiting_approval');
  decide(f.service, approval);
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

test('manual mode defers Grok permission and asks only for the actual write; approval mode changes during a turn and applies next turn', async t => {
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

test('Codex approval mode can change during a turn and the next turn receives it', async t => {
  const f = await fixture(t, async () => {});
  const session = f.service.createSession({ engine: 'codex-cli', workspaceId: f.workspace.id, nativeReadAccepted: true, model: 'test' });
  assert.equal(session.policy.approvalMode, 'ask');
  const turn = f.service.submit(session.id, { text: 'first', requestKey: 'codex-mode-first' });
  await until(() => f.repo.turn(turn.id).state === 'running' || f.repo.turn(turn.id).state === 'completed');
  const live = f.repo.session(session.id);
  const changed = await f.service.policy(session.id, { revision: live.revision, approvalMode: 'allow' });
  assert.equal(changed.policy.approvalMode, 'allow');
  await until(() => f.repo.turn(turn.id).state === 'completed');
  assert.deepEqual(f.opened, ['ask']);
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
