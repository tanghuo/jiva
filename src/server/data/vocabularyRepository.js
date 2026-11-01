import { elementError } from "../../shared/domain/elements.js";
import { relationRoleTerms } from "../../shared/domain/relationRoles.js";

function defaultSpaceId(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spaces'").get()) return null;
  return db.prepare("SELECT id FROM spaces WHERE archived_at IS NULL ORDER BY sort, id LIMIT 1").get()?.id ?? null;
}

export function createVocabularyRepository(db) {
  const hasMarkers = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name='content_tag_usage'").get());
  const hasSpaces = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='spaces'").get());
  const usage = hasMarkers ? "content_tag_usage" : "element_tags";
  const canonicalUsage = hasMarkers ? "canonical_content_tag_usage" : "canonical_element_tags";

  function resolveSpace(spaceId) {
    if (!hasSpaces) return null;
    if (spaceId === undefined || spaceId === null || spaceId === "") return defaultSpaceId(db);
    const row = db.prepare("SELECT id FROM spaces WHERE id=? AND archived_at IS NULL").get(Number(spaceId));
    if (!row) throw elementError("空间不存在", 404);
    return row.id;
  }

  function tag(name, spaceId) {
    const sid = resolveSpace(spaceId);
    const normalized = name.trim().normalize("NFC").toLowerCase();
    if (sid == null) {
      return db.prepare("SELECT c.canonical_id AS id,c.name,c.normalized_name AS normalizedName FROM tags t JOIN resolved_tags c ON c.id=t.id WHERE t.normalized_name=?")
        .get(normalized);
    }
    return db.prepare("SELECT c.canonical_id AS id,c.name,c.normalized_name AS normalizedName,c.space_id AS spaceId FROM tags t JOIN resolved_tags c ON c.id=t.id WHERE t.space_id=? AND t.normalized_name=?")
      .get(sid, normalized);
  }

  function relation(value) {
    const { name, reverseName = "", direction = "symmetric" } = value;
    if (!["symmetric", "forward", "reverse"].includes(direction)) return { name, reverseName, direction };
    const term = db.prepare(`SELECT c.name,c.reverse_name FROM relation_terms t JOIN resolved_relation_terms c ON c.id=t.id
      WHERE t.name=? AND t.reverse_name=? AND t.directed=?`).get(name, reverseName, Number(direction !== "symmetric"));
    return { name: term?.name ?? name, reverseName: term?.reverse_name ?? reverseName, direction };
  }

  function ensureTerm(kind, value, spaceId) {
    if (kind === "tag") {
      const sid = resolveSpace(spaceId);
      if (sid == null) {
        db.prepare("INSERT INTO tags(name,normalized_name) VALUES(?,?) ON CONFLICT(normalized_name) DO NOTHING").run(value.name, value.name.toLowerCase());
        return db.prepare("SELECT id FROM tags WHERE normalized_name=?").get(value.name.toLowerCase()).id;
      }
      db.prepare("INSERT INTO tags(name,normalized_name,space_id) VALUES(?,?,?) ON CONFLICT(space_id,normalized_name) DO NOTHING")
        .run(value.name, value.name.toLowerCase(), sid);
      return db.prepare("SELECT id FROM tags WHERE space_id=? AND normalized_name=?").get(sid, value.name.toLowerCase()).id;
    }
    const args = [value.name, value.reverseName, Number(value.direction === "forward")];
    db.prepare("INSERT INTO relation_terms(name,reverse_name,directed) VALUES(?,?,?) ON CONFLICT(name,reverse_name,directed) DO NOTHING").run(...args);
    return db.prepare("SELECT id FROM relation_terms WHERE name=? AND reverse_name=? AND directed=?").get(...args).id;
  }

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  return {
    tag, relation, resolveSpace,
    relationRoles: () => relationRoleTerms.map((term) => ({ ...term, ...relation(term) })),
    tags(names, spaceId) { return [...new Set(names.map((name) => tag(name, spaceId)?.normalizedName ?? name.toLowerCase()))]; },
    tagAliases({ publicOnly = false, activeOnly = false, spaceId } = {}) {
      const sid = resolveSpace(spaceId);
      const spaceClause = sid == null ? "" : " AND t.space_id=? AND c.space_id=?";
      const params = sid == null ? [Number(activeOnly)] : [Number(activeOnly), sid, sid];
      return db.prepare(`SELECT t.name AS alias,c.name FROM tags t JOIN resolved_tags c ON c.id=t.id WHERE t.id!=c.canonical_id
        AND EXISTS(SELECT 1 FROM ${canonicalUsage} et JOIN elements e ON e.id=et.element_id WHERE et.tag_id=c.canonical_id
          AND (?=0 OR e.deleted_at IS NULL)${publicOnly ? " AND e.local_only=0" : ""})${spaceClause} ORDER BY t.normalized_name`).all(...params);
    },
    read({ spaceId } = {}) {
      const sid = resolveSpace(spaceId);
      const spaceFilter = sid == null ? "" : " AND t.space_id=?";
      const spaceParams = sid == null ? [] : [sid];
      const tags = db.prepare(`SELECT t.id,t.name,c.canonical_id AS canonicalId,c.name AS canonicalName,
        (SELECT count(*) FROM ${usage} et JOIN elements e ON e.id=et.element_id WHERE et.tag_id=t.id AND e.deleted_at IS NULL) AS count,
        (SELECT count(*) FROM ${canonicalUsage} et JOIN elements e ON e.id=et.element_id WHERE et.tag_id=c.canonical_id AND e.deleted_at IS NULL) AS total,
        (SELECT json_group_array(json_object('id',id,'label',label)) FROM (SELECT e.id,substr(e.body,1,90) AS label FROM ${usage} et
          JOIN elements e ON e.id=et.element_id WHERE et.tag_id=t.id AND e.deleted_at IS NULL ORDER BY e.id DESC LIMIT 3)) AS examples
        FROM tags t JOIN resolved_tags c ON c.id=t.id
        WHERE (EXISTS(SELECT 1 FROM ${usage} et WHERE et.tag_id=t.id) OR EXISTS(SELECT 1 FROM tag_aliases a WHERE a.alias_id=t.id OR a.canonical_id=t.id))${spaceFilter}
        ORDER BY t.normalized_name`).all(...spaceParams).map((r) => ({ ...r, examples: JSON.parse(r.examples) }));
      const relations = db.prepare(`WITH usage AS (
        SELECT r.name,r.reverse_name,abs(r.direction) AS directed,r.source_id,r.target_id FROM element_relations r
          JOIN elements s ON s.id=r.source_id JOIN elements t ON t.id=r.target_id WHERE r.kind=1 AND r.direction IN(-1,0,1) AND r.name!='' AND s.deleted_at IS NULL AND t.deleted_at IS NULL
        UNION ALL SELECT r.name,r.reverse_name,abs(r.direction),r.source_id,NULL FROM tag_relations r JOIN elements s ON s.id=r.source_id WHERE r.direction IN(-1,0,1) AND r.name!='' AND s.deleted_at IS NULL
      ), terms AS (SELECT name,reverse_name,directed FROM relation_terms UNION SELECT name,reverse_name,directed FROM usage)
      SELECT t.name,t.reverse_name AS reverseName,CASE t.directed WHEN 1 THEN 'forward' ELSE 'symmetric' END AS direction,
        coalesce(c.name,t.name) AS canonicalName,coalesce(c.reverse_name,t.reverse_name) AS canonicalReverseName,
        (SELECT count(*) FROM usage u WHERE u.name=t.name AND u.reverse_name=t.reverse_name AND u.directed=t.directed) AS count,
        (SELECT json_group_array(json_object('id',id,'label',label)) FROM (SELECT DISTINCT e.id,substr(e.body,1,90) AS label FROM usage u
          JOIN elements e ON e.id=u.source_id WHERE u.name=t.name AND u.reverse_name=t.reverse_name AND u.directed=t.directed ORDER BY e.id DESC LIMIT 3)) AS examples
      FROM terms t LEFT JOIN relation_terms raw ON raw.name=t.name AND raw.reverse_name=t.reverse_name AND raw.directed=t.directed
      LEFT JOIN resolved_relation_terms c ON c.id=raw.id ORDER BY t.name,t.reverse_name`).all().map((r) => ({ ...r, examples: JSON.parse(r.examples) }));
      const aliases = [
        ...db.prepare(`SELECT a.alias_id AS id,t.name AS alias,c.name AS canonical FROM tag_aliases a JOIN tags t ON t.id=a.alias_id JOIN tags c ON c.id=a.canonical_id
          ${sid == null ? "" : "WHERE t.space_id=? AND c.space_id=?"} ORDER BY t.name`).all(...(sid == null ? [] : [sid, sid])).map((r) => ({ ...r, kind: "tag" })),
        ...db.prepare(`SELECT a.alias_id AS id,t.name AS alias,t.reverse_name AS aliasReverseName,c.name AS canonical,c.reverse_name AS canonicalReverseName,
          CASE t.directed WHEN 1 THEN 'forward' ELSE 'symmetric' END AS direction FROM relation_aliases a JOIN relation_terms t ON t.id=a.alias_id JOIN relation_terms c ON c.id=a.canonical_id ORDER BY t.name`).all().map((r) => ({ ...r, kind: "relation" })),
      ];
      return { tags, relations, aliases };
    },
    setAlias({ kind, alias, canonical, spaceId }) {
      return transaction(() => {
        const source = ensureTerm(kind, alias, spaceId), target = ensureTerm(kind, canonical, spaceId);
        const table = kind === "tag" ? "tag_aliases" : "relation_aliases", view = kind === "tag" ? "resolved_tags" : "resolved_relation_terms";
        if (kind === "tag" && hasSpaces) {
          const spaces = db.prepare("SELECT space_id FROM tags WHERE id IN(?,?)").all(source, target);
          if (spaces.length === 2 && spaces[0].space_id !== spaces[1].space_id) throw elementError("别名只能连接同一空间的标签");
        }
        const root = db.prepare(`SELECT canonical_id FROM ${view} WHERE id=?`).get(target).canonical_id;
        if (source === target || source === root) throw elementError("别名不能指向自身或形成循环");
        const old = db.prepare(`SELECT canonical_id FROM ${table} WHERE alias_id=?`).get(source);
        if (old && old.canonical_id !== target) throw elementError("这个名称已有别名规则，请先解除后再修改", 409);
        if (!old) {
          db.prepare(`INSERT INTO ${table}(alias_id,canonical_id) VALUES(?,?)`).run(source, target);
          db.exec("UPDATE organization_state SET epoch=epoch+1 WHERE id=1");
        }
        return { id: source, kind };
      });
    },
    removeAlias(kind, id) {
      return transaction(() => {
        const table = kind === "tag" ? "tag_aliases" : "relation_aliases";
        if (!db.prepare(`DELETE FROM ${table} WHERE alias_id=?`).run(id).changes) throw elementError("别名规则不存在或已解除", 404);
        db.exec("UPDATE organization_state SET epoch=epoch+1 WHERE id=1");
        return { ok: true };
      });
    },
  };
}
