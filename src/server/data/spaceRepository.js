import { elementError } from "../../shared/domain/elements.js";
import { DEFAULT_SPACE_COLOR, DEFAULT_SPACE_NAME, spaceCreateInput, spaceMoveInput, spaceUpdateInput } from "../../shared/domain/spaces.js";

function present(row) {
  if (!row) throw elementError("空间不存在", 404);
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sort: row.sort,
    createdAt: row.created_at,
    archivedAt: row.archived_at || null,
    elementCount: row.element_count ?? undefined,
  };
}

function seedPromptAliases(db, spaceId) {
  for (const name of ["提示词", "prompt", "prompts"]) {
    db.prepare("INSERT INTO tags(name,normalized_name,space_id) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM tags WHERE space_id=? AND normalized_name=?)")
      .run(name, name.toLowerCase(), spaceId, spaceId, name.toLowerCase());
  }
  const promptId = db.prepare("SELECT id FROM tags WHERE space_id=? AND normalized_name='提示词'").get(spaceId)?.id;
  if (!promptId) return;
  db.prepare(`INSERT OR IGNORE INTO tag_aliases(alias_id,canonical_id)
    SELECT id,? FROM tags WHERE space_id=? AND normalized_name IN('prompt','prompts') AND id!=?`).run(promptId, spaceId, promptId);
}

/** Ensure a tag with the same display/normalized name exists in targetSpaceId; return its id. */
function ensureTagInSpace(db, tagRow, targetSpaceId) {
  const existing = db.prepare("SELECT id FROM tags WHERE space_id=? AND normalized_name=?").get(targetSpaceId, tagRow.normalized_name);
  if (existing) return existing.id;
  const result = db.prepare("INSERT INTO tags(name,normalized_name,space_id) VALUES(?,?,?)").run(tagRow.name, tagRow.normalized_name, targetSpaceId);
  return Number(result.lastInsertRowid);
}

