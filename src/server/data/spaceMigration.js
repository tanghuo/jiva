import { DEFAULT_SPACE_COLOR, DEFAULT_SPACE_NAME } from "../../shared/domain/spaces.js";

// Views that reference tags and must be dropped before rebuilding the tags table.
const tagDependentViews = [
  "resolved_element_relations",
  "visible_tag_relations",
  "canonical_tag_relations",
  "visible_element_relations",
  "canonical_element_relations",
  "canonical_content_tag_usage",
  "content_tag_usage",
  "canonical_video_marker_tags",
  "canonical_element_tags",
  "resolved_tags",
];

const tagDependentViewSql = {
  resolved_tags: `CREATE VIEW resolved_tags AS
    WITH RECURSIVE paths(id,canonical_id) AS (
      SELECT id,id FROM tags UNION ALL
      SELECT p.id,a.canonical_id FROM paths p JOIN tag_aliases a ON a.alias_id=p.canonical_id
    ) SELECT p.id,t.id AS canonical_id,t.name,t.normalized_name,t.space_id FROM paths p JOIN tags t ON t.id=p.canonical_id
      WHERE NOT EXISTS(SELECT 1 FROM tag_aliases a WHERE a.alias_id=p.canonical_id)`,
  canonical_element_tags: `CREATE VIEW canonical_element_tags AS
    SELECT DISTINCT et.element_id,t.canonical_id AS tag_id FROM element_tags et JOIN resolved_tags t ON t.id=et.tag_id`,
  resolved_relation_terms_skip: null,
  canonical_element_relations: `CREATE VIEW canonical_element_relations AS
    SELECT r.id,r.source_id,r.target_id,r.kind,coalesce(c.name,r.name) AS name,r.created_at,r.direction,
      coalesce(c.reverse_name,r.reverse_name) AS reverse_name
    FROM element_relations r LEFT JOIN relation_terms t
      ON r.kind=1 AND r.direction IN(-1,0,1) AND t.name=r.name AND t.reverse_name=r.reverse_name AND t.directed=abs(r.direction)
    LEFT JOIN resolved_relation_terms c ON c.id=t.id`,
  visible_element_relations: `CREATE VIEW visible_element_relations AS
    SELECT min(id) AS id,source_id,target_id,kind,name,min(created_at) AS created_at,direction,reverse_name
    FROM canonical_element_relations GROUP BY source_id,target_id,kind,name,direction,reverse_name`,
  canonical_tag_relations: `CREATE VIEW canonical_tag_relations AS
    SELECT r.id,r.source_id,tag.canonical_id AS tag_id,coalesce(c.name,r.name) AS name,r.created_at,r.direction,
      coalesce(c.reverse_name,r.reverse_name) AS reverse_name
    FROM tag_relations r JOIN resolved_tags tag ON tag.id=r.tag_id LEFT JOIN relation_terms t
      ON r.direction IN(-1,0,1) AND t.name=r.name AND t.reverse_name=r.reverse_name AND t.directed=abs(r.direction)
    LEFT JOIN resolved_relation_terms c ON c.id=t.id`,
  visible_tag_relations: `CREATE VIEW visible_tag_relations AS
    SELECT min(id) AS id,source_id,tag_id,name,min(created_at) AS created_at,direction,reverse_name
    FROM canonical_tag_relations GROUP BY source_id,tag_id,name,direction,reverse_name`,
  resolved_element_relations: `CREATE VIEW resolved_element_relations AS
    SELECT id,source_id,target_id,kind,name,NULL AS tag_relation_id,NULL AS target_tag,direction,reverse_name FROM visible_element_relations
    UNION ALL
    SELECT 'tag:'||r.id||':'||et.element_id,r.source_id,et.element_id,3,r.name,r.id,t.name,r.direction,r.reverse_name
    FROM visible_tag_relations r JOIN tags t ON t.id=r.tag_id JOIN canonical_element_tags et ON et.tag_id=r.tag_id
    WHERE r.source_id!=et.element_id`,
  canonical_video_marker_tags: `CREATE VIEW canonical_video_marker_tags AS
    SELECT DISTINCT mt.marker_id,t.canonical_id AS tag_id FROM video_marker_tags mt JOIN resolved_tags t ON t.id=mt.tag_id`,
  content_tag_usage: `CREATE VIEW content_tag_usage AS
    SELECT element_id,tag_id FROM element_tags UNION
    SELECT m.video_id,mt.tag_id FROM video_marker_tags mt JOIN video_markers m ON m.id=mt.marker_id`,
  canonical_content_tag_usage: `CREATE VIEW canonical_content_tag_usage AS
    SELECT DISTINCT u.element_id,t.canonical_id AS tag_id FROM content_tag_usage u JOIN resolved_tags t ON t.id=u.tag_id`,
};

