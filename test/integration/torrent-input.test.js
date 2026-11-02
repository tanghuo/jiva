import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { torrentMagnet } from '../../src/server/assets/torrentMagnet.js';
import { clipboardTorrent } from '../../src/server/adapters/torrentClipboard.js';
import { createServer, fetch } from '../helpers/authenticatedServer.js';

const info = 'd6:lengthi1e4:name1:xe';
const torrent = Buffer.from(`d4:info${info}e`);
const expected = `magnet:?xt=urn:btih:${createHash('sha1').update(info).digest('hex')}`;
test('torrent reader hashes original info bytes and rejects invalid/truncated input', () => {
  assert.equal(torrentMagnet(torrent), expected);
  for (const bad of ['abc', 'd4:infoi1ee', 'd4:infod', `d4:info${info}4:info${info}e`, torrent.toString() + 'junk']) assert.throws(() => torrentMagnet(Buffer.from(bad)));
});
test('clipboard reader accepts only one clipboard-owned torrent and ignores other files', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'torrent-clipboard-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.torrent'); await writeFile(file, torrent);
  assert.equal((await clipboardTorrent({ roots: [file] })).magnet, expected);
  assert.equal(await clipboardTorrent({ roots: [path.join(dir, 'not-a-torrent.png')] }), null);
  await assert.rejects(clipboardTorrent({ roots: [file, file] }), /每次/);
});
test('torrent upload is authenticated, bounded and does not create a download task', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'torrent-upload-'));
  const app = await createServer({ port: 0, dataDir });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const url = app.url + 'api/magnet-imports/torrent';
  const response = await fetch(url, { method: 'POST', body: torrent });
  assert.equal(response.status, 200); assert.equal((await response.json()).magnet, expected);
  assert.equal((await globalThis.fetch(url, { method: 'POST', body: torrent })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', body: 'not a torrent' })).status, 400);
  assert.equal((await (await fetch(app.url + 'api/magnet-imports')).json()).tasks.length, 0);
});