export function createSpaceRepository(db) {
  function transaction(fn) {
    if (db.isTransaction) return fn();
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function get(id) {
    return present(db.prepare(`SELECT s.*,
      (SELECT count(*) FROM elements e WHERE e.space_id=s.id AND e.deleted_at IS NULL AND e.kind IN(1,2,5)) AS element_count
      FROM spaces s WHERE s.id=? AND s.archived_at IS NULL`).get(id));
  }

  function defaultSpace() {
    const row = db.prepare("SELECT * FROM spaces WHERE archived_at IS NULL ORDER BY sort, id LIMIT 1").get();
    if (!row) throw elementError("没有可用的空间", 500);
    return present(row);
  }

  function resolveSpaceId(spaceId) {
    if (spaceId === undefined || spaceId === null || spaceId === "") return defaultSpace().id;
    const row = db.prepare("SELECT id FROM spaces WHERE id=? AND archived_at IS NULL").get(Number(spaceId));
    if (!row) throw elementError("空间不存在", 404);
    return row.id;
  }

  return {
    list() {
      return db.prepare(`SELECT s.*,
        (SELECT count(*) FROM elements e WHERE e.space_id=s.id AND e.deleted_at IS NULL AND e.kind IN(1,2,5)) AS element_count
        FROM spaces s WHERE s.archived_at IS NULL ORDER BY s.sort, s.id`).all().map(present);
    },
    get,
    defaultSpace,
    resolveSpaceId,
    create(payload) {
      const input = spaceCreateInput(payload);
      return transaction(() => {
        const sort = (db.prepare("SELECT coalesce(max(sort),-1)+1 AS next FROM spaces WHERE archived_at IS NULL").get().next) || 0;
        const now = new Date().toISOString();
        const result = db.prepare("INSERT INTO spaces(name,color,sort,created_at) VALUES(?,?,?,?)")
          .run(input.name, input.color, sort, now);
        const id = Number(result.lastInsertRowid);
        seedPromptAliases(db, id);
        return get(id);
      });
    },
    update(id, payload) {
      const input = spaceUpdateInput(payload);
      return transaction(() => {
        get(id);
        if (input.name !== undefined) db.prepare("UPDATE spaces SET name=? WHERE id=?").run(input.name, id);
        if (input.color !== undefined) db.prepare("UPDATE spaces SET color=? WHERE id=?").run(input.color, id);
        return get(id);
      });
    },
    remove(id) {
      return transaction(() => {
        const space = get(id);
        const remaining = db.prepare("SELECT count(*) AS n FROM spaces WHERE archived_at IS NULL").get().n;
        if (remaining <= 1) throw elementError("不能删除最后一个空间", 409);
        const content = db.prepare("SELECT count(*) AS n FROM elements WHERE space_id=? AND deleted_at IS NULL AND kind IN(1,2,5)").get(id).n;
        const trash = db.prepare("SELECT count(*) AS n FROM elements WHERE space_id=? AND deleted_at IS NOT NULL").get(id).n;
        if (content + trash > 0) throw elementError("请先把空间里的内容搬走或清空回收站，再删除空间", 409);
        // Soft-archive keeps historical FK rows stable; UI never lists archived spaces.
        db.prepare("UPDATE spaces SET archived_at=? WHERE id=?").run(new Date().toISOString(), id);
        return { ok: true, id: space.id };
      });
    },
    moveElements(fromSpaceId, payload) {
      const { ids, targetSpaceId } = spaceMoveInput(payload);
      return transaction(() => {
        const sourceId = resolveSpaceId(fromSpaceId);
        const targetId = resolveSpaceId(targetSpaceId);
        if (sourceId === targetId) throw elementError("内容已在目标空间", 400);
        get(sourceId); get(targetId);
        const encoded = JSON.stringify(ids);
        const rows = db.prepare(`SELECT id FROM elements WHERE id IN(SELECT value FROM json_each(?)) AND space_id=? AND deleted_at IS NULL AND kind IN(1,2,5)`)
          .all(encoded, sourceId);
        if (rows.length !== ids.length) throw elementError("部分内容不存在、已删除或不在当前空间", 409);

        // Remap tags used by these elements (and their video markers) into the target space.
        const tagIds = db.prepare(`SELECT DISTINCT tag_id AS id FROM element_tags WHERE element_id IN(SELECT value FROM json_each(?))
          UNION SELECT DISTINCT mt.tag_id FROM video_marker_tags mt JOIN video_markers m ON m.id=mt.marker_id
            WHERE m.video_id IN(SELECT value FROM json_each(?))
          UNION SELECT DISTINCT tag_id FROM tag_relations WHERE source_id IN(SELECT value FROM json_each(?))
          UNION SELECT DISTINCT b.tag_id FROM organization_bindings b WHERE b.element_id IN(SELECT value FROM json_each(?)) AND b.tag_id IS NOT NULL`)
          .all(encoded, encoded, encoded, encoded);
        const tagMap = new Map();
        for (const { id: tagId } of tagIds) {
          const tag = db.prepare("SELECT id,name,normalized_name,space_id FROM tags WHERE id=?").get(tagId);
          if (!tag) continue;
          tagMap.set(tagId, ensureTagInSpace(db, tag, targetId));
        }
        for (const [from, to] of tagMap) {
          if (from === to) continue;
          db.prepare(`UPDATE element_tags SET tag_id=? WHERE element_id IN(SELECT value FROM json_each(?)) AND tag_id=?
            AND NOT EXISTS(SELECT 1 FROM element_tags et WHERE et.element_id=element_tags.element_id AND et.tag_id=?)`)
            .run(to, encoded, from, to);
          db.prepare("DELETE FROM element_tags WHERE element_id IN(SELECT value FROM json_each(?)) AND tag_id=?").run(encoded, from);
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='video_marker_tags'").get()) {
            db.prepare(`UPDATE video_marker_tags SET tag_id=? WHERE marker_id IN(
              SELECT id FROM video_markers WHERE video_id IN(SELECT value FROM json_each(?))) AND tag_id=?
              AND NOT EXISTS(SELECT 1 FROM video_marker_tags x WHERE x.marker_id=video_marker_tags.marker_id AND x.tag_id=?)`)
              .run(to, encoded, from, to);
            db.prepare(`DELETE FROM video_marker_tags WHERE marker_id IN(
              SELECT id FROM video_markers WHERE video_id IN(SELECT value FROM json_each(?))) AND tag_id=?`).run(encoded, from);
          }
          db.prepare(`UPDATE tag_relations SET tag_id=? WHERE source_id IN(SELECT value FROM json_each(?)) AND tag_id=?
            AND NOT EXISTS(SELECT 1 FROM tag_relations r WHERE r.source_id=tag_relations.source_id AND r.tag_id=? AND r.name=tag_relations.name)`)
            .run(to, encoded, from, to);
          db.prepare("DELETE FROM tag_relations WHERE source_id IN(SELECT value FROM json_each(?)) AND tag_id=?").run(encoded, from);
          if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organization_bindings'").get()) {
            db.prepare("UPDATE organization_bindings SET tag_id=? WHERE element_id IN(SELECT value FROM json_each(?)) AND tag_id=?")
              .run(to, encoded, from);
          }
        }

        // Drop relations that would become cross-space (other end stays in source / other space).
        const broken = db.prepare(`SELECT id FROM element_relations WHERE
          (source_id IN(SELECT value FROM json_each(?)) OR target_id IN(SELECT value FROM json_each(?)))
          AND NOT (
            source_id IN(SELECT value FROM json_each(?)) AND target_id IN(SELECT value FROM json_each(?))
          )
          AND NOT (
            (source_id IN(SELECT value FROM json_each(?)) AND target_id IN(SELECT id FROM elements WHERE space_id=? AND deleted_at IS NULL))
            OR (target_id IN(SELECT value FROM json_each(?)) AND source_id IN(SELECT id FROM elements WHERE space_id=? AND deleted_at IS NULL))
          )`).all(encoded, encoded, encoded, encoded, encoded, targetId, encoded, targetId);
        // Simpler: after move, delete any relation whose ends differ in space_id.
        db.prepare("UPDATE elements SET space_id=?, updated_at=? WHERE id IN(SELECT value FROM json_each(?))")
          .run(targetId, new Date().toISOString(), encoded);
        const dropped = db.prepare(`SELECT id FROM element_relations WHERE
          (SELECT space_id FROM elements WHERE id=source_id) != (SELECT space_id FROM elements WHERE id=target_id)`).all();
        for (const { id } of dropped) {
          db.prepare("DELETE FROM element_provenance WHERE relation_id=?").run(id);
          db.prepare("DELETE FROM organization_bindings WHERE relation_id=?").run(id);
          db.prepare("DELETE FROM element_relations WHERE id=?").run(id);
        }
        // Canvas is per-element; remove nodes from the source space canvas.
        db.prepare("DELETE FROM canvas_positions WHERE element_id IN(SELECT value FROM json_each(?))").run(encoded);
        // Tag relations whose tag ended up in a different space than the source element should go.
        db.prepare(`DELETE FROM tag_relations WHERE source_id IN(SELECT value FROM json_each(?))
          AND (SELECT space_id FROM tags WHERE id=tag_id) != (SELECT space_id FROM elements WHERE id=source_id)`).run(encoded);

        return {
          ok: true,
          movedIds: ids,
          targetSpaceId: targetId,
          relationsDropped: dropped.length + broken.length,
        };
      });
    },
  };
}

/** Used by brand-new databases after migrateCore so spaces exist even before version 48 ordering issues. */
export function ensureDefaultSpaceRow(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spaces'").get()) return null;
  let row = db.prepare("SELECT * FROM spaces WHERE archived_at IS NULL ORDER BY sort, id LIMIT 1").get();
  if (row) return row.id;
  const now = new Date().toISOString();
  const result = db.prepare("INSERT INTO spaces(name,color,sort,created_at) VALUES(?,?,0,?)")
    .run(DEFAULT_SPACE_NAME, DEFAULT_SPACE_COLOR, now);
  return Number(result.lastInsertRowid);
}
