import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);

export async function clipboardFolderFiles() {
  if (process.platform !== 'win32') return null;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
    "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; ConvertTo-Json -Compress -InputObject @([System.Windows.Forms.Clipboard]::GetFileDropList())"],
  { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
  return collectFolderFiles(JSON.parse(stdout.trim() || '[]'));
}

// Only clipboard-owned roots reach this function; renderer callers cannot supply paths.
export async function collectFolderFiles(roots, { maxFiles = 2000, maxBytes = 256 * 1024 * 1024 } = {}) {
  const files = [];
  let folders = 0, bytes = 0, visited = 0;
  async function visit(target, relativePath) {
    if (++visited > 20000) throw new Error('文件夹项目过多，请分批导入。');
    const info = await lstat(target);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const entry of await readdir(target, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        await visit(path.join(target, entry.name), `${relativePath}/${entry.name}`);
      }
    } else if (info.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(target)) {
      if (files.length >= maxFiles || bytes + info.size > maxBytes) throw new Error('文件夹图片超过 2000 张或 256 MiB，请分批导入。');
      const data = await readFile(target);
      bytes += data.length;
      if (bytes > maxBytes) throw new Error('文件夹图片超过 256 MiB，请分批导入。');
      files.push({ name: path.basename(target), relativePath, bytes: data });
    }
  }
  for (const root of roots) {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    folders++;
    await visit(root, path.basename(root));
  }
  return folders ? { files } : null;
}
