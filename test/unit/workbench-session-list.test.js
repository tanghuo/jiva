import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySessionNotice, applySessionNotices } from '../../src/renderer/src/features/agentWorkbench/sessionList.js';

const session = (id, patch = {}) => ({ id, revision: 1, state: 'running', seq: 1, purpose: 'interactive', workspaceId: 4, data: { title: '任务' }, ...patch });

test('a finish notice clears the sidebar state of a session that is not open', () => {
  const merged = applySessionNotice([session(7)], { id: 7, state: 'ready', revision: 2, seq: 4 });
  assert.equal(merged[0].state, 'ready');
  assert.equal(merged[0].revision, 2);
  assert.equal(merged[0].data.title, '任务');
});

test('an older notice does not rewind a session the open view already refreshed', () => {
  const current = [session(7, { revision: 5, state: 'ready', seq: 8 })];
  assert.equal(applySessionNotice(current, { id: 7, state: 'running', revision: 4, seq: 3 }), current);
});

test('the same notice does not replace the list', () => {
  const current = [session(7, { state: 'ready', revision: 2, seq: 4 })];
  assert.equal(applySessionNotice(current, { id: 7, state: 'ready', revision: 2, seq: 4 }), current);
});

test('a notice that arrived before the session list is kept when the list lands', () => {
  const notices = new Map([[7, { id: 7, state: 'ready', revision: 3, seq: 6 }]]);
  const merged = applySessionNotices([session(7, { revision: 2, state: 'running', seq: 2 })], notices);
  assert.equal(merged[0].state, 'ready');
  assert.equal(merged[0].revision, 3);
});
