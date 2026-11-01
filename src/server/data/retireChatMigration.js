import { createElementRepository } from './elementRepository.js';

// Historical migrations remain so installations at every supported version can
// upgrade. The final schema no longer contains the retired conversation tables.
export function migrateRetireChat(db) {
  if (db.prepare('SELECT 1 FROM wiki_schema WHERE version=46').get()) return;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'chat_*'").all();
  const sessions = db.prepare('SELECT id FROM elements WHERE kind=3').all();
  db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
  try {
    // Empty first to resolve the old session/head/turn cycles before dropping.
    for (const { name } of tables) db.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`);
    for (const { name } of tables) db.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`);
    const wiki = createElementRepository(db);
    for (const { id } of sessions) {
      db.prepare("UPDATE elements SET deleted_at=coalesce(deleted_at,datetime('now')) WHERE id=?").run(id);
      wiki.purge(id);
    }
    db.exec("DELETE FROM agent_commands WHERE scope='legacy.convert'; INSERT INTO wiki_schema VALUES(46)");
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Chat retirement foreign key check failed');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
