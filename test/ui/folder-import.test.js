import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, createServer, fetch } from '../helpers/authenticatedServer.js';
import { resolveBrowserPath } from '../resolveBrowserPath.js';
import sharp from 'sharp';

const executablePath = resolveBrowserPath();
test('album import closes confirmation, keeps running across navigation and spaces, and resumes after failure', { timeout: 60000, skip: !executablePath }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wiki-album-background-'));
  const app = await createServer({ port: 0, dataDir });
  let browser, releaseUpload;
  const blocked = new Promise(resolve => { releaseUpload = resolve; });
  t.after(async () => { releaseUpload(); await browser?.close(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const spaces = await (await fetch(`${app.url}api/spaces`)).json();
  const sourceSpace = spaces.spaces[0];
  const createdSpace = await fetch(`${app.url}api/spaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '另一个空间', color: '#5F7A6A' }) });
  assert.equal(createdSpace.status, 201);
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => { window.wikiDesktop = { readClipboardFolders: async () => window.folderResult }; });
  let uploads = 0;
  const imageRequests = [];
  await page.route('**/api/images?*', async route => {
    imageRequests.push(route.request());
    uploads++;
    if (uploads === 1) await blocked;
    if (uploads === 2) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '模拟磁盘繁忙' }) });
    await route.continue();
  });
  await page.goto(`${app.url}#wiki`);
  await page.locator('.space-switcher-trigger').filter({ hasText: sourceSpace.name }).waitFor();
  const images = await Promise.all(['#ffffff', '#ff0000'].map(background => sharp({ create: { width: 4, height: 4, channels: 3, background } }).jpeg().toBuffer()));
  await page.evaluate(buffers => {
    window.folderResult = { files: ['01.jpg', '02.jpg'].map((name, index) => ({ name, relativePath: `后台图集/${name}`, bytes: new Uint8Array(buffers[index]) })) };
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
  }, images.map(image => [...image]));
  await page.getByRole('heading', { name: '导入图集', exact: true }).waitFor();
  assert.equal(await page.getByLabel('来源链接（可选）').count(), 0);
  await page.getByRole('button', { name: '导入 1 个图集', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const status = page.getByRole('complementary', { name: '图集后台导入' });
  await status.getByText('后台导入中 · 0/2 张', { exact: true }).waitFor();
  await page.getByRole('button', { name: '文字', exact: true }).click();
  await page.locator('.space-switcher-trigger').click();
  await page.getByRole('menuitemradio', { name: '另一个空间' }).click();
  // Activity hides the wiki on other pages; the application queue and status must survive.
  await page.evaluate(() => { window.location.hash = 'shares'; });
  await page.locator('.wiki-sidebar [aria-current="page"]').filter({ hasText: '临时分享' }).waitFor();
  releaseUpload();
  await status.getByText('导入暂停 · 1/2 张', { exact: true }).waitFor();
  await status.getByRole('button', { name: '继续导入', exact: true }).click();
  await status.getByText('导入完成 · 2/2 张', { exact: true }).waitFor();
  assert.equal(imageRequests.length, 3);
  for (const req of imageRequests) {
    assert.equal(new URL(req.url()).searchParams.get('spaceId'), String(sourceSpace.id));
    assert.equal(req.headers()['x-jiva-space-id'], String(sourceSpace.id));
    assert.equal(req.headers()['x-album-id'], imageRequests[0].headers()['x-album-id']);
  }
  const result = await (await fetch(`${app.url}api/elements?kind=album&spaceId=${sourceSpace.id}`)).json();
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].album.title, '后台图集');
  assert.equal(result.elements[0].album.itemCount, 2);
  assert.deepEqual(errors, []);
  await status.getByRole('button', { name: '收起', exact: true }).click();
  await status.waitFor({ state: 'hidden' });
});

test('folder paste and drop open album confirmation while ordinary files and text keep their editors', { timeout: 60000, skip: !executablePath }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'wiki-folder-ui-'));
  const app = await createServer({ port: 0, dataDir });
  let browser;
  t.after(async () => { await browser?.close(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  page.setDefaultTimeout(10000);
  await page.addInitScript(() => {
    window.folderResult = null;
    window.wikiDesktop = { readClipboardFolders: async () => window.folderResult };
  });
  await page.goto(`${app.url}#wiki`);
  await page.locator('.wiki-main').waitFor();
  await page.evaluate(() => {
    window.folderResult = { files: [{ name: '01.jpg', relativePath: '人物/冬日/01.jpg', bytes: new Uint8Array([1, 2]) }] };
    window.dispatchEvent(new ClipboardEvent('paste', { cancelable: true, clipboardData: new DataTransfer() }));
  });
  await page.getByRole('heading', { name: '导入图集', exact: true }).waitFor();
  assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '冬日');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => {
    window.folderResult = null;
    const data = new DataTransfer(); data.setData('text/plain', 'ordinary text');
    document.querySelector('.wiki-main').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.getByText('ordinary text', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '放弃未保存内容', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  await page.evaluate(bytes => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'single.jpg', { type: 'image/jpeg' }));
    document.querySelector('.wiki-main').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, [...image]);
  await page.locator('dialog img').waitFor();
  assert.equal(await page.getByRole('heading', { name: '导入图集', exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '放弃未保存内容', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    let read = false;
    const entry = { isDirectory: true, name: '相册', createReader: () => ({ readEntries(resolve) {
      const batch = read ? [] : [{ isFile: true, file: done => done(new File(['pic'], '1.png')) }];
      read = true; resolve(batch);
    } }) };
    const event = new DragEvent('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { items: [{ webkitGetAsEntry: () => entry }], files: [] } });
    document.querySelector('.wiki-main').dispatchEvent(event);
  });
  await page.getByRole('heading', { name: '导入图集', exact: true }).waitFor();
  assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '相册');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  // Non-editable targets sometimes receive only the shortcut, without a paste event.
  await page.evaluate(() => {
    window.folderResult = { files: [{ name: 'a.jpg', relativePath: '快捷键/a.jpg', bytes: new Uint8Array([1]) }] };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, code: 'KeyV' }));
  });
  await page.getByRole('heading', { name: '导入图集', exact: true }).waitFor();
  assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '快捷键');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => {
    window.folderResult = { files: [] };
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
  });
  await page.getByRole('alert').filter({ hasText: '文件夹里没有可导入的 PNG、JPEG、WebP 或 GIF 图片。' }).waitFor();
});
