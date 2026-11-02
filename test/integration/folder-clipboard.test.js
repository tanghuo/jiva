import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { collectFolderFiles } from '../../src/main/folderClipboard.js';
import { collectDataTransferAlbums, summarizeDroppedFiles } from '../../src/renderer/src/albumFolders.js';

test('clipboard folders retain nested Unicode paths, skip unrelated files and enforce bounds', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-folder-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, '人物', '冬日');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, '01.jpg'), Buffer.from([1, 2, 3]));
  await writeFile(path.join(folder, '02.png'), Buffer.from([4, 5]));
  await writeFile(path.join(folder, 'notes.txt'), 'skip');
  const result = await collectFolderFiles([path.join(root, '人物')]);
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].relativePath, '人物/冬日/01.jpg');
  assert.deepEqual([...result.files[0].bytes], [1, 2, 3]);
  const plan = summarizeDroppedFiles(result.files.map(row => ({ ...row, file: new File([row.bytes], row.name) })));
  assert.equal(plan.albums[0].title, '冬日');
  assert.equal(plan.albums[0].parentTag, '人物');
  assert.equal(await collectFolderFiles([path.join(folder, 'notes.txt')]), null);
  await assert.rejects(collectFolderFiles([folder], { maxFiles: 1 }), /分批导入/);
  await assert.rejects(collectFolderFiles([folder], { maxBytes: 1 }), /分批导入/);
});

test('directory entries are captured before asynchronous reads and preserve paths without mutating Files', async () => {
  let active = true;
  const file = Object.freeze(new File(['image'], 'a.jpg'));
  const leaf = { isFile: true, file(resolve) { active = false; queueMicrotask(() => resolve(file)); } };
  const directory = name => ({ isDirectory: true, name, createReader() {
    let read = false;
    return { readEntries(resolve) { const batch = read ? [] : [leaf]; read = true; resolve(batch); } };
  } });
  const transfer = { items: ['甲', '乙'].map(name => ({ webkitGetAsEntry() { return active ? directory(name) : null; } })) };
  const plan = await collectDataTransferAlbums(transfer);
  assert.deepEqual(plan.albums.map(album => album.title).sort(), ['乙', '甲'].sort());
  assert.equal(plan.albums[0].files[0].file, file);
  const loose = await collectDataTransferAlbums({ files: [new File(['x'], 'x.jpg')] });
  assert.equal(loose.looseImages.length, 1);
});
