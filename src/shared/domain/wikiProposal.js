import { elementContent, elementError, elementId, elementTags, relationName, relationSemantics } from './elements.js';

export function wikiProposal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw elementError("建议必须为 JSON 对象");
  const reason = typeof value.reason === "string" ? value.reason.trim().slice(0, 500) : "";
  if (!reason) throw elementError("请说明修改依据");
  const sourceIds = [...new Set((Array.isArray(value.sourceIds) ? value.sourceIds : []).map(elementId))];
  if (sourceIds.length > 12) throw elementError("一份建议最多引用 12 份资料");
  if (value.kind === "create_text") {
    return { kind: value.kind, reason, sourceIds, ...elementContent({ body: value.body, tags: value.tags || [] }) };
  }
  if (value.kind === "add_tags") {
    const tags = elementTags(value.tags); if (!tags.length) throw elementError("请提供要添加的标签");
    return { kind: value.kind, reason, sourceIds, elementId: elementId(value.elementId), tags };
  }
  if (value.kind === "add_relation") {
    const sourceId = elementId(value.sourceId), targetId = elementId(value.targetId);
    if (sourceId === targetId) throw elementError("不能关联内容自身");
    return { kind: value.kind, reason, sourceIds, sourceId, targetId, name: relationName(value.name), ...relationSemantics(value) };
  }
  throw elementError("建议类型须为 create_text、add_tags 或 add_relation");
}

