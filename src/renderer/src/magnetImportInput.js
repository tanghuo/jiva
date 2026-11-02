import { request } from './api.js';
let pending = null;
export function openMagnetImport(input) { pending = input; window.location.hash = 'imports'; }
export function takeMagnetImportInput() { const value = pending; pending = null; return value; }
export function torrentFiles(transfer) { return Array.from(transfer?.files || []).filter(f => /\.torrent$/i.test(f.name)); }
export async function magnetFromTorrent(file) {
  if (file.size > 16 * 1024 * 1024) throw new Error('种子文件不能超过 16 MiB');
  return (await request('/api/magnet-imports/torrent', { method: 'POST', headers: { 'content-type': 'application/x-bittorrent' }, body: file })).magnet;
}
export async function clipboardMagnet() {
  return (await request('/api/magnet-imports/clipboard-torrent', { method: 'POST', body: '{}' })).input?.magnet || null;
}
