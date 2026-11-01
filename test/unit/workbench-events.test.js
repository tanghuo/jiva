import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workbenchTimeline } from '../../src/shared/domain/agentWorkbench/events.js';
import { createAcpWorkbenchEvents } from '../../src/agent/engines/acpWorkbenchEvents.js';
import { createCodexReasoningEvents } from '../../src/agent/engines/codexReasoningEvents.js';

const event = (type, data, seq) => ({ type, data, seq, turnId: 'turn' });
const turn = { id: 'turn', state: 'completed' };

test('partial tool updates merge across messages without losing titles or message boundaries', () => {
  const events = [
    event('tool.updated', { id: 'read', title: 'Read file', status: 'in_progress' }, 1),
    event('message.delta', { text: 'Checking' }, 2),
    event('tool.updated', { id: 'read', title: undefined, status: 'completed' }, 3),
    event('tool.updated', { id: 'read', content: [] }, 3.5),
    event('message.delta', { text: 'Finished' }, 4),
  ];
  const groups = workbenchTimeline(events, turn);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].data.title, 'Read file');
  assert.equal(groups[0].items[0].data.status, 'completed');
  assert.deepEqual(groups.slice(1).map(group => group.items[0].data.text), ['Checking', 'Finished']);
  assert.equal(events[0].data.status, 'in_progress');
  assert.deepEqual(workbenchTimeline(events, turn), groups);
});

test('message identity and phase separate native messages; plan updates keep latest snapshot', () => {
  const groups = workbenchTimeline([
    event('message.delta', { text: 'A', messageId: 'one', phase: 'commentary' }, 1),
    event('message.delta', { text: 'B', messageId: 'one', phase: 'commentary' }, 2),
    event('plan.updated', { entries: [{ content: 'Read', status: 'pending' }] }, 3),
    event('plan.updated', { entries: [{ content: 'Read', status: 'completed' }] }, 4),
    event('message.delta', { text: 'Done', messageId: 'two', phase: 'final_answer' }, 5),
    { ...event('message.delta', { text: 'Other turn' }, 6), turnId: 'other' },
  ], turn);
  assert.equal(groups[0].items[0].data.text, 'AB');
  assert.equal(groups[1].items.length, 1);
  assert.equal(groups[1].items[0].data.entries[0].status, 'completed');
  assert.equal(groups[2].items[0].data.phase, 'final_answer');
});

test('native command output attaches to its tool while legacy output remains readable', () => {
  const groups = workbenchTimeline([
    event('tool.updated', { id: 'cmd', title: 'Test', status: 'running' }, 1),
    event('command.output', { toolCallId: 'cmd', commandId: 'stored', output: 'ok' }, 2),
    event('tool.updated', { id: 'cmd', status: 'completed' }, 3),
    event('command.output', { commandId: 'legacy', output: 'legacy output' }, 4),
  ], turn);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].items[0].output.data.commandId, 'stored');
  assert.equal(groups[0].items[1].data.commandId, 'legacy');
});

test('a nonzero command exit overrides a completed tool status on replay without changing stored events', () => {
  for (const exitCode of [0, 1, 2, null]) {
    const events = [
      event('tool.updated', { id: 'cmd', title: 'Execute rg missing', status: 'completed' }, 1),
      event('command.output', { toolCallId: 'cmd', output: 'result', exitCode }, 2),
    ];
    const item = workbenchTimeline(events, turn)[0].items[0];
    assert.equal(item.data.status, exitCode === 1 || exitCode === 2 ? 'failed' : 'completed');
    assert.equal(events[0].data.status, 'completed');
    assert.equal(workbenchTimeline(events, turn)[0].items.length, 1);
  }
});

test('unfinished tools do not keep spinning or claim success after a turn ends', () => {
  for (const [state, status] of [['running', 'running'], ['cancelled', 'cancelled'], ['failed', 'unknown'], ['completed', 'unknown']]) {
    assert.equal(workbenchTimeline([event('tool.updated', { id: 'tool', status: 'in_progress' }, 1)], { ...turn, state })[0].items[0].data.status, status);
  }
});

