import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { initDb } from '../../src/server/data/sqlite.js';
import { createElementRepository } from '../../src/server/data/elementRepository.js';
import { createElementService } from '../../src/server/application/elementService.js';
import { createImageStore } from '../../src/server/assets/imageStore.js';
import { createMagnetImportRepository } from '../../src/server/data/magnetImportRepository.js';
import { createMagnetImportStore } from '../../src/server/assets/magnetImportStore.js';
import { createMagnetImportService } from '../../src/server/application/magnetImportService.js';
import { defaultImportLimits, magnetSource, importLimits } from '../../src/shared/domain/magnetImport.js';
import { handleMagnetImportRoute } from '../../src/server/http/magnetImportRoutes.js';

const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}`;
async function until(fn) { const end = Date.now() + 10000; while (Date.now() < end) { const result = fn(); if (result) return result; await new Promise(r => setTimeout(r, 15)); } throw new Error('Timed out'); }
async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jiva-import-'));
  const db = initDb(':memory:'), wiki = createElementService(createElementRepository(db), createImageStore(path.join(dir, 'assets')));
  const repo = createMagnetImportRepository(db), c = repo.connect('123', 'Test');
  const imageStore = createImageStore(path.join(dir, 'assets'));
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
  const calls = [], limits = { ...defaultImportLimits, freeBytes: 0 };
  let remote = true, failDownload = false;
  const adapter = {
    available: async () => true,
    async call(_account, action, fields) {
      calls.push(action);
      if (action === 'tasks') return remote ? [{ info_hash: 'a'.repeat(40), status: 2, file_id: '1' }] : [];
      if (action === 'submit') { remote = true; throw new Error('Lost response'); }
      if (action === 'stat') return { FileID: '1', Name: 'Pictures', IsDirectory: true };
      if (action === 'list') return [{ FileID: '2', ParentID: '1', Name: '01.png', IsDirectory: false, Size: png.length, Sha1: '' }, { FileID: '3', ParentID: '1', Name: 'README.txt', Size: 10 }];
      if (action === 'download') { if (failDownload) throw new Error('Simulated failure'); await mkdir(fields.root, { recursive: true }); await writeFile(path.join(fields.root, fields.target), png); return {}; }
      throw new Error('Unexpected action');
    },
  };
  const store = createMagnetImportStore({ dataDir: dir, adapter, inspect: imageStore.inspect, limits });
  let service = createMagnetImportService({ repo, wiki, adapter, store, limits });
  t.after(async () => { await service.close(); db.close(); await rm(dir, { recursive: true, force: true }); });
  const create = () => service.create({ magnet, connectionId: c.id, spaceId: 1 });
  return { dir, db, repo, wiki, calls, store, adapter, limits, png, create, get service() { return service; }, set remote(v) { remote = v; }, set failDownload(v) { failDownload = v; }, async restart() { await service.close(); service = createMagnetImportService({ repo, wiki, adapter, store, limits }); service.start(); return service; } };
}

test('magnet normalizes base32 and tracker variants into one hash', () => {
  assert.equal(magnetSource('magnet:?xt=urn:btih:' + 'A'.repeat(32)).hash, '0'.repeat(40));
  assert.equal(magnetSource(magnet + '&tr=https://example.test').hash, 'a'.repeat(40));
  assert.throws(() => magnetSource('https://example.test'));
});

test('import routes deny LAN and worker principals before consulting the service; limits are bounded', async () => {
  const service = new Proxy({}, { get() { throw Error('Service must not be consulted'); } });
  for (const endpoint of ['', '/login', '/login/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '/connections/1', '/1/preview', '/sources/1']) {
    for (const [access, principal] of [['lan', undefined], ['local', 'organizer-worker']]) await assert.rejects(handleMagnetImportRoute(service, { method: 'GET', localPrincipal: principal }, {}, new URL(`http://localhost/api/magnet-imports${endpoint}`), access), e => e.statusCode === 403);
  }
  assert.throws(() => importLimits({ files: 0 }));
  assert.throws(() => importLimits({ downloadBytes: 9 * 1024 ** 3 }));
  assert.deepEqual(importLimits({ freeBytes: 0 }), { ...defaultImportLimits, freeBytes: 0 });
});

