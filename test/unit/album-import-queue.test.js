import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumImportQueue } from '../../src/renderer/src/albumImportQueue.js';

function until(queue, predicate) {
  return new Promise(resolve => {
    const check = () => { if (predicate(queue.getSnapshot())) { unsubscribe(); resolve(); } };
    const unsubscribe = queue.subscribe(check);
    check();
  });
}
const album = (title, names) => ({ title, tags: ['人物'], files: names.map(name => ({ fileName: name, file: new Blob([name]) })) });

test('background album queue resumes failed image in the existing album and serializes batches', async () => {
  let fail = true, nextAlbum = 0;
  const calls = [];
  const queue = createAlbumImportQueue(async (url, options) => {
    calls.push({ url, ...options });
    if (url.startsWith('/api/albums')) return { id: ++nextAlbum };
    if (options.headers['x-file-name'] === '2.jpg' && fail) throw new Error('disk busy');
    return { id: 99 };
  });
  const original = album('第一册', ['1.jpg', '2.jpg', '3.jpg']);
  const id = queue.enqueue([original], 7);
  queue.enqueue([album('第二册', ['4.jpg'])], 8);
  await until(queue, state => state.jobs[1].status === 'done');
  assert.equal(queue.getSnapshot().jobs[0].status, 'failed');
  assert.equal(queue.getSnapshot().jobs[0].completed, 1);
  assert.equal(nextAlbum, 2);
  fail = false;
  queue.retry(id);
  await until(queue, state => state.jobs[0].status === 'done');
  assert.equal(nextAlbum, 2, 'retry must reuse the original shell');
  assert.equal(calls.filter(call => call.headers['x-file-name'] === '1.jpg').length, 1);
  const resumed = calls.slice(-2);
  assert.deepEqual(resumed.map(call => call.headers['x-file-name']), ['2.jpg', '3.jpg']);
  for (const call of resumed) {
    assert.equal(call.headers['x-album-id'], '1');
    assert.equal(call.headers['x-jiva-space-id'], '7');
    assert.equal(call.url, '/api/images?spaceId=7');
  }
  assert.equal(original.files[0].fileName, '1.jpg', 'queue must not mutate caller files');
  assert.equal(queue.getSnapshot().jobs[0].completed, 3);
  queue.dismiss(id);
  assert.equal(queue.getSnapshot().jobs.length, 1);
});

test('queue stays responsive during uploads and cannot discard active jobs', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const queue = createAlbumImportQueue(async url => {
    if (url.startsWith('/api/albums')) return { id: 1 };
    await blocked;
    return {};
  });
  assert.throws(() => queue.enqueue([album('未就绪', ['1.jpg'])]), /空间尚未就绪/);
  const id = queue.enqueue([album('相册', ['1.jpg'])], 5);
  queue.dismiss(id);
  assert.equal(queue.getSnapshot().jobs[0].status, 'running');
  release();
  await until(queue, state => state.jobs[0].status === 'done');
});
