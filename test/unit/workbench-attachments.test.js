import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentError, transferFiles, attachmentEvents } from '../../src/renderer/src/features/agentWorkbench/workbenchAttachments.js';

const file = (name, type, size = 10) => ({ name, type, size });
test('workbench accepts mixed attachments with size, image format and count limits', () => {
  assert.equal(attachmentError([file('a.png', 'image/png'), file('main.js', ''), file('notes.txt', 'text/plain'), file('report.pdf', '')], 4), '');
  assert.equal(attachmentError([file('c.webp', '')]), '');
  assert.match(attachmentError([file('d.gif', 'image/gif')]), /PNG、JPEG、WebP/);
  assert.match(attachmentError([file('e.png', 'image/png', 26 * 1024 * 1024)]), /25 MiB/);
  assert.match(attachmentError([file('a.txt', 'text/plain', 26 * 1024 * 1024)]), /25 MiB/);
  assert.match(attachmentError([file('f.pdf', '')], 8), /最多 8 个/);
  assert.equal(attachmentError([]), '');
});

test('clipboard and drop read all files once, including files with no MIME type', () => {
  const files = [file('main.rs', ''), file('notes.txt', 'text/plain'), file('shot.png', 'image/png')];
  assert.deepEqual(transferFiles({ files, items: files.map(value => ({ kind: 'file', getAsFile: () => value })) }), files);
  assert.deepEqual(transferFiles({ items: files.map(value => ({ kind: 'file', getAsFile: () => value })) }), files);
  assert.deepEqual(transferFiles(null), []);
});

test('file events consume attachments but preserve native text pasting and dragging', () => {
  let additions = 0, prevented = 0, stopped = 0;
  const handlers = attachmentEvents(files => { additions += files.length; });
  const event = { preventDefault() { prevented++; }, stopPropagation() { stopped++; }, clipboardData: { files: [] }, dataTransfer: { files: [], types: ['text/plain'] } };
  handlers.onPaste(event); handlers.onDragOver(event); handlers.onDrop(event);
  assert.equal(prevented, 0); assert.equal(stopped, 0);
  event.clipboardData.files = [file('code.ts', '')];
  handlers.onPaste(event);
  event.dataTransfer = { files: [file('test.pdf', 'application/pdf')], types: ['Files'] };
  handlers.onDragOver(event); handlers.onDrop(event);
  assert.equal(event.dataTransfer.dropEffect, 'copy');
  assert.equal(additions, 2); assert.equal(prevented, 3); assert.equal(stopped, 3);
});
