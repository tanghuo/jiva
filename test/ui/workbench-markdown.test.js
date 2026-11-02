import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, chromium } from '../helpers/authenticatedServer.js';
import { resolveBrowserPath } from '../resolveBrowserPath.js';
import { stubWorkbenchModels } from '../helpers/workbenchModels.js';

const executablePath = resolveBrowserPath();
const markdown = [
  '# 格式兼容示例',
  '## 表格与列表',
  '| 来源 | 谁在用 | 桌面端 | 备注 | 状态 |',
  '| :--- | :---: | ---: | --- | --- |',
  '| `language_server` | CodexBar | 需要 | 第一行<br>第二行 | **可用** |',
  '| OAuth | 多账号工具 | 不需要 | 转义竖线 a\\|b | ~~旧方案~~ |',
  '',
  '- [x] 已完成',
  '- [ ] 未完成',
  '  - 嵌套项目',
  '',
  '3. 有序列表',
  '4. 第二项',
  '',
  '> 引用包含 **加粗**、*斜体* 和 `行内代码`。',
  '',
  '### 链接、脚注与图片',
  '自动链接 https://example.com 和 [普通链接](https://example.org)。脚注[^note]。',
  '',
  '[^note]: 脚注内容。',
  '',
  '![示例图片](https://markdown.example/image.svg)',
  '',
  '<details><summary>展开说明</summary><p>快捷键 <kbd>Ctrl</kbd>，H<sub>2</sub>O 与 x<sup>2</sup>。</p></details>',
  '',
  '<a id="local-anchor"></a>[本条消息的锚点](#local-anchor)',
  '',
  '#### 四级标题',
  '##### 五级标题',
  '###### 六级标题',
  '',
  '---',
  '',
  '公式 $E=mc^2$，转义金额 \\$5 与 \\$10。',
  '',
  '$$',
  '\\frac{a}{b} + \\sqrt{x}',
  '$$',
  '',
  '```js',
  'const value = "hello";',
  `const longLine = "${'x'.repeat(240)}";`,
  '```',
  '',
  '```unknown-language',
  '<script>this is code, not HTML</script>',
  '```',
  '',
  '<script>window.markdownInjected = true</script>',
  '<img src="https://markdown.example/image.svg" onerror="window.markdownInjected=true" style="position:fixed">',
  '<a href="javascript:alert(1)">危险链接</a>',
  '<iframe src="https://example.com"></iframe>',
].join('\n');

