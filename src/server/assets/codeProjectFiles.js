import { readdir, realpath, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__', 'venv', 'target']);
const rootIgnored = new Set(['data', 'data-smoke', 'data-migration-smoke', 'release', 'run', 'demos']);
const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.css', '.html', '.py', '.sql', '.yml', '.yaml', '.toml']);
export const codeProjectLimits = { files: 1800, entries: 16000, fileBytes: 384 * 1024, totalBytes: 16 * 1024 * 1024 };
export const projectError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export function insideProject(root, file) {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
export function visibleProjectPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1000 && !value.includes('\\') && !value.includes('\0')
    && !value.split('/').some(part => !part || part === '..' || part.startsWith('.') || ignored.has(part))
    && !/^(?:credentials?|secrets?|tokens?)(?:[.-]|$)/i.test(path.basename(value))
    && extensions.has(path.extname(value).toLowerCase());
}
export async function canonicalProject(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || /^(?:\\\\|\/\/)/.test(value)
    || process.platform === 'win32' && (value.slice(2).includes(':') || /[<>"|?*]/.test(value))) throw projectError(400, '请填写本机项目的绝对目录路径');
  let root;
  try { root = await realpath(value); } catch { throw projectError(404, '项目目录不存在或不可读取'); }
  if (root === path.parse(root).root || !(await lstat(root)).isDirectory()) throw projectError(400, '请选择具体项目目录，不能打开整个磁盘');
  return root;
}
export async function scanProject(root) {
  const files = [], texts = new Map(), warnings = [];
  let bytes = 0, visited = 0, truncated = false;
  const queue = [{ dir: root, relative: '' }];
  while (queue.length && !truncated) {
    const { dir, relative } = queue.shift();
    let entries;
    try {
      if ((await lstat(dir)).isSymbolicLink() || !insideProject(root, await realpath(dir))) continue;
      entries = await readdir(dir, { withFileTypes: true });
    } catch { warnings.push(`无法读取目录：${relative || '.'}`); continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visited > codeProjectLimits.entries || files.length >= codeProjectLimits.files || bytes >= codeProjectLimits.totalBytes) { truncated = true; break; }
      if (entry.name.startsWith('.') || ignored.has(entry.name) || !relative && rootIgnored.has(entry.name) || entry.isSymbolicLink()) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) { queue.push({ dir: absolute, relative: rel }); continue; }
      if (!entry.isFile() || !visibleProjectPath(rel)) continue;
      try {
        const resolved = await realpath(absolute), info = await lstat(absolute);
        if (!insideProject(root, resolved) || info.isSymbolicLink() || !info.isFile()) continue;
        if (info.size > codeProjectLimits.fileBytes) { warnings.push(`文件过大，未索引：${rel}`); continue; }
        if (bytes + info.size > codeProjectLimits.totalBytes) { truncated = true; break; }
        const buffer = await readFile(absolute);
        if (buffer.length > codeProjectLimits.fileBytes || bytes + buffer.length > codeProjectLimits.totalBytes) { warnings.push(`文件在扫描时变大，已跳过：${rel}`); continue; }
        if (buffer.includes(0)) continue;
        // Revalidate after reading, before retaining the snapshot.
        if (!insideProject(root, await realpath(absolute)) || (await lstat(absolute)).isSymbolicLink()) continue;
        const text = buffer.toString('utf8');
        bytes += buffer.length; texts.set(rel, text);
        files.push({ path: rel, bytes: buffer.length, lines: text.split('\n').length, extension: path.extname(rel).slice(1) });
      } catch { warnings.push(`读取失败：${rel}`); }
    }
  }
  return { files, texts, bytes, truncated, warnings: warnings.slice(0, 40) };
}
