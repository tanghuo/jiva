import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, createServer } from '../helpers/authenticatedServer.js';
import { resolveBrowserPath } from '../resolveBrowserPath.js';

const browserPath = resolveBrowserPath();
const options = { timeout: 30000, skip: !browserPath && 'Browser required' };

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wiki-page-recovery-'));
  const app = await createServer({ port: 0, dataDir: dir });
  let browser;
  t.after(async () => {
    await browser?.close();
    await app.close();
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('wiki-page-recovery-'));
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.url + '#wiki');
  await page.getByRole('textbox', { name: '搜索内容', exact: true }).fill('保留搜索条件');
  return { page, errors };
}

for (const extension of ['js', 'css']) test(`a failed workflow ${extension} chunk preserves navigation and can recover with a page refresh`, options, async t => {
  const { page, errors } = await setup(t);
  let fail = true;
  await page.route(`**/assets/WorkflowApp-*.${extension}`, route => fail
    ? route.fulfill({ status: 404, body: 'Not found' })
    : route.continue());
  await page.getByRole('link', { name: '工作流', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: '工作流暂时无法显示' });
  await alert.waitFor();
  assert.equal(await page.getByRole('link', { name: 'Agent 工作台', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: '全部内容', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '搜索内容', exact: true }).inputValue(), '保留搜索条件');
  await page.getByRole('link', { name: '工作流', exact: true }).click();
  await alert.waitFor();
  fail = false;
  await alert.getByRole('button', { name: '刷新页面', exact: true }).click();
  await page.getByRole('heading', { name: '工作流', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#workflow');
  assert.deepEqual(errors, [], 'the module failure is handled by the page boundary');
});

test('a library render failure shows the root recovery screen and can reload', options, async t => {
  const { page, errors } = await setup(t);
  await page.route('**/api/elements?*', route => route.fulfill({ json: {
    elements: [{ id: 1, kind: 'text', body: { invalid: true }, tags: [] }],
    pagination: { total: 1, page: 1, pageSize: 36, pageCount: 1 },
  } }));
  await page.getByRole('textbox', { name: '搜索内容', exact: true }).fill('触发读取失败');
  const alert = page.getByRole('alert').filter({ hasText: '页面暂时无法显示' });
  await alert.waitFor();
  await page.unroute('**/api/elements?*');
  await alert.getByRole('button', { name: '刷新页面', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索内容', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'the root boundary handles errors outside the lazy pages');
});

test('a workflow render failure stays inside its page and retains the library state', options, async t => {
  const { page, errors } = await setup(t);
  await page.route('**/api/workflows', route => route.fulfill({ json: { workflows: null } }));
  await page.getByRole('link', { name: '工作流', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: '工作流暂时无法显示' });
  await alert.waitFor();
  await alert.getByText('查看错误详情', { exact: true }).click();
  assert.match(await alert.locator('pre').textContent(), /filter/);
  await page.getByRole('button', { name: '全部内容', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '搜索内容', exact: true }).inputValue(), '保留搜索条件');
  await page.getByRole('link', { name: '工作流', exact: true }).click();
  await alert.waitFor();
  await page.unroute('**/api/workflows');
  await alert.getByRole('button', { name: '刷新页面', exact: true }).click();
  await page.getByRole('heading', { name: '工作流', exact: true }).waitFor();
  assert.deepEqual(errors, [], 'the render failure is handled by the page boundary');
});