function recreateTagViews(db) {
  const hasMarkers = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='video_markers'").get());
  const order = [
    "resolved_tags",
    "canonical_element_tags",
    "canonical_element_relations",
    "visible_element_relations",
    "canonical_tag_relations",
    "visible_tag_relations",
    "resolved_element_relations",
  ];
  if (hasMarkers) order.push("canonical_video_marker_tags", "content_tag_usage", "canonical_content_tag_usage");
  for (const name of order) db.exec(tagDependentViewSql[name]);
}

export function migrateSpaces(db) {
  if (db.prepare("SELECT 1 FROM wiki_schema WHERE version=48").get()) return;
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys;
  const now = new Date().toISOString();
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE spaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 40),
        color TEXT NOT NULL DEFAULT '${DEFAULT_SPACE_COLOR}',
        sort INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        archived_at TEXT
      );
      INSERT INTO spaces(id, name, color, sort, created_at) VALUES(1, '${DEFAULT_SPACE_NAME}', '${DEFAULT_SPACE_COLOR}', 0, '${now}');
    `);

    const elementColumns = db.prepare("PRAGMA table_info(elements)").all().map((column) => column.name);
    if (!elementColumns.includes("space_id")) {
      db.exec(`ALTER TABLE elements ADD COLUMN space_id INTEGER NOT NULL DEFAULT 1 REFERENCES spaces(id)`);
    }
    db.exec("UPDATE elements SET space_id=1 WHERE space_id IS NULL OR space_id=0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_elements_space ON elements(space_id, deleted_at, updated_at DESC, id DESC)");

    // Drop every view/trigger before rebuilding tags. Some views only reference other views, so a
    // LIKE '%tags%' filter misses them and SQLite then fails mid-DROP TABLE.
    const allViews = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='view' AND sql IS NOT NULL").all();
    for (const view of allViews) db.exec(`DROP VIEW IF EXISTS "${view.name.replaceAll('"', '""')}"`);
    const allTriggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL").all();
    for (const trigger of allTriggers) db.exec(`DROP TRIGGER IF EXISTS "${trigger.name.replaceAll('"', '""')}"`);

    const tagSequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='tags'").get()?.seq || 0;
    db.exec(`
      CREATE TABLE tags_v48 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        space_id INTEGER NOT NULL REFERENCES spaces(id),
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        UNIQUE(space_id, normalized_name)
      );
      INSERT INTO tags_v48(id, space_id, name, normalized_name)
        SELECT id, 1, name, normalized_name FROM tags;
      DROP TABLE tags;
      ALTER TABLE tags_v48 RENAME TO tags;
      CREATE INDEX idx_tags_space_name ON tags(space_id, normalized_name);
    `);
    if (db.prepare("SELECT 1 FROM sqlite_sequence WHERE name='tags'").get()) {
      db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='tags'").run(tagSequence);
    } else if (tagSequence) {
      db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('tags',?)").run(tagSequence);
    }

    // Recreate content-library tag views with space_id-aware resolved_tags, then restore other views.
    recreateTagViews(db);
    const known = new Set(Object.keys(tagDependentViewSql));
    for (const view of allViews) {
      if (known.has(view.name)) continue;
      let sql = view.sql;
      // Older resolved_tags definitions omit space_id; recreateTagViews already wrote the new one.
      if (view.name === "resolved_tags") continue;
      db.exec(sql);
    }
    for (const trigger of allTriggers) db.exec(trigger.sql);

    // Seed the usual prompt aliases into the default space when missing (fresh DBs already have them).
    for (const name of ["提示词", "prompt", "prompts"]) {
      db.prepare("INSERT INTO tags(name,normalized_name,space_id) SELECT ?,?,1 WHERE NOT EXISTS(SELECT 1 FROM tags WHERE space_id=1 AND normalized_name=?)")
        .run(name, name.toLowerCase(), name.toLowerCase());
    }
    const promptId = db.prepare("SELECT id FROM tags WHERE space_id=1 AND normalized_name='提示词'").get()?.id;
    if (promptId) {
      db.prepare(`INSERT OR IGNORE INTO tag_aliases(alias_id,canonical_id)
        SELECT id,? FROM tags WHERE space_id=1 AND normalized_name IN('prompt','prompts') AND id!=?`).run(promptId, promptId);
    }

    db.exec("INSERT INTO wiki_schema VALUES(48)");
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Spaces migration foreign key check failed");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
  }
}
