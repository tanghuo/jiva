import { createHash } from 'node:crypto';
import { elementError } from '../../shared/domain/elements.js';
import { createElementRepository } from './elementRepository.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createWikiSnapshots(db) {
  const wiki = createElementRepository(db);
  function snapshot(id) {
    const e = wiki.get(id);
    if (e.kind === "video") throw elementError("视频暂不支持作为 Agent 参考，请使用关联文字或截图");
    const version = db.prepare("SELECT content_version FROM elements WHERE id=?").get(id).content_version;
    // Adding an archive's factual reference does not edit the referenced content.
    const relations = db.prepare(`SELECT id,source_id,target_id,kind,name,direction,reverse_name FROM canonical_element_relations r
      WHERE (source_id=? OR target_id=?) AND NOT EXISTS (SELECT 1 FROM element_provenance p WHERE p.relation_id=r.id) ORDER BY id`).all(id, id)
      .map(({ direction, reverse_name, ...row }) => Math.abs(direction) === 1 ? { ...row, direction, reverse_name } : row);
    return { id, kind: e.kind, label: e.kind === "image" ? e.image.originalName : e.body.slice(0, 70), body: e.body, tags: e.tags,
      ...(e.record ? { record: { kind: e.record.kind, sessionId: e.record.sessionId, turnId: e.record.turnId, model: e.record.model, text: e.record.text, parameters: e.record.parameters } } : {}),
      fingerprint: hash({ version, body: e.body, tags: e.tags, relations, ...(e.record ? { record: e.record } : {}) }) };
  }
  function unchanged(snapshots) {
    for (const source of snapshots) {
      let current; try { current = snapshot(source.id); } catch { throw elementError("引用内容已删除或移入回收站，请重新读取后生成建议", 409); }
      if (current.fingerprint !== source.fingerprint) throw Object.assign(elementError(`引用内容 wiki:${source.id} 已有修改，请重新读取后生成建议`, 409), { code: "CHAT_SOURCE_CHANGED" });
    }
  }
  return { snapshot, unchanged };
}