test('Grok and Gemini ACP share message segmentation and status normalization without invented phases', async () => {
  const events = [], emit = createAcpWorkbenchEvents((type, data) => events.push({ type, data }));
  const text = text => emit({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
  await text('A'); await text('B');
  await emit({ sessionUpdate: 'tool_call', toolCallId: 'one', title: 'Read', status: 'in_progress' });
  await emit({ sessionUpdate: 'tool_call_update', toolCallId: 'one', status: 'completed' });
  await text('Done');
  assert.equal(events[0].data.messageId, events[1].data.messageId);
  assert.notEqual(events[0].data.messageId, events[4].data.messageId);
  assert.equal(events[2].data.status, 'running');
  assert.equal(events[4].data.phase, undefined);
});

test('ACP calls without a status begin queued and partial updates preserve the known status', async () => {
  const events = [], emit = createAcpWorkbenchEvents((type, data) => events.push(event(type, data, events.length)));
  await emit({ sessionUpdate: 'tool_call', toolCallId: 'one', title: 'Execute git status' });
  await emit({ sessionUpdate: 'tool_call_update', toolCallId: 'one' });
  assert.equal(workbenchTimeline(events, { ...turn, state: 'running' })[0].items[0].data.status, 'queued');
  await emit({ sessionUpdate: 'tool_call_update', toolCallId: 'one', status: 'completed' });
  assert.equal(workbenchTimeline(events, turn)[0].items[0].data.status, 'completed');
});

test('ACP thoughts stay separate from replies and split at tool and plan boundaries', async () => {
  const events = [], emit = createAcpWorkbenchEvents((type, data) => events.push(event(type, data, events.length)));
  const chunk = (sessionUpdate, text) => emit({ sessionUpdate, content: { type: 'text', text } });
  await chunk('agent_message_chunk', 'Progress');
  await chunk('agent_thought_chunk', 'Think '); await chunk('agent_thought_chunk', 'first');
  await chunk('agent_message_chunk', 'Reply');
  await emit({ sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Read', status: 'completed' });
  await chunk('agent_thought_chunk', 'Think second');
  await emit({ sessionUpdate: 'plan', entries: [] });
  await chunk('agent_thought_chunk', 'Think third');
  await chunk('agent_thought_chunk', '');
  const groups = workbenchTimeline(events, turn);
  assert.deepEqual(groups.map(group => group.items[0].type), ['message.delta', 'reasoning.delta', 'message.delta', 'tool.updated', 'reasoning.delta', 'plan.updated', 'reasoning.delta']);
  assert.equal(groups[1].items[0].data.text, 'Think first');
  assert.notEqual(events[0].data.messageId, events[3].data.messageId);
  assert.equal(new Set(events.filter(value => value.type === 'reasoning.delta').map(value => value.data.messageId)).size, 3);
});

test('Codex keeps summary/content sections distinct and reconciles completed snapshots without duplicates', async () => {
  const events = [], emit = createCodexReasoningEvents((type, data) => events.push(event(type, data, events.length)));
  const delta = (method, index, text, itemId = 'thought') => emit(method, { itemId, summaryIndex: index, contentIndex: index, delta: text });
  await delta('item/reasoning/summaryTextDelta', 0, 'First');
  await delta('item/reasoning/summaryTextDelta', 0, ' summary');
  await emit('item/reasoning/summaryPartAdded', { itemId: 'thought', summaryIndex: 1 });
  await delta('item/reasoning/summaryTextDelta', 1, 'Draft');
  await delta('item/reasoning/textDelta', 0, 'Provider content');
  const before = events.length;
  await emit('item/completed', { item: { id: 'thought', type: 'reasoning', summary: ['First summary', 'Final section', 'Snapshot only'], content: ['Provider content'] } });
  assert.equal(events.length, before + 2);
  const untouched = JSON.stringify(events), groups = workbenchTimeline(events, turn);
  assert.deepEqual(groups.map(group => group.items[0].data.text), ['First summary', 'Final section', 'Provider content', 'Snapshot only']);
  assert.equal(groups[0].items[0].data.kind, 'summary');
  assert.equal(groups[2].items[0].data.kind, 'content');
  assert.equal(JSON.stringify(events), untouched);
  assert.deepEqual(workbenchTimeline(events, turn), groups);
  const nextTurn = [];
  await createCodexReasoningEvents((type, data) => nextTurn.push({ type, data }))('item/completed', { item: { id: 'thought', type: 'reasoning', summary: ['First summary'] } });
  assert.equal(nextTurn.length, 1);
});

test('reasoning snapshots preserve replies, tool order and item identity across interleaved updates', () => {
  const events = [
    event('reasoning.delta', { messageId: 'one', text: 'Draft' }, 1),
    event('tool.updated', { id: 'read', title: 'Read', status: 'completed' }, 2),
    event('message.delta', { messageId: 'answer', text: 'Answer' }, 3),
    event('reasoning.updated', { messageId: 'one', text: 'Final thought' }, 4),
    event('reasoning.updated', { messageId: 'two', kind: 'summary', partIndex: 0, text: 'Snapshot only' }, 5),
    event('message.delta', { messageId: 'answer', text: ' continued' }, 6),
    { ...event('reasoning.delta', { messageId: 'one', text: 'Wrong turn' }, 7), turnId: 'other' },
  ];
  const groups = workbenchTimeline(events, turn);
  assert.deepEqual(groups.map(group => group.items[0].data.text || group.items[0].data.title), ['Final thought', 'Read', 'Answer', 'Snapshot only', ' continued']);
  assert.equal(events[0].data.text, 'Draft');
});
