import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, chromium, fetch } from '../helpers/authenticatedServer.js';
import { stubWorkbenchModels } from '../helpers/workbenchModels.js';
import { resolveBrowserPath } from '../resolveBrowserPath.js';
import { workbenchPdf } from '../helpers/workbenchPdf.js';
const executablePath = resolveBrowserPath();

test('both workbench composers accept dropped and pasted files, preserve text paste, and send original files through native references', { timeout: 40000, skip: !executablePath }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-workbench-attachments-ui-')); let app, browser;
  t.after(async () => { await browser?.close(); await app?.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('wiki-workbench-attachments-ui-')); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const prompts = [], references = [];
  app = await createServer({ port: 0, dataDir: root, agentWorkbenchEnabled: true, async openWorkbenchEngine(_settings, callbacks) {
    return { sessionId: 'files-ui', version: 'fixture', capabilities: { images: false }, async close() {}, cancel() {}, async prompt(text, delivery, _images, files) { prompts.push(text); references.push(files); delivery('attempted'); await callbacks.onEvent('message.delta', { text: '附件已读取' }); return { stopReason: 'end_turn' }; } };
  } });
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(10000); await stubWorkbenchModels(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '#workbench'); await page.getByLabel('任务内容').waitFor();
  const codeName = 'self-wiki-text-card-atmosphere.patch', textName = 'self-wiki-float-bottom.patch';
  const pdfName = '很长的文件名_' + 'attachment-long-filename-'.repeat(5) + '.pdf';
  async function transfer(kind, name, type, bytes) {
    return page.getByLabel('任务内容').evaluate((node, { kind, name, type, bytes }) => {
      const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(bytes)], name, { type }));
      const event = kind === 'paste' ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }) : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
      return node.dispatchEvent(event);
    }, { kind, name, type, bytes: [...bytes] });
  }
  assert.equal(await transfer('drop', codeName, '', Buffer.from('export const dropped = 17;')), false);
  await page.getByRole('button', { name: `移除附件 ${codeName}`, exact: true }).waitFor();
  assert.equal(await transfer('paste', textName, 'text/plain', Buffer.from('pasted text fixture')), false);
  await page.getByRole('button', { name: `移除附件 ${textName}`, exact: true }).waitFor();
  await page.getByLabel('选择附件文件').setInputFiles({ name: pdfName, mimeType: 'application/pdf', buffer: workbenchPdf() });
  await page.getByRole('button', { name: `移除附件 ${pdfName}`, exact: true }).waitFor();
  const nativePaste = await page.getByLabel('任务内容').evaluate(node => { const data = new DataTransfer(); data.setData('text/plain', 'ordinary text'); return node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
  assert.equal(nativePaste, true);
  await page.getByLabel('任务内容').fill('阅读新任务的文件');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.locator('.workbench-event.assistant').waitFor();
  assert.equal(prompts[0], '阅读新任务的文件', await page.locator('.workbench-turn-state').innerText());
  assert.deepEqual(references[0].map(file => file.name), [codeName, textName, pdfName]);
  assert.equal(await readFile(references[0][0].path, 'utf8'), 'export const dropped = 17;');
  assert.deepEqual(await readFile(references[0][2].path), workbenchPdf());
  assert.equal(await page.locator('.workbench-message-references a').count(), 0);
  const cards = page.locator('.workbench-file-reference');
  assert.equal(await cards.count(), 3);
  assert.deepEqual(await cards.locator('.workbench-file-name').allTextContents(), [codeName, textName, pdfName]);
  assert.match(await cards.first().locator('.workbench-file-meta').innerText(), /PATCH · \d+ B/);
  assert.equal(await cards.first().getAttribute('aria-label'), `预览附件 ${codeName}`);
  function checkCards() {
    return cards.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect(), name = node.querySelector('.workbench-file-name');
      return { fits: box.left >= parent.left - 1 && box.right <= parent.right + 1 && name.scrollWidth <= name.clientWidth + 1, bordered: getComputedStyle(node).borderTopStyle === 'solid', icons: node.querySelectorAll('svg').length };
    }));
  }
  for (const card of await checkCards()) { assert.ok(card.fits); assert.ok(card.bordered); assert.equal(card.icons, 1); }
  await cards.first().click();
  const preview = page.getByRole('dialog', { name: '附件预览' });
  await preview.waitFor();
  assert.match(await preview.locator('pre').innerText(), /export const dropped = 17;/);
  const [download] = await Promise.all([page.waitForEvent('download'), preview.getByRole('link', { name: '下载', exact: true }).click()]);
  assert.equal(download.suggestedFilename(), codeName);
  await preview.getByRole('button', { name: '关闭附件预览', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  await cards.nth(2).click();
  await preview.locator('iframe').waitFor();
  assert.match(await preview.locator('iframe').getAttribute('src'), /\/artifacts\/\d+\/content/);
  await preview.getByRole('button', { name: '关闭附件预览', exact: true }).click();
  await preview.waitFor({ state: 'hidden' });
  await mkdir('.local/workbench-ui', { recursive: true });
  await page.screenshot({ path: '.local/workbench-ui/file-reference-cards.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const card of await checkCards()) assert.ok(card.fits, 'file card and name must fit the message on narrow screens');
  const boxes = await cards.evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { top: box.top, bottom: box.bottom }; }));
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].top >= boxes[i - 1].bottom, 'file cards wrap onto separate rows');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.local/workbench-ui/file-reference-cards-narrow.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.getByRole('button', { name: '添加附件', exact: true }).isEnabled(), true);
  assert.equal(await transfer('drop', 'followup.py', '', Buffer.from('print("dropped again")')), false);
  await page.getByRole('button', { name: '移除附件 followup.py', exact: true }).waitFor();
  await page.getByLabel('任务内容').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="任务内容"]').disabled);
  assert.equal(await transfer('paste', 'followup.txt', 'text/plain', Buffer.from('pasted again')), false);
  await page.getByRole('button', { name: '移除附件 followup.txt', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="任务内容"]').disabled);
  await page.getByLabel('选择附件文件').setInputFiles({ name: 'second.pdf', mimeType: 'application/pdf', buffer: workbenchPdf('Second PDF content') });
  await page.getByRole('button', { name: '移除附件 second.pdf', exact: true }).waitFor();
  await page.getByLabel('任务内容').fill('继续阅读'); await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.workbench-event.assistant').length === 2);
  assert.equal(prompts[1], '继续阅读');
  assert.deepEqual(references[1].map(file => file.name), ['followup.py', 'followup.txt', 'second.pdf']);
  assert.deepEqual(await readFile(references[1][2].path), workbenchPdf('Second PDF content'));
  const sessions = await (await fetch(new URL('/api/agent/sessions', app.url))).json();
  const detail = await (await fetch(new URL(`/api/agent/sessions/${sessions.sessions[0].id}`, app.url))).json();
  assert.equal(detail.turns[0].input.artifactIds.length, 3); assert.equal(detail.turns[1].input.artifactIds.length, 3);
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="任务内容"]').disabled);
  await page.getByLabel('选择附件文件').setInputFiles([
    { name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('keep on partial failure') },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image bytes') },
  ]);
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: '移除附件 keep.txt', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '移除附件 keep.txt', exact: true }).waitFor();
  await mkdir('.local/workbench-ui', { recursive: true });
  await page.screenshot({ path: '.local/workbench-ui/file-attachments.png' });
  assert.deepEqual(errors, []);
});