test('persisted confirmation, fixed space, skipped acknowledgement, import receipt and independent cleanup', async t => {
  const h = await setup(t), run = h.create();
  const ready = await until(() => h.repo.get(run.id).state === 'confirmation' && h.service.detail(run.id));
  assert.equal(ready.plan.candidates[0].title, 'Pictures');
  assert.equal(ready.plan.candidates[0].tags.length, 0);
  assert.equal(ready.plan.skipped.length, 1);
  assert.equal(h.create().id, run.id);
  const other = h.wiki.createSpace({ name: 'Other' });
  await h.restart();
  assert.equal(h.service.detail(run.id).state, 'confirmation');
  const input = { version: ready.plan.version, candidates: ready.plan.candidates.map(c => ({ key: c.key, title: c.title, tags: c.tags, selected: true })) };
  assert.throws(() => h.service.confirm(run.id, input), /排除/);
  h.service.confirm(run.id, { ...input, excludeSkipped: true });
  const done = await until(() => h.repo.get(run.id).state === 'completed' && h.repo.get(run.id).cleanup === 'done' && h.service.detail(run.id));
  assert.equal(done.imported, 1); assert.equal(done.results.length, 1);
  assert.equal(h.wiki.get(done.results[0].albumId).spaceId, 1);
  assert.notEqual(other.id, 1);
  assert.equal(done.cacheBytes, 0);
  assert.equal(h.calls.filter(c => c === 'submit').length, 0);
});

test('lost submission response reconciles, and never blindly submits twice', async t => {
  const h = await setup(t); h.remote = false;
  const run = h.create();
  await until(() => h.repo.get(run.id).state === 'failed');
  assert.equal(h.repo.get(run.id).submitIntent, true);
  h.service.retry(run.id);
  // The runner may still be unwinding from its previous attempt.
  h.service.start();
  await until(() => h.repo.get(run.id).state === 'confirmation');
  assert.equal(h.calls.filter(c => c === 'submit').length, 1);
});

test('download failure resumes download without resubmission; cleaning invalidates confirmation', async t => {
  const h = await setup(t); h.failDownload = true;
  const run = h.create(); await until(() => h.repo.get(run.id).state === 'failed');
  assert.equal(h.repo.get(run.id).stage, 'download');
  h.failDownload = false; h.service.start(); h.service.retry(run.id);
  await until(() => h.repo.get(run.id).state === 'confirmation');
  assert.equal(h.calls.filter(c => c === 'submit').length, 0);
  await until(() => !h.repo.runnable().length);
  await new Promise(r => setTimeout(r, 20));
  await h.service.clean(run.id);
  assert.equal(h.repo.get(run.id).state, 'attention'); assert.equal(h.repo.get(run.id).plan, null);
});

test('album creation and receipt roll back together; item receipt rollback removes DB write', async t => {
  const h = await setup(t), run = h.create(); await until(() => h.repo.get(run.id).state === 'confirmation');
  assert.throws(() => h.repo.album(run.id, 'bad', () => { h.wiki.createAlbum({ title: 'Rollback', spaceId: 1 }); throw new Error('receipt failure'); }));
  assert.equal(h.repo.albums(run.id).length, 0);
  assert.equal(h.wiki.list({ kind: 'album' }).elements.length, 0);
  const album = h.wiki.createAlbum({ title: 'Atomic', spaceId: 1 });
  h.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON magnet_import_items BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
  await assert.rejects(h.wiki.importImage(h.png, 'a.png', [], false, 1, album.id, write => h.repo.commitItem(run.id, 'file', write)), /receipt failure/);
  assert.equal(h.wiki.albumItems(album.id).items.length, 0);
  h.db.exec('DROP TRIGGER fail_receipt');
  await h.wiki.importImage(h.png, 'a.png', [], false, 1, album.id, write => h.repo.commitItem(run.id, 'file', write));
  assert.equal(h.repo.items(run.id).length, 1);
});

test('changed plan members require a rebuilt plan; cancellation persists across restart', async t => {
  const h = await setup(t), run = h.create();
  const ready = await until(() => h.repo.get(run.id).state === 'confirmation' && h.repo.get(run.id));
  await writeFile(await h.store.location(run.id, ready.plan.candidates[0].files[0].local), Buffer.from('changed'));
  h.service.confirm(run.id, { version: ready.plan.version, excludeSkipped: true, candidates: ready.plan.candidates.map(c => ({ key: c.key, title: c.title, tags: [], selected: true })) });
  h.service.start();
  await until(() => h.repo.get(run.id).state === 'attention');
  assert.equal(h.repo.get(run.id).plan, null); assert.equal(h.repo.albums(run.id).length, 0);
  h.service.cancel(run.id); await h.restart();
  assert.equal(h.repo.get(run.id).state, 'canceled');
});

