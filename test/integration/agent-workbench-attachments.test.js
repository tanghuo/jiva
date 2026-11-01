import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, fetch } from '../helpers/authenticatedServer.js';
import { workbenchPdf } from '../helpers/workbenchPdf.js';

test('file attachments preserve originals, deliver native file references, and enforce ownership and format limits', { timeout: 30000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wiki-agent-attachments-')); let app;
  t.after(async () => { await app?.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('wiki-agent-attachments-')); await rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  const prompts = [], references = [];
  app = await createServer({ port: 0, dataDir: root, agentWorkbenchEnabled: true, async openWorkbenchEngine(_settings, callbacks) {
    return { sessionId: 'attachments', version: 'fixture', capabilities: { images: false }, async close() {}, cancel() {}, async prompt(text, delivery, _images, files) { prompts.push(text); references.push(files); delivery('attempted'); await callbacks.onEvent('message.delta', { text: '读取完成' }); return { stopReason: 'end_turn' }; } };
  } });
  async function api(route, body, method = 'POST') {
    const response = await fetch(new URL('/api/agent' + route, app.url), { method, ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    assert.equal(response.ok, true, await response.clone().text()); return response.json();
  }
  const workspace = await api('/workspaces', { kind: 'scratch', trusted: true });
  const session = await api('/sessions', { workspaceId: workspace.id, engine: 'grok-build' });
  const other = await api('/sessions', { workspaceId: workspace.id, engine: 'grok-build' });
  const upload = (name, bytes, type = 'application/octet-stream') => fetch(new URL(`/api/agent/sessions/${session.id}/attachments`, app.url), { method: 'POST', headers: { 'content-type': type, 'x-attachment-name': encodeURIComponent(name) }, body: bytes });
  const codeResponse = await upload('测试.ts', Buffer.from('export const answer = 42;'));
  assert.equal(codeResponse.status, 200); const code = await codeResponse.json();
  assert.equal(code.type, 'file'); assert.equal(code.metadata.filename, '测试.ts');
  const pdfBytes = workbenchPdf();
  const pdfResponse = await upload('report.pdf', pdfBytes, 'application/pdf');
  assert.equal(pdfResponse.status, 200, await pdfResponse.clone().text()); const pdf = await pdfResponse.json();
  assert.equal(pdf.type, 'file');
  const original = await fetch(new URL(`/api/agent/artifacts/${pdf.id}/content?sessionId=${session.id}`, app.url));
  assert.equal(original.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), pdfBytes);
  const denied = await fetch(new URL(`/api/agent/artifacts/${pdf.id}/content?sessionId=${other.id}`, app.url)); assert.equal(denied.status, 404);
  await api(`/sessions/${session.id}/turns`, { text: '阅读附件', artifactIds: [code.id, pdf.id], requestKey: 'read-files-first' });
  for (let i = 0; i < 200 && !prompts.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
  const detail = await api(`/sessions/${session.id}`, undefined, 'GET');
  assert.equal(prompts.length, 1, JSON.stringify(detail.turns)); assert.equal(prompts[0], '阅读附件');
  assert.deepEqual(references[0].map(file => file.name), ['测试.ts', 'report.pdf']);
  assert.equal(await readFile(references[0][0].path, 'utf8'), 'export const answer = 42;');
  assert.deepEqual(await readFile(references[0][1].path), pdfBytes);
  assert.equal((await upload('binary.zip', Buffer.from([0x50, 0x4b, 0, 1]))).status, 200);
  // Content parsing and validity are the engine's responsibility.
  assert.equal((await upload('invalid.pdf', Buffer.from('not a PDF'), 'application/pdf')).status, 200);
  assert.equal((await upload('scanned.pdf', workbenchPdf(''), 'application/pdf')).status, 200);
  assert.equal((await upload('huge.txt', Buffer.alloc(25 * 1024 * 1024 + 1, 97))).status, 413);
  assert.equal((await upload('%bad.txt', Buffer.from([0xff, 0xfe, 0xfd]))).status, 200);
  const badName = await fetch(new URL(`/api/agent/sessions/${session.id}/attachments`, app.url), { method: 'POST', headers: { 'x-attachment-name': '%ZZ' }, body: 'text' }); assert.equal(badName.status, 400);
});
