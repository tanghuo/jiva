export function migrateMagnetImport(db) {
  if (db.prepare('SELECT 1 FROM wiki_schema WHERE version=50').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE import_connections(id INTEGER PRIMARY KEY, account_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)));
      CREATE TABLE magnet_imports(id INTEGER PRIMARY KEY, connection_id INTEGER NOT NULL REFERENCES import_connections(id), space_id INTEGER NOT NULL,
        source_hash TEXT NOT NULL, state INTEGER NOT NULL CHECK(state BETWEEN 0 AND 6), stage INTEGER NOT NULL CHECK(stage BETWEEN 0 AND 5), revision INTEGER NOT NULL DEFAULT 1,
        data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX idx_magnet_imports_active ON magnet_imports(state,id);
      CREATE TABLE magnet_import_albums(run_id INTEGER NOT NULL REFERENCES magnet_imports(id), candidate_key TEXT NOT NULL, album_id INTEGER REFERENCES elements(id) ON DELETE SET NULL, PRIMARY KEY(run_id,candidate_key));
      CREATE TABLE magnet_import_items(run_id INTEGER NOT NULL REFERENCES magnet_imports(id), file_key TEXT NOT NULL, image_id INTEGER REFERENCES elements(id) ON DELETE SET NULL, PRIMARY KEY(run_id,file_key));
      INSERT INTO wiki_schema VALUES(50);
    `);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