test('partial import resumes only unreceipted files and reuses its original album', async t => {
  const h = await setup(t);
  const originalCall = h.adapter.call;
  h.adapter.call = async (account, action, fields) => {
    const value = await originalCall(account, action, fields);
    return action === 'list' ? [...value, { ...value[0], FileID: '4', Name: '02.png' }] : value;
  };
  const run = h.create(); const ready = await until(() => h.repo.get(run.id).state === 'confirmation' && h.repo.get(run.id));
  const originalImport = h.wiki.importImage;
  let first = true;
  h.wiki.importImage = async (...args) => { const result = await originalImport(...args); if (first) { first = false; throw new Error('Interrupted after commit'); } return result; };
  h.service.confirm(run.id, { version: ready.plan.version, excludeSkipped: true, candidates: ready.plan.candidates.map(c => ({ key: c.key, title: c.title, tags: [], selected: true })) });
  h.service.start(); await until(() => h.repo.get(run.id).state === 'failed');
  assert.equal(h.repo.items(run.id).length, 1);
  const albumId = h.repo.albums(run.id)[0].albumId;
  let resumed = 0;
  h.wiki.importImage = async (...args) => { resumed++; return originalImport(...args); };
  await h.restart(); h.service.retry(run.id);
  await until(() => h.repo.get(run.id).state === 'completed');
  assert.equal(resumed, 1); assert.equal(h.repo.items(run.id).length, 2);
  assert.deepEqual(h.repo.albums(run.id).map(r => r.albumId), [albumId]);
});

test('cancel after a committed member prevents the next member from importing', async t => {
  const h = await setup(t);
  const originalCall = h.adapter.call;
  h.adapter.call = async (account, action, fields) => {
    const value = await originalCall(account, action, fields);
    return action === 'list' ? [...value, { ...value[0], FileID: '4', Name: '02.png' }] : value;
  };
  const run = h.create(); const ready = await until(() => h.repo.get(run.id).state === 'confirmation' && h.repo.get(run.id));
  const originalImport = h.wiki.importImage;
  h.wiki.importImage = async (...args) => { const result = await originalImport(...args); h.service.cancel(run.id); return result; };
  h.service.start();
  h.service.confirm(run.id, { version: ready.plan.version, excludeSkipped: true, candidates: ready.plan.candidates.map(c => ({ key: c.key, title: c.title, tags: [], selected: true })) });
  await until(() => h.repo.get(run.id).state === 'canceled'); await h.service.close();
  assert.equal(h.repo.items(run.id).length, 1); assert.equal(h.repo.albums(run.id).length, 1);
});

test('deleted target space never falls back to another space', async t => {
  const h = await setup(t), run = h.create();
  const ready = await until(() => h.repo.get(run.id).state === 'confirmation' && h.repo.get(run.id));
  h.wiki.createSpace({ name: 'Remaining' }); h.wiki.deleteSpace(1);
  assert.throws(() => h.service.confirm(run.id, { version: ready.plan.version, excludeSkipped: true, candidates: ready.plan.candidates }), /目标空间/);
  assert.equal(h.repo.get(run.id).spaceId, 1); assert.equal(h.repo.albums(run.id).length, 0);
});

test('quota rejection is actionable and unknown submission stays blocked without a remote match', async t => {
  const h = await setup(t); h.remote = false;
  const originalCall = h.adapter.call;
  h.adapter.call = async (account, action, fields) => {
    if (action === 'submit') throw Object.assign(new Error('quota'), { code: 'QUOTA_EXHAUSTED', statusCode: 502 });
    return originalCall(account, action, fields);
  };
  const run = h.create(); await until(() => h.repo.get(run.id).state === 'attention');
  assert.equal(h.repo.get(run.id).submitIntent, false); assert.match(h.repo.get(run.id).error, /配额不足/);
  await h.service.close();
  h.repo.save({ ...h.repo.get(run.id), submitIntent: true });
  await h.restart(); h.service.retry(run.id);
  await until(() => h.repo.get(run.id).state === 'attention');
  assert.match(h.repo.get(run.id).error, /提交结果不明/);
});

test('expired authentication while reconciling cannot erase an earlier unknown submission', async t => {
  const h = await setup(t); h.remote = false;
  const run = h.create(); await until(() => h.repo.get(run.id).state === 'failed');
  assert.equal(h.repo.get(run.id).submitIntent, true);
  const originalCall = h.adapter.call;
  h.adapter.call = async () => { throw Object.assign(new Error('expired'), { code: 'AUTH_REQUIRED', statusCode: 502 }); };
  await h.restart(); h.service.retry(run.id);
  await until(() => h.repo.get(run.id).state === 'attention');
  assert.equal(h.repo.get(run.id).submitIntent, true);
  h.adapter.call = originalCall;
});
