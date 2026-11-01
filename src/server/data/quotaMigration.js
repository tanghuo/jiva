export function migrateQuota(db) {
  if (db.prepare('SELECT 1 FROM wiki_schema WHERE version=47').get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE quota_source_state (source_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE quota_current (source_id TEXT NOT NULL, account_key TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL, observed_at INTEGER NOT NULL, PRIMARY KEY(source_id,account_key));
      CREATE TABLE quota_snapshot (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, account_key TEXT NOT NULL, bucket_id TEXT NOT NULL, limit_id TEXT NOT NULL, captured_at INTEGER NOT NULL, event_type INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX quota_snapshot_history ON quota_snapshot(source_id,account_key,bucket_id,captured_at);
      CREATE INDEX quota_snapshot_cleanup ON quota_snapshot(captured_at);
      INSERT INTO wiki_schema VALUES(47)`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
