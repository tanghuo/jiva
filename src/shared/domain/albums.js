import { elementError, elementId, elementTags, maxTagLength } from "./elements.js";

export const maxAlbumTitle = 200;
export const maxAlbumSourceUrl = 2000;
export const maxAlbumItems = 2000;
export const albumSortModes = ["manual", "name", "added"];

export function albumTitle(value) {
  if (typeof value !== "string") throw elementError("图集标题必须是文字");
  const title = value.trim().normalize("NFC");
  if (!title || title.length > maxAlbumTitle || /[\u0000-\u001f\u007f]/.test(title)) {
    throw elementError("图集标题须为 1–200 字的单行文字");
  }
  return title;
}

export function albumSourceUrl(value = "") {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > maxAlbumSourceUrl) throw elementError("来源链接过长");
  const url = value.trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad");
  } catch {
    throw elementError("来源链接须为 http(s) 地址");
  }
  return url;
}

export function albumUpdate(payload, previous = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw elementError("无效的图集更新");
  const allowed = ["title", "tags", "sourceUrl", "coverImageId", "sortMode", "itemOrder"];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) throw elementError("图集只能更新标题、标签、来源、封面、排序");
  const next = {
    title: payload.title === undefined ? previous.title : albumTitle(payload.title),
    tags: payload.tags === undefined ? previous.tags || [] : elementTags(payload.tags, { existing: previous.tags || [] }),
    sourceUrl: payload.sourceUrl === undefined ? previous.sourceUrl || "" : albumSourceUrl(payload.sourceUrl),
  };
  if (payload.coverImageId !== undefined) {
    next.coverImageId = payload.coverImageId === null ? null : elementId(payload.coverImageId);
  }
  if (payload.sortMode !== undefined) {
    if (!albumSortModes.includes(payload.sortMode)) throw elementError("无效的图集排序方式");
    next.sortMode = payload.sortMode;
  }
  if (payload.itemOrder !== undefined) {
    if (!Array.isArray(payload.itemOrder) || !payload.itemOrder.length) throw elementError("请提供图集成员顺序");
    next.itemOrder = [...new Set(payload.itemOrder.map(elementId))];
  }
  return next;
}

export function albumCreateInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw elementError("无效的图集");
  const allowed = ["title", "tags", "sourceUrl", "spaceId", "createdFromPath", "material"];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) throw elementError("新建图集字段无效");
  if (payload.material !== undefined && typeof payload.material !== "boolean") throw elementError("无效的素材标记");
  const createdFromPath = payload.createdFromPath == null ? "" : String(payload.createdFromPath).slice(0, 1000);
  return {
    title: albumTitle(payload.title),
    tags: elementTags(payload.tags || []),
    sourceUrl: albumSourceUrl(payload.sourceUrl || ""),
    spaceId: payload.spaceId,
    createdFromPath,
    material: Boolean(payload.material),
  };
}

export function parentFolderTag(relativePath) {
  // File path or album dir: Alice/冬日礼服[/01.jpg] → tag candidate "Alice".
  const parts = String(relativePath || "").replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.length && /\.[a-z0-9]+$/i.test(parts.at(-1))) parts.pop();
  if (parts.length < 2) return null;
  const name = parts.at(-2).trim().normalize("NFC");
  if (!name || name.length > maxTagLength || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function albumFolderTitle(relativeDir) {
  const parts = String(relativeDir || "").replaceAll("\\", "/").split("/").filter(Boolean);
  const name = (parts.at(-1) || "图集").trim().normalize("NFC") || "图集";
  return name.slice(0, maxAlbumTitle);
}

/** Group image file paths into albums: deepest folder that contains images becomes one album. */
export function planAlbumFolders(entries) {
  // entries: [{ relativePath, fileName }]
  const byDir = new Map();
  for (const entry of entries) {
    const path = String(entry.relativePath || entry.fileName || "").replaceAll("\\", "/");
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) continue;
    const fileName = parts.at(-1);
    const dir = parts.slice(0, -1).join("/") || "";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push({ ...entry, fileName, relativePath: path });
  }
  // Only dirs that directly contain images are albums. Nested dirs with their own images are separate.
  const albums = [];
  for (const [dir, files] of [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"))) {
    if (!files.length) continue;
    const title = albumFolderTitle(dir || files[0].fileName.replace(/\.[^.]+$/, ""));
    const parentTag = dir.includes("/") ? parentFolderTag(`${dir}/x`) : null;
    // parentFolderTag on "Alice/冬日礼服/x" → Alice; on "冬日礼服/x" → null (no parent above album)
    albums.push({
      key: dir || title,
      title,
      dir,
      parentTag: dir.includes("/") ? dir.split("/").filter(Boolean).slice(0, -1).at(-1) : null,
      files: files.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" })),
    });
  }
  // Fix parentTag via trim/normalize
  return albums.map((album) => {
    let parentTag = album.parentTag;
    if (parentTag) {
      parentTag = String(parentTag).trim().normalize("NFC");
      if (!parentTag || parentTag.length > maxTagLength) parentTag = null;
    }
    return { ...album, parentTag };
  });
}
