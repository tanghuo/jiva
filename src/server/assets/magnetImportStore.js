import { mkdir, readFile, readdir, lstat, realpath, rm, statfs } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { importError } from '../../shared/domain/magnetImport.js';
import { maxAlbumItems, planAlbumFolders } from '../../shared/domain/albums.js';
import { maxImageBytes } from '../../shared/domain/elements.js';

const imageExt = /\.(png|jpe?g|webp|gif)$/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function createMagnetImportStore({ dataDir, adapter, inspect, limits }) {
  let base = path.resolve(dataDir, 'magnet-import-cache');
  async function directory(id) {
    if (!Number.isSafeInteger(id) || id < 1) throw importError('无效任务 ID');
    await mkdir(base, { recursive: true });
    if ((await lstat(base)).isSymbolicLink()) throw importError('缓存目录不可为链接', 409);
    base = await realpath(base);
    const root = path.join(base, String(id)); await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw importError('缓存目录不可为链接', 409);
    return root;
  }
  async function location(id, relative) {
    const root = await directory(id), target = path.resolve(root, relative), rel = path.relative(root, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw importError('缓存路径越界');
    let ancestor = root;
    for (const part of rel.split(path.sep)) {
      ancestor = path.join(ancestor, part);
      try { if ((await lstat(ancestor)).isSymbolicLink()) throw importError('缓存路径不可为链接'); }
      catch (error) { if (error.code === 'ENOENT') break; throw error; }
    }
    try { if (await realpath(target) !== target) throw importError('缓存路径不可为链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return target;
  }
  async function space(id, bytes) {
    const stats = await statfs(await directory(id));
    if (Number(stats.bavail) * Number(stats.bsize) < bytes + limits.freeBytes) throw importError('磁盘余量不足，请清理后重试', 409, 'DISK_FULL');
  }
  async function verified(id, file) {
    let bytes;
    try {
      const target = await location(id, file.local);
      if ((await lstat(target)).size > maxImageBytes) throw new Error('changed');
      bytes = await readFile(target);
    } catch { throw importError('准备文件缺失或发生变化，需要重新生成并确认计划', 409, 'PLAN_CHANGED'); }
    if (bytes.length !== file.bytes || hash(bytes) !== file.hash) throw importError('准备文件发生变化，需要重新生成并确认计划', 409, 'PLAN_CHANGED');
    return bytes;
  }
  async function usage(id) {
    async function walk(dir) { let n = 0; for (const e of await readdir(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); const st = await lstat(f); if (st.isSymbolicLink()) throw importError('缓存含链接'); n += st.isDirectory() ? await walk(f) : st.size; } return n; }
    return walk(await directory(id));
  }
  const store = {
    directory, location, verified, usage,
    async download(run, file, call, signal) {
      const local = `files/${file.id}${path.extname(file.name).toLowerCase()}`;
      const target = await location(run.id, local);
      try {
        const st = await lstat(target);
        if (st.size === file.size && file.sha1) {
          const digest = createHash('sha1');
          for await (const chunk of createReadStream(target)) digest.update(chunk);
          if (digest.digest('hex').toLowerCase() === file.sha1.toLowerCase()) return local;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await space(run.id, file.size);
      await mkdir(path.dirname(target), { recursive: true });
      for (const name of await readdir(path.dirname(target))) if (name.endsWith('.part')) await rm(await location(run.id, `files/${name}`), { force: true });
      await call('download', { id: file.id, root: path.dirname(target), target: path.basename(target), limit: limits.downloadBytes }, { signal, timeout: limits.stageMs });
      return local;
    },
    async prepare(run, signal) {
      const entries = [], skipped = [...(run.skipped || [])];
      let total = 0, count = 0;
      async function scan(local, relativePath) {
        signal?.throwIfAborted();
        const target = await location(run.id, local), st = await lstat(target);
        if (st.isSymbolicLink()) throw importError('禁止扫描链接');
        if (st.isDirectory()) { for (const name of (await readdir(target)).sort()) await scan(`${local}/${name}`, `${relativePath}/${name}`); return; }
        if (++count > limits.files || (total += st.size) > limits.extractedBytes) throw importError('扫描文件数或字节数超限', 413);
        if (!imageExt.test(relativePath) || st.size > maxImageBytes) { skipped.push({ path: relativePath, reason: imageExt.test(relativePath) ? '图片超过 25 MiB' : '非支持图片格式' }); return; }
        const bytes = await readFile(target);
        let metadata;
        try { metadata = await inspect(bytes); }
        catch (error) { skipped.push({ path: relativePath, reason: error.message }); return; }
        const digest = hash(bytes);
        entries.push({ key: `${relativePath}:${digest}`, local, relativePath, fileName: path.basename(relativePath), hash: digest, bytes: bytes.length, mime: `image/${metadata.format}` });
      }
      for (const file of run.files) {
        if (!file.local) continue;
        if (/\.zip$/i.test(file.name)) {
          await space(run.id, limits.extractedBytes - total);
          const relative = `extracted/${file.id}`, extracted = await location(run.id, relative);
          await rm(extracted, { recursive: true, force: true });
          const result = await adapter.extract({ root: extracted, target: await location(run.id, file.local), limit: limits.extractedBytes - total, maxFiles: limits.files - count }, { signal, timeout: limits.stageMs });
          skipped.push(...result.skipped.map(s => ({ ...s, path: `${file.relativePath}/${s.path}` })));
          await scan(relative, file.relativePath.replace(/\.zip$/i, ''));
        } else await scan(file.local, file.relativePath);
      }
      const candidates = planAlbumFolders(entries).map(a => ({ key: a.dir || a.key, title: a.title, tags: a.parentTag ? [a.parentTag] : [], files: a.files, selected: true, overLimit: a.files.length > maxAlbumItems }));
      return { version: randomUUID(), candidates, skipped, confirmed: null };
    },
    async clean(run, keepArchives = false) {
      const root = await directory(run.id);
      if (keepArchives) {
        for (const name of await readdir(root)) {
          if (name === 'files') {
            for (const file of await readdir(path.join(root, name))) if (!/\.zip$/i.test(file)) await rm(await location(run.id, `files/${file}`), { force: true });
          } else await rm(await location(run.id, name), { recursive: true, force: true });
        }
      } else {
        // Absolute root and resolved containment verified by directory(), immediately before removal.
        if (path.dirname(root) !== base || await realpath(root) !== root) throw importError('缓存路径越界');
        await rm(root, { recursive: true, force: true });
      }
      return keepArchives ? usage(run.id) : 0;
    },
  };
  return store;
}
