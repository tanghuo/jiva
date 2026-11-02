export function migrateAlbums(db) {
  if (db.prepare("SELECT 1 FROM wiki_schema WHERE version=49").get()) return;
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys;
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    // Rebuilding the referenced table requires recreating dependent views and triggers.
    const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND (type IN('trigger','view') OR (type='index' AND tbl_name='elements'))").all();
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='elements'").get()?.seq || 0;
    for (const item of schema) db.exec(`DROP ${item.type} "${item.name.replaceAll('"', '""')}"`);
    db.exec(`
      CREATE TABLE elements_v49 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind INTEGER NOT NULL CHECK(kind IN(1,2,3,4,5,6)),
        body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        content_version INTEGER NOT NULL DEFAULT 1,
        local_only INTEGER NOT NULL DEFAULT 0 CHECK(local_only IN(0,1)),
        creation_source INTEGER NOT NULL DEFAULT 0 CHECK(creation_source IN(0,1,2)),
        is_material INTEGER NOT NULL DEFAULT 0 CHECK(is_material IN(0,1)),
        space_id INTEGER NOT NULL DEFAULT 1 REFERENCES spaces(id),
        CHECK((kind IN(2,5,6) AND body='') OR (kind IN(1,3,4) AND length(trim(body))>0))
      );
      INSERT INTO elements_v49(id,kind,body,created_at,updated_at,deleted_at,content_version,local_only,creation_source,is_material,space_id)
        SELECT id,kind,body,created_at,updated_at,deleted_at,content_version,local_only,creation_source,is_material,space_id FROM elements;
      DROP TABLE elements;
      ALTER TABLE elements_v49 RENAME TO elements;
      CREATE TABLE album_meta (
        element_id INTEGER PRIMARY KEY REFERENCES elements(id),
        title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
        source_url TEXT NOT NULL DEFAULT '' CHECK(length(source_url) <= 2000),
        cover_image_id INTEGER REFERENCES elements(id),
        sort_mode TEXT NOT NULL DEFAULT 'manual' CHECK(sort_mode IN('manual','name','added')),
        created_from_path TEXT NOT NULL DEFAULT '' CHECK(length(created_from_path) <= 1000)
      );
      CREATE TABLE album_items (
        album_id INTEGER NOT NULL REFERENCES elements(id),
        image_id INTEGER NOT NULL UNIQUE REFERENCES elements(id),
        position INTEGER NOT NULL CHECK(position >= 0),
        PRIMARY KEY (album_id, image_id)
      );
      CREATE INDEX idx_album_items_album_pos ON album_items(album_id, position, image_id);
    `);
    db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='elements'").run(sequence);
    for (const item of schema) db.exec(item.sql);
    // Skip AI for images that already belong to an album (membership may land after the image insert).
    db.exec(`DROP TRIGGER IF EXISTS organization_new_image`);
    db.exec(`CREATE TRIGGER organization_new_image AFTER INSERT ON element_images BEGIN
        INSERT OR IGNORE INTO organization_jobs(element_id,content_version,created_at)
        SELECT NEW.element_id,e.content_version,unixepoch()*1000 FROM elements e,organization_state s
        WHERE e.id=NEW.element_id AND s.enabled=1 AND e.local_only=0
          AND NOT EXISTS(SELECT 1 FROM album_items ai WHERE ai.image_id=NEW.element_id);
      END`);
    db.exec(`CREATE TRIGGER album_member_skip_ai AFTER INSERT ON album_items BEGIN
        UPDATE organization_jobs SET state=4,lease_token=NULL,error='图集成员不自动整理'
          WHERE element_id=NEW.image_id AND state IN(0,1);
        DELETE FROM semantic_documents WHERE element_id=NEW.image_id;
      END`);
    db.exec(`CREATE TRIGGER album_item_image_kind BEFORE INSERT ON album_items
      BEGIN
        SELECT CASE WHEN NOT EXISTS(
          SELECT 1 FROM elements e WHERE e.id=NEW.image_id AND e.kind=2
        ) THEN RAISE(ABORT,'图集成员必须是图片') END;
        SELECT CASE WHEN NOT EXISTS(
          SELECT 1 FROM elements e WHERE e.id=NEW.album_id AND e.kind=6
        ) THEN RAISE(ABORT,'图集编号无效') END;
      END`);
    db.exec("INSERT INTO wiki_schema VALUES(49)");
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Album migration foreign key check failed");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`); }
}
