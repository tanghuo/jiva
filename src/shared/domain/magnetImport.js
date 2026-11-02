export const importStates = ['queued', 'running', 'confirmation', 'attention', 'failed', 'canceled', 'completed'];
export const importStages = ['submit', 'wait', 'locate', 'download', 'prepare', 'import'];
export function importError(message, statusCode = 400, code = 'IMPORT_INVALID') { return Object.assign(new Error(message), { statusCode, code }); }
export function magnetSource(value) {
  if (typeof value !== 'string' || value.length > 16000) throw importError('请输入有效磁力链接');
  let url; try { url = new URL(value.trim()); } catch { throw importError('请输入有效磁力链接'); }
  if (url.protocol !== 'magnet:') throw importError('请输入磁力链接');
  const hashes = url.searchParams.getAll('xt').filter(v => /^urn:btih:/i.test(v)).map(v => v.slice(9));
  if (hashes.length !== 1) throw importError('磁力必须包含唯一 BTIH 标识');
  let hash = hashes[0];
  if (/^[A-Z2-7]{32}$/i.test(hash)) {
    let bits = 0, accumulator = 0; const out = [];
    for (const c of hash.toUpperCase()) { accumulator = (accumulator << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c); bits += 5; if (bits >= 8) { bits -= 8; out.push((accumulator >>> bits) & 255); } }
    hash = out.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  if (!/^[a-f\d]{40}$/i.test(hash)) throw importError('不支持的 BTIH 标识');
  return { original: value.trim(), hash: hash.toLowerCase(), magnet: `magnet:?xt=urn:btih:${hash.toLowerCase()}` };
}

export const defaultImportLimits = Object.freeze({ downloadBytes: 2 * 1024 ** 3, extractedBytes: 4 * 1024 ** 3, files: 10000, freeBytes: 512 * 1024 ** 2, stageMs: 30 * 60 * 1000 });
export function importLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(k => !(k in defaultImportLimits))) throw importError('磁力导入限制配置无效');
  const value = { ...defaultImportLimits, ...overrides };
  for (const [key, n] of Object.entries(value)) {
    const max = key === 'files' ? 20000 : key === 'stageMs' ? 24 * 60 * 60 * 1000 : 8 * 1024 ** 3;
    if (!Number.isSafeInteger(n) || n < (key === 'freeBytes' ? 0 : 1) || n > max) throw importError(`磁力导入限制 ${key} 无效`);
  }
  return value;
}
