import { planAlbumFolders } from "../../shared/domain/albums.js";

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const SKIP_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export function isImageFileName(name) {
  return IMAGE_RE.test(name || "") && !SKIP_NAMES.has(String(name).toLowerCase());
}

export function summarizeDroppedFiles(fileList) {
  const files = [...fileList || []];
  const images = [];
  let skipped = 0;
  let videos = 0;
  for (const item of files) {
    const file = item.file || item;
    const relativePath = item.relativePath || file.webkitRelativePath || file.name;
    const base = relativePath.split(/[\\/]/).pop();
    if (SKIP_NAMES.has(base.toLowerCase()) || base.startsWith(".")) { skipped++; continue; }
    if (/\.(mp4|m4v|webm|mov)$/i.test(base)) { videos++; skipped++; continue; }
    if (!isImageFileName(base)) { skipped++; continue; }
    images.push({ file, relativePath, fileName: base });
  }
  const albums = planAlbumFolders(images).map((album) => ({
    ...album,
    applyParentTag: Boolean(album.parentTag),
    sourceUrl: "",
    title: album.title,
  }));
  return { albums, skipped, videos, looseImages: images.filter((item) => !item.relativePath.includes("/") && !item.relativePath.includes("\\")) };
}

export async function collectEntryFiles(entry, pathPrefix = "") {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const relativePath = `${pathPrefix}${file.name}`;
    return [{ file, relativePath, fileName: file.name }];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await new Promise((resolve, reject) => {
      const all = [];
      const read = () => reader.readEntries((batch) => {
        if (!batch.length) resolve(all);
        else { all.push(...batch); read(); }
      }, reject);
      read();
    });
    const nested = [];
    for (const child of entries) nested.push(...await collectEntryFiles(child, `${pathPrefix}${entry.name}/`));
    return nested;
  }
  return [];
}

export async function collectDataTransferAlbums(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const fallbackFiles = [...(dataTransfer?.files || [])];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (items.some((item) => item.webkitGetAsEntry)) {
    const collected = [];
    for (const entry of entries) {
      collected.push(...await collectEntryFiles(entry));
    }
    if (collected.length) {
      return summarizeDroppedFiles(collected);
    }
  }
  return summarizeDroppedFiles(fallbackFiles);
}
