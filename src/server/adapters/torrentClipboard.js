import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile } from 'node:fs/promises';
import { childEnvironment } from '../../shared/runtime/childEnvironment.js';
import { torrentMagnet } from '../assets/torrentMagnet.js';

export async function clipboardTorrent({ roots, run = promisify(execFile) } = {}) {
  if (!roots) {
    if (process.platform !== 'win32') return null;
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; ConvertTo-Json -Compress -InputObject @([System.Windows.Forms.Clipboard]::GetFileDropList())"], { env: childEnvironment(), windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    roots = JSON.parse(stdout.trim() || '[]');
  }
  if (!Array.isArray(roots)) throw new Error('剪贴板文件列表无效');
  const files = roots.filter(p => typeof p === 'string' && /\.torrent$/i.test(p));
  if (!files.length) return null;
  if (files.length !== 1) throw new Error('请每次粘贴一个种子文件');
  const info = await lstat(files[0]);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error('种子文件无效或超过 16 MiB');
  return { magnet: torrentMagnet(await readFile(files[0])) };
}
