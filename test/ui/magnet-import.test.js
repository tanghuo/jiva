import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { chromium, createServer } from '../helpers/authenticatedServer.js';
import { resolveBrowserPath } from '../resolveBrowserPath.js';
import { stubWorkbenchModels } from '../helpers/workbenchModels.js';
import { initDb } from '../../src/server/data/sqlite.js';
import { createMagnetImportRepository } from '../../src/server/data/magnetImportRepository.js';
import { torrentMagnet } from '../../src/server/assets/torrentMagnet.js';

const browserPath = resolveBrowserPath();
test('torrent files paste from Wiki, choose, drop and native clipboard visibly fill the magnet form', { timeout: 60000, skip: !browserPath }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'torrent-input-ui-'));
  const app = await createServer({ port: 0, dataDir });
  let browser;
  t.after(async () => { await browser?.close(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage(); await stubWorkbenchModels(page);
  const body = 'd4:infod6:lengthi1e4:name1:xee', magnet = torrentMagnet(Buffer.from(body));
  await page.goto(app.url + '#wiki');
  await page.evaluate(value => { const transfer = new DataTransfer(); transfer.items.add(new File([value], 'example.torrent')); document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })); }, body);
  await page.waitForURL('**/#imports');
  await page.getByRole('status').filter({ hasText: '已识别磁力' }).waitFor();
  assert.equal(await page.getByLabel('磁力链接', { exact: true }).inputValue(), magnet);
  await page.getByLabel('种子文件', { exact: true }).setInputFiles({ name: 'bad.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from('bad') });
  await page.getByRole('alert').filter({ hasText: '种子文件无效' }).waitFor();
  await page.getByLabel('种子文件', { exact: true }).setInputFiles({ name: 'ok.torrent', mimeType: 'application/x-bittorrent', buffer: Buffer.from(body) });
  await page.getByRole('status').filter({ hasText: '已识别磁力' }).waitFor();
  await page.getByLabel('磁力链接', { exact: true }).fill('');
  await page.evaluate(value => { const transfer = new DataTransfer(); transfer.items.add(new File([value], 'drop.torrent')); document.querySelector('.magnet-imports').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); }, body);
  await page.waitForFunction(m => document.querySelector('.magnet-create textarea')?.value === m, magnet);
  const nativeMagnet = 'magnet:?xt=urn:btih:' + 'b'.repeat(40);
  await page.route('**/api/magnet-imports/clipboard-torrent', route => route.fulfill({ json: { input: { magnet: nativeMagnet } } }));
  await page.evaluate(() => document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() })));
  await page.waitForFunction(m => document.querySelector('.magnet-create textarea')?.value === m, nativeMagnet);
});
test('magnet task survives navigation, previews and confirms into its fixed space', { timeout: 60000, skip: !browserPath }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'magnet-ui-'));
  const png = await sharp({ create: { width: 80, height: 100, channels: 3, background: '#456789' } }).png().toBuffer();
  const adapter = {
    available: async () => true,
    async call(_account, action, f) {
      if (action === 'tasks') return [{ info_hash: 'a'.repeat(40), status: 2, file_id: '1' }];
      if (action === 'stat') return { FileID: '1', Name: 'UI sample', IsDirectory: true };
      if (action === 'list') return [{ FileID: '2', ParentID: '1', Name: 'test.png', Size: png.length }];
      if (action === 'download') { await mkdir(f.root, { recursive: true }); await writeFile(path.join(f.root, f.target), png); return {}; }
      throw Error('Unexpected call');
    },
  };
  const app = await createServer({ port: 0, dataDir, importAdapter: adapter, importLimits: { freeBytes: 0 } });
  const db = initDb(path.join(dataDir, 'library.sqlite3')); createMagnetImportRepository(db).connect('123', 'Test 115'); db.close();
  let browser;
  t.after(async () => { await browser?.close(); await app.close(); assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir())); await rm(dataDir, { recursive: true, force: true }); });
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await stubWorkbenchModels(page);
  await page.goto(`${app.url}#imports`);
  await page.getByLabel('磁力链接', { exact: true }).fill(`magnet:?xt=urn:btih:${'a'.repeat(40)}`);
  await page.getByRole('button', { name: '创建导入任务', exact: true }).click();
  await page.getByRole('heading', { name: '任务 #1 · 待确认', exact: true }).waitFor({ timeout: 15000 });
  await page.getByLabel('标题', { exact: true }).fill('Confirmed title');
  await page.reload();
  await page.getByRole('button', { name: /任务 #1 · 待确认/ }).click();
  await page.getByLabel('标题', { exact: true }).fill('Confirmed title');
  await page.screenshot({ path: path.resolve('.local/magnet-import-ui.png'), fullPage: true });
  await page.getByRole('button', { name: '确认导入所选图集', exact: true }).click();
  await page.getByRole('heading', { name: '任务 #1 · 已完成', exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: /打开图集 #/ }).click();
  await page.getByRole('link', { name: '导入来源 · 任务 #1', exact: true }).waitFor();
  assert.deepEqual(errors, []);
});
