import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openAntigravityWorkbench } from '../../src/agent/engines/antigravityWorkbench.js';
import { openGrokWorkbench } from '../../src/agent/engines/grokWorkbench.js';
import { openCodexWorkbench } from '../../src/agent/engines/codexWorkbench.js';
import { callRestrictedGrok } from '../../src/agent/engines/grokRestricted.js';
import { workbenchTimeline } from '../../src/shared/domain/agentWorkbench/events.js';

test('all workbench transports forward thoughts and preserve normal replies across repeated turns', { timeout: 30000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-reasoning-fixture-'));
  const previousGrokHome = process.env.GROK_HOME;
  let engine;
  t.after(async () => {
    await engine?.close();
    if (previousGrokHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previousGrokHome;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('wiki-reasoning-fixture-'));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  for (const name of ['antigravity', 'grok', 'codex']) await t.test(name, async () => {
    const cwd = path.join(root, name); await mkdir(cwd);
    const fixtureName = name === 'codex' ? 'codex-workbench' : `${name}-acp`;
    let source = await readFile(new URL(`../fixtures/${fixtureName}.txt`, import.meta.url), 'utf8');
    if (name === 'codex') {
      const needle = "  const text = p.input[0].text;";
      assert.ok(source.includes(needle));
      source = source.replace(needle, `${needle}
        if (p.summary !== 'auto') throw new Error('Summary was not requested');
        if (text === 'THINK') {
          notify('item/started', { item: { id: 'thought', type: 'reasoning', summary: [], content: [] } });
          notify('item/reasoning/summaryTextDelta', { itemId: 'thought', summaryIndex: 0, delta: 'Check ' });
          notify('item/reasoning/summaryTextDelta', { itemId: 'thought', summaryIndex: 0, delta: 'events' });
          notify('item/reasoning/summaryPartAdded', { itemId: 'thought', summaryIndex: 1 });
          notify('item/reasoning/textDelta', { itemId: 'thought', contentIndex: 0, delta: 'Provider content' });
          notify('item/reasoning/summaryTextDelta', { threadId: 'other', itemId: 'thought', summaryIndex: 0, delta: 'WRONG_THREAD' });
          notify('item/reasoning/textDelta', { turnId: 'old-turn', itemId: 'thought', contentIndex: 0, delta: 'WRONG_TURN' });
          notify('item/completed', { item: { id: 'thought', type: 'reasoning', summary: ['Check events', 'Snapshot only'], content: ['Provider content'] } });
          notify('item/agentMessage/delta', { itemId: 'answer', delta: 'Normal reply' });
          notify('turn/completed', { turn: { id: turn, status: 'completed' } }); return;
        }`);
    } else {
      const needle = name === 'grok' ? "  let answer='fixture Grok reply';" : "  let answer = 'fixture reply';";
      assert.ok(source.includes(needle));
      source = source.replace(needle, `${needle}
        if (text === 'THINK') {
          update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Check ' } });
          update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'events' } });
          send({ method: 'session/update', params: { sessionId: 'other', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'WRONG_SESSION' } } } });
        }`);
    }
    const executable = path.join(cwd, 'fixture.mjs'); await writeFile(executable, source);
    const events = [];
    const options = { cwd, neutralCwd: cwd, signal: AbortSignal.timeout(20000), onExit() {}, onRequest() { return false; }, onEvent(type, data) { events.push({ type, data, seq: events.length + 1, turnId: 'test' }); } };
    if (name === 'antigravity') {
      await writeFile(path.join(cwd, '.authenticated'), 'yes');
      engine = await openAntigravityWorkbench({ executable, model: 'fixture-model', effort: 'medium' }, options);
    } else if (name === 'grok') {
      process.env.GROK_HOME = path.join(cwd, 'home');
      await mkdir(path.join(process.env.GROK_HOME, 'sessions'), { recursive: true });
      engine = await openGrokWorkbench({ executable, model: 'grok-4.7', effort: 'low' }, options);
    } else engine = await openCodexWorkbench({ codexCli: { executable, codexHome: cwd, model: 'fixture-model' } }, options);
    for (let i = 0; i < 2; i++) {
      events.length = 0;
      assert.equal((await engine.prompt('THINK')).stopReason, 'end_turn');
      const thoughts = workbenchTimeline(events, { id: 'test', state: 'completed' }).filter(group => group.items[0].type === 'reasoning.delta');
      assert.deepEqual(thoughts.map(group => group.items[0].data.text), name === 'codex' ? ['Check events', 'Provider content', 'Snapshot only'] : ['Check events']);
      assert.ok(events.some(event => event.type === 'message.delta'));
      assert.ok(!JSON.stringify(events).includes('WRONG_'));
    }
    await engine.close(); engine = null;
    if (name === 'grok') {
      const progress = [];
      const result = await callRestrictedGrok({ settings: { executable, model: 'grok-4.7', effort: 'low' } }, { prompt: 'THINK', images: [], workspace: cwd, signal: AbortSignal.timeout(10000), onRequest() {}, onProgress(value) { progress.push(value); } });
      assert.ok(result.text); assert.ok(!result.text.includes('Check events'));
      assert.ok(progress.some(value => value.metadata?.progress?.phase === 'thinking'));
    }
  });
});
