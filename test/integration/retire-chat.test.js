import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { wikiMigrations, migrateWiki } from '../../src/server/data/wikiMigrations.js';
import { migrateRetireChat } from '../../src/server/data/retireChatMigration.js';
import { createElementRepository } from '../../src/server/data/elementRepository.js';
import { createAgentWorkbenchRepository } from '../../src/server/data/agentWorkbenchRepository.js';
import { createServer, fetch } from '../helpers/authenticatedServer.js';

test('retirement removes populated legacy history atomically, preserves Wiki outputs and workbench sessions, and repeats safely', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  try {
    for (const step of wikiMigrations) if (!step.versions.includes(46)) step.run(db);
    const wiki = createElementRepository(db);
    const source = wiki.createText({ body: '原始资料', tags: ['收藏'] });
    const saved = wiki.createText({ body: '已保存的旧聊天成果', tags: [], creationSource: 'chat' });
    const node = wiki.createRecord('session', '旧会话', { kind: 'session', sessionId: 1 });
    wiki.relate(source.id, saved.id, 'related', '参考了');
    wiki.relate(node.id, saved.id, 'related', '产出');
    db.exec(`INSERT INTO chat_sessions(id,title,created_at,updated_at) VALUES(1,'旧会话',0,0);
      INSERT INTO chat_turns(id,session_id,request_key,payload_hash,text,answer,created_at,updated_at) VALUES(1,1,'old-key','hash','问题','回答',0,0);
      UPDATE chat_sessions SET active_turn_id=1,draft_text='旧草稿' WHERE id=1;
      INSERT INTO chat_turns(id,session_id,request_key,payload_hash,text,parent_turn_id,created_at,updated_at) VALUES(2,1,'branch','hash','分支',1,0,0);
      UPDATE chat_turns SET selected_child_id=2 WHERE id=1;
      INSERT INTO chat_attachments VALUES(1,'old.png','参考图');
      INSERT INTO chat_trace_records(turn_id,record_key,data) VALUES(1,'request','{"prompt":"旧请求"}');
      INSERT INTO chat_new_draft VALUES(1,'{"text":"未发草稿"}',1);`);
    db.prepare('INSERT INTO chat_session_elements VALUES(1,?)').run(node.id);
    db.prepare("INSERT INTO chat_element_bindings(turn_id,output_key,element_id) VALUES(1,'text:output',?)").run(saved.id);
    const agents = createAgentWorkbenchRepository(db);
    const workspace = agents.createWorkspace({ kind: 'scratch', userPath: 'fixture', path: 'fixture', identity: 'fixture' });
    const session = agents.createSession({ workspaceId: workspace.id, engine: 'grok-build', policy: {}, data: { title: '保留工作台' } });
    db.exec("CREATE TRIGGER reject46 BEFORE INSERT ON wiki_schema WHEN NEW.version=46 BEGIN SELECT RAISE(ABORT,'injected'); END");
    assert.throws(() => migrateRetireChat(db), /injected/);
    assert.equal(db.prepare('SELECT answer FROM chat_turns WHERE id=1').get().answer, '回答');
    assert.equal(wiki.get(node.id).kind, 'session');
    assert.equal(db.isTransaction, false);
    db.exec('DROP TRIGGER reject46');
    migrateRetireChat(db); migrateRetireChat(db); migrateWiki(db);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'chat_*'").all(), []);
    assert.throws(() => wiki.get(node.id), /不存在/);
    assert.equal(wiki.get(saved.id).body, saved.body);
    assert.equal(wiki.get(source.id).body, source.body);
    assert.equal(wiki.relations(source.id).relations[0].element.id, saved.id);
    assert.equal(agents.session(session.id).data.title, '保留工作台');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally { db.close(); }
});

test('primary workbench cleans dedicated legacy files and creates idempotent reference drafts without sending', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wiki-retire-chat-'));
  let app;
  t.after(async () => {
    await app?.close();
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('wiki-retire-chat-'));
    await rm(dir, { recursive: true, force: true });
  });
  for (const name of ['chat-artifacts', 'chat-workspace', 'assets', 'agent-artifacts']) {
    await mkdir(path.join(dir, name)); await writeFile(path.join(dir, name, 'sentinel'), name);
  }
  await writeFile(path.join(dir, 'agent-workbench.json'), JSON.stringify({ agentWorkbenchEnabled: false }));
  let prompts = 0;
  app = await createServer({ port: 0, dataDir: dir, openWorkbenchEngine: async () => { prompts++; throw new Error('must not send'); } });
  const api = async (route, body) => {
    const response = await fetch(new URL('api/' + route, app.url), body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  for (const name of ['chat-artifacts', 'chat-workspace']) await assert.rejects(lstat(path.join(dir, name)), { code: 'ENOENT' });
  for (const name of ['assets', 'agent-artifacts']) assert.equal(await readFile(path.join(dir, name, 'sentinel'), 'utf8'), name);
  assert.equal((await api('agent/status')).data.agentWorkbenchEnabled, true);
  assert.equal((await api('chat/sessions')).status, 404);
  assert.equal((await api('agent/legacy/1/continue', { requestKey: randomUUID() })).status, 404);
  const source = (await api('elements', { body: '需要引用的资料', tags: [] })).data;
  const png = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#36f' } }).png().toBuffer();
  const upload = await fetch(new URL('api/images', app.url), { method: 'POST', headers: { 'x-file-name': 'reference.png' }, body: png });
  const image = await upload.json(); assert.equal(upload.status, 201);
  const input = { requestKey: randomUUID(), text: '  保留草稿\n', sourceIds: [source.id, image.id] };
  const created = await api('agent/wiki-template', input); assert.equal(created.status, 200, JSON.stringify(created.data));
  const detail = (await api(`agent/sessions/${created.data.id}`)).data;
  assert.match(detail.session.data.initialContext, /需要引用的资料/);
  assert.equal(detail.draft.text, input.text); assert.equal(detail.draft.attachments.length, 1);
  assert.deepEqual(detail.turns, []); assert.equal(prompts, 0);
  assert.equal((await api('agent/wiki-template', input)).data.id, created.data.id);
  assert.equal((await api('agent/wiki-template', { ...input, text: '不同内容' })).status, 409);
  assert.equal((await api('agent/wiki-template', { ...input, requestKey: randomUUID(), sourceIds: [99999] })).status, 404);
  await app.close(); app = await createServer({ port: 0, dataDir: dir });
  assert.equal((await api(`agent/sessions/${created.data.id}`)).data.draft.text, input.text);
});
