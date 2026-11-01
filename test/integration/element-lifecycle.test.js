import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../../src/server/data/sqlite.js';
import { migrateElementLifecycle } from '../../src/server/data/elementLifecycleMigration.js';

test("lifecycle migration rolls back dropped schema objects and restores foreign keys if DDL fails", () => {
  const db = initDb(":memory:");
  try {
    db.exec("DELETE FROM wiki_schema WHERE version=14; CREATE TABLE elements_v14(sentinel INTEGER)");
    const schema = () => db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
    const before = schema();
    assert.throws(() => migrateElementLifecycle(db), /already exists/);
    assert.deepEqual(schema(), before);
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});
