import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, chromium } from '../helpers/authenticatedServer.js';
import { resolveBrowserPath } from '../resolveBrowserPath.js';
import { stubWorkbenchModels } from '../helpers/workbenchModels.js';
import { createAcpWorkbenchEvents } from '../../src/agent/engines/acpWorkbenchEvents.js';
import { createCodexReasoningEvents } from '../../src/agent/engines/codexReasoningEvents.js';

const executablePath = resolveBrowserPath();
for (const provider of ['codex', 'grok', 'gemini']) {
  test(`${provider} keeps alternating thoughts and tools compact without hiding failures or replies`, { timeout: 30000, skip: !executablePath }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-process-ui-'));
    const finish = Promise.withResolvers();
    let app, browser;
    t.after(async () => {
      finish.resolve(); await browser?.close(); await app?.close();
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert.ok(path.basename(root).startsWith('wiki-process-ui-'));
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    });
    app = await createServer({ port: 0, dataDir: root, agentWorkbenchEnabled: true, async openWorkbenchEngine(_settings, callbacks) {
      return { sessionId: provider, version: 'test', capabilities: {}, cancel() {}, async close() {}, async prompt(_text, delivery) {
        delivery('attempted');
        const acp = createAcpWorkbenchEvents(callbacks.onEvent);
        const codex = createCodexReasoningEvents(callbacks.onEvent);
        for (let i = 0; i < 8; i++) {
          if (provider === 'codex') {
            await codex('item/reasoning/summaryTextDelta', { itemId: `thought-${i}`, summaryIndex: 0, delta: `检查步骤 ${i}` });
            await callbacks.onEvent('tool.updated', { id: `tool-${i}`, kind: 'commandExecution', title: `检查 ${i}`, status: i === 2 ? 'failed' : 'completed' });
          } else {
            await acp({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `检查步骤 ${i}` } });
            await acp({ sessionUpdate: 'tool_call', toolCallId: `tool-${i}`, title: `检查 ${i}`, kind: 'execute', status: i === 2 ? 'failed' : 'completed', ...(i === 2 && { content: [{ type: 'content', content: { type: 'text', text: '错误：搜索工具不可用' } }] }) });
          }
        }
        await finish.promise;
        await callbacks.onEvent('message.delta', { messageId: 'answer', phase: 'final_answer', text: '处理完成。' });
        return { stopReason: 'end_turn' };
      } };
    } });
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(8000);
    await stubWorkbenchModels(page);
    await page.goto(app.url + '#workbench');
    await page.getByLabel('任务内容').fill('检查过程展示');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.locator('.workbench-process-details > summary').filter({ hasText: '8 次操作' }).waitFor();
    assert.equal(await page.locator('.workbench-process-details').count(), 1);
    assert.equal(await page.locator('.workbench-reasoning').first().isVisible(), false);
    const warning = page.locator('.workbench-process-section > .workbench-execution-warning');
    assert.match(await warning.innerText(), /1 项操作失败，任务仍在进行/);
    if (provider !== 'codex') assert.match(await warning.innerText(), /错误：搜索工具不可用/);
    await mkdir('.local/workbench-ui', { recursive: true });
    await page.screenshot({ path: `.local/workbench-ui/process-${provider}.png` });
    await warning.getByRole('button', { name: '查看失败记录' }).click();
    assert.equal(await page.locator('.workbench-reasoning').count(), 8);
    assert.equal(await page.locator('.workbench-process-details').evaluate(element => element.open), true);
    await page.locator('.workbench-process-details > summary').click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    finish.resolve();
    await page.getByText('处理完成。', { exact: true }).waitFor();
    assert.match(await page.locator('.workbench-process-toggle').innerText(), /过程含 1 项失败/);
    await page.reload();
    await page.getByText('处理完成。', { exact: true }).waitFor();
    assert.match(await page.locator('.workbench-process-toggle').innerText(), /过程含 1 项失败/);
  });
}
