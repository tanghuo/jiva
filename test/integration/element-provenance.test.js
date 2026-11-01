import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from 'node:sqlite';
import { wikiMigrations } from '../../src/server/data/wikiMigrations.js';
function initDb() { const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); for (const step of wikiMigrations) if (!step.versions.includes(46)) step.run(db); return db; }
import { createElementRepository } from "../../src/server/data/elementRepository.js";
import { migrateElementCreationSource } from "../../src/server/data/elementCreationSourceMigration.js";
import { migrateChatReferences } from "../../src/server/data/chatReferenceMigration.js";
import { relationLabel } from "../../src/shared/domain/elements.js";

test("image reuse preserves its original entry route, independently of output bindings", () => {
  const db = initDb(":memory:");
  try {
    const wiki = createElementRepository(db);
    const file = { storageKey: "manual.png", mimeType: "image/png", byteSize: 1, originalName: "manual.png", contentHash: "a".repeat(64) };
    const manual = wiki.importImage({ tags: [], creationSource: "manual" }, file).element;
    const reused = wiki.importImage({ tags: [], localOnly: true, creationSource: "chat" }, file).element;
    assert.equal(reused.id, manual.id); assert.equal(reused.creationSource, "manual");
    const generatedFile = { ...file, storageKey: "chat.png", contentHash: "b".repeat(64) };
    const generated = wiki.importImage({ tags: [], creationSource: "chat" }, generatedFile).element;
    assert.equal(wiki.importImage({ tags: [], creationSource: "manual" }, generatedFile).element.creationSource, "chat");
    db.prepare("INSERT INTO chat_element_bindings(turn_id,output_key,element_id) VALUES(1,'image:manual.png',?)").run(manual.id);
    db.exec("ALTER TABLE elements DROP COLUMN creation_source; DELETE FROM wiki_schema WHERE version=24");
    migrateElementCreationSource(db); migrateElementCreationSource(db);
    assert.equal(wiki.get(manual.id).creationSource, "unknown", "A binding cannot prove whether a legacy image was first imported");
    assert.equal(wiki.get(generated.id).creationSource, "unknown");
  } finally { db.close(); }
});

test("archive reference repair preserves receipt ids, directions, annotations and retry safety", () => {
  const db = initDb(":memory:");
  try {
    const wiki = createElementRepository(db);
    // Deliberately create output first: numeric order is unrelated to authorship.
    const output = wiki.createText({ body: "已保存的提示词", tags: [] });
    const source = wiki.createText({ body: "手动添加的参考", tags: [] });
    const manual = wiki.createText({ body: "人工关联", tags: [] });
    const unknown = wiki.createText({ body: "缺少方向证据", tags: [] });
    const legacy = wiki.relate(output.id, source.id, "related", "参考来源");
    const duplicate = wiki.relate(source.id, output.id, "related", "参考资料", { direction: "forward", reverseName: "参考自" });
    const annotation = wiki.relate(output.id, manual.id, "related", "参考来源");
    const unproven = wiki.relate(output.id, unknown.id, "related", "参考来源");
    for (const edge of [legacy, duplicate, unproven]) db.prepare("INSERT INTO element_provenance VALUES(?)").run(edge.id);
    db.exec("INSERT INTO chat_sessions(id,title,created_at,updated_at) VALUES(1,'旧会话',0,0); INSERT INTO chat_turns(id,session_id,request_key,payload_hash,text,created_at,updated_at) VALUES(1,1,'fixture','hash','保存结果',0,0)");
    const turn = { id: 1 };
    db.prepare(`INSERT INTO chat_proposals(turn_id,request_key,payload,snapshots,state,changes,after_snapshots,created_at)
      VALUES(?,'legacy',?,'[]',1,?,'[]',0)`).run(turn.id,
      JSON.stringify({ kind: "create_text", sourceIds: [source.id] }), JSON.stringify({ createdId: output.id, relationIds: [legacy.id], addedTags: [] }));
    db.exec("DELETE FROM wiki_schema WHERE version=25; CREATE TRIGGER fail_reference BEFORE UPDATE OF name ON element_relations BEGIN SELECT RAISE(ABORT,'repair rollback'); END");
    assert.throws(() => migrateChatReferences(db), /repair rollback/);
    assert.ok(db.prepare("SELECT 1 FROM element_relations WHERE id=?").get(duplicate.id), "Duplicate deletion rolls back with the rename");
    assert.equal(db.isTransaction, false);
    db.exec("DROP TRIGGER fail_reference");
    migrateChatReferences(db); migrateChatReferences(db);
    const edges = wiki.relations(source.id).relations;
    assert.equal(edges.length, 1); assert.equal(edges[0].id, legacy.id);
    assert.equal(relationLabel(edges[0], source.id), "被参考");
    assert.equal(relationLabel(edges[0], output.id), "参考了");
    for (const id of [annotation.id, unproven.id]) assert.equal(db.prepare("SELECT name FROM element_relations WHERE id=?").get(id).name, "参考来源");
    assert.equal(JSON.parse(db.prepare("SELECT changes FROM chat_proposals").get().changes).relationIds[0], legacy.id);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