test('workbench renders rich Markdown, isolates anchors, sanitizes HTML and contains wide blocks while streaming and after reload', { timeout: 45000, skip: !executablePath }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-workbench-markdown-'));
  const finish = Promise.withResolvers();
  let app, browser;
  t.after(async () => {
    finish.resolve();
    await browser?.close(); await app?.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('wiki-workbench-markdown-'));
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  app = await createServer({ port: 0, dataDir: root, agentWorkbenchEnabled: true, async openWorkbenchEngine(_settings, callbacks) {
    return { sessionId: 'markdown', version: 'test', capabilities: {}, cancel() {}, async close() {}, async prompt(_text, delivery) {
      delivery('attempted');
      await callbacks.onEvent('reasoning.delta', { messageId: 'thought', text: markdown });
      await callbacks.onEvent('message.delta', { messageId: 'answer', text: '| 来源 | 谁在用 |\n| --- | --- |\n| CLI | 工具 |\n\n```js\nconst partial = 1;' });
      await finish.promise;
      await callbacks.onEvent('message.delta', { messageId: 'answer', text: '\n```\n\n' + markdown });
      return { stopReason: 'end_turn' };
    } };
  } });
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://markdown.example/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="100"><rect width="1200" height="100" fill="#ddd"/></svg>' }));
  await stubWorkbenchModels(page);
  await page.goto(app.url + '#workbench');
  await page.getByLabel('任务内容').fill('检查 Markdown 格式兼容');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const answer = page.locator('.workbench-event.assistant .workbench-markdown');
  await answer.locator('table').waitFor();
  await answer.locator('pre code .hljs-keyword').waitFor();
  assert.match(await answer.locator('pre code').innerText(), /const partial = 1;/);
  assert.equal(await page.locator('.workbench-reasoning table').count(), 1);
  finish.resolve();
  await page.locator('.workbench-turn-state[data-state="completed"]').waitFor({ state: 'attached' });
  await answer.locator('h1').waitFor();
  assert.equal(await answer.locator('table').count(), 2);
  assert.equal(await answer.locator('table').last().locator('tbody tr').count(), 2);
  assert.equal(await answer.locator('td br').count(), 1);
  assert.equal(await answer.locator('table').last().locator('tbody tr').first().locator('td').nth(2).evaluate(el => getComputedStyle(el).textAlign), 'right');
  assert.match(await answer.locator('table').last().innerText(), /a\|b/);
  assert.equal(await answer.locator('input[type="checkbox"][disabled]').count(), 2);
  assert.equal(await answer.locator('input:checked').count(), 1);
  assert.equal(await answer.locator('ul ul li').innerText(), '嵌套项目');
  assert.equal(await answer.locator('ol[start="3"]').count(), 1);
  assert.equal(await answer.locator('del').innerText(), '旧方案');
  assert.equal(await answer.locator('blockquote strong').innerText(), '加粗');
  assert.equal(await answer.locator('h4, h5, h6, hr').count(), 4);
  assert.equal(await answer.locator('a[href="https://example.com"]').getAttribute('target'), '_blank');
  assert.equal(await answer.locator('a[href="https://example.org"]').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await answer.locator('.katex').count(), 2);
  assert.equal(await answer.locator('.katex-display').count(), 1);
  assert.match(await answer.innerText(), /\$5 与 \$10/);
  assert.equal(await answer.locator('code.language-unknown-language').innerText(), '<script>this is code, not HTML</script>\n');
  await answer.locator('summary').click();
  assert.equal(await answer.locator('kbd').isVisible(), true);
  assert.equal(await answer.locator('sub, sup').filter({ hasText: '2' }).count(), 2);
  const footnote = answer.locator('a[data-footnote-ref]');
  const href = await footnote.getAttribute('href');
  assert.equal(await footnote.getAttribute('target'), null);
  assert.equal(await page.locator(`[id="${href.slice(1)}"]`).count(), 1, 'each message has unique footnote anchors');
  const route = page.url();
  await footnote.click();
  assert.equal(page.url(), route, 'footnotes do not replace the workbench hash route');
  assert.equal(await page.evaluate(() => document.activeElement.id), href.slice(1));
  await answer.locator('a[data-footnote-backref]').click();
  assert.equal(page.url(), route);
  const local = answer.getByRole('link', { name: '本条消息的锚点' });
  assert.equal(await page.locator(`[id="${(await local.getAttribute('href')).slice(1)}"]`).count(), 1);
  await local.click();
  assert.equal(page.url(), route);
  assert.equal(await answer.locator('script, iframe, [onerror], img[style], a[href^="javascript:"]').count(), 0);
  assert.equal(await page.evaluate(() => window.markdownInjected), undefined);
  await mkdir('.local/workbench-ui', { recursive: true });
  await answer.locator('h1').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/workbench-ui/markdown-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await answer.locator('.workbench-markdown-table').last().evaluate(el => el.scrollWidth > el.clientWidth), true);
  const codeBlock = answer.locator('pre').filter({ hasText: 'longLine' });
  assert.equal(await codeBlock.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).whiteSpace === 'pre'), true);
  assert.equal(await answer.locator('img[alt="示例图片"]').evaluate(el => el.getBoundingClientRect().width <= el.parentElement.getBoundingClientRect().width), true);
  await answer.locator('table').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.local/workbench-ui/markdown-mobile.png' });
  await page.reload();
  await answer.locator('h1').waitFor();
  assert.equal(await answer.locator('table').count(), 2);
  assert.equal(await answer.locator('.katex').count(), 2);
  assert.deepEqual(errors, []);
});
