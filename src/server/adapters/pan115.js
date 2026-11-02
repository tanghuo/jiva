import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import QRCode from 'qrcode';
import { importError } from '../../shared/domain/magnetImport.js';
import { childEnvironment } from '../../shared/runtime/childEnvironment.js';

export function run115Process(executable, args, input, { signal, timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: childEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', size = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
    const abort = () => { child.kill(); finish(importError('操作已停止', 409, 'IMPORT_STOPPED')); };
    const timer = setTimeout(() => { child.kill(); finish(importError('115 操作超时，可按阶段重试', 504, '115_TIMEOUT')); }, timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 16 * 1024 * 1024) { child.kill(); finish(importError('115 返回清单过大', 413)); } else stdout += chunk; });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => finish(importError('115 辅助程序不可用，请运行 npm run build:115', 503, '115_UNAVAILABLE')));
    child.on('close', code => {
      if (code !== 0 && !stdout.startsWith('{')) finish(importError('115 辅助程序执行失败', 502));
      else finish(null, stdout);
    });
    child.stdin.end(input);
  });
}

export function create115Adapter({ dataDir, binary = path.join(import.meta.dirname, '115bridge', process.platform === 'win32' ? '115bridge.exe' : '115bridge'), processRunner = run115Process, now = Date.now }) {
  const secrets = path.join(dataDir, '.secrets', '115'), sessions = new Map();
  const taskSnapshots = new Map();
  async function crypt(value, decrypt = false) {
    if (process.platform !== 'win32') throw importError('当前 115 连接需要 Windows 安全存储', 503);
    const operation = decrypt ? 'Unprotect' : 'Protect';
    const decode = decrypt ? '[Convert]::FromBase64String($v)' : '[Text.Encoding]::UTF8.GetBytes($v)';
    const encode = decrypt ? '[Text.Encoding]::UTF8.GetString($d)' : '[Convert]::ToBase64String($d)';
    const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${decode}; $d=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${encode})`;
    return processRunner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], value);
  }
  function secretPath(accountId) { if (!/^\d+$/.test(String(accountId))) throw importError('115 账号标识无效'); return path.join(secrets, `${accountId}.dpapi`); }
  async function invoke(input, options) {
    let result;
    try { result = JSON.parse(await processRunner(binary, [], JSON.stringify(input), options)); }
    catch (e) { if (e.statusCode) throw e; throw importError('115 辅助程序返回无效数据', 502); }
    if (!result.ok) {
      const messages = {
        AUTH_REQUIRED: '115 登录已失效，请用任务原账号重新扫码登录',
        REMOTE_BLOCKED: '115 暂时拒绝接口访问（HTTP 403/405/429），已暂停重试。请稍后从当前阶段重试，无需新建任务',
        REMOTE_NETWORK_FAILED: '连接 115 失败，请检查网络后重试',
        REMOTE_HTTP_FAILED: '115 接口暂时不可用，请稍后重试',
        REMOTE_RESPONSE_INVALID: '115 返回的数据格式异常，请稍后重试',
      };
      const code = /^[A-Z_]+$/.test(result.code) ? result.code : 'UNKNOWN';
      throw importError(messages[code] || `115 操作失败：${code}`, ['AUTH_REQUIRED', 'REMOTE_BLOCKED'].includes(code) ? 409 : 502, code);
    }
    return result.data;
  }
  async function qrRequest(url, options = {}) {
    let result;
    try {
      const r = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'Mozilla/5.0 115Browser/27.0.5.7', ...options.headers } });
      if (!r.ok) throw new Error();
      result = await r.json();
    } catch { throw importError('115 扫码服务暂时不可达，请重试', 502); }
    if (result.state === false || result.state === 0) throw importError('115 扫码已失效，请重新登录', 409);
    return result.data;
  }
  return {
    async available() { try { await access(binary); return process.platform === 'win32'; } catch { return false; } },
    async call(accountId, action, fields = {}, options) {
      options?.signal?.throwIfAborted();
      const key = String(accountId), snapshot = taskSnapshots.get(key);
      if (action === 'tasks' && snapshot?.expires > now()) {
        if (snapshot.error) throw snapshot.error;
        return structuredClone(snapshot.data);
      }
      let credential;
      try { credential = JSON.parse(await crypt(await readFile(secretPath(accountId), 'utf8'), true)); }
      catch { throw importError('请用原 115 账号重新登录', 409, 'AUTH_REQUIRED'); }
      try {
        const data = await invoke({ ...fields, action, credential }, options);
        if (action === 'tasks') taskSnapshots.set(key, { data: structuredClone(data), expires: now() + 30000 });
        return data;
      } catch (error) {
        if (action === 'tasks' && error.code !== 'IMPORT_STOPPED') taskSnapshots.set(key, { error, expires: now() + (error.code === 'REMOTE_BLOCKED' ? 60000 : 15000) });
        throw error;
      } finally {
        if (action === 'submit') taskSnapshots.delete(key);
      }
    },
    extract: (fields, options) => invoke({ ...fields, action: 'extract' }, options),
    async loginStart() {
      for (const [id, entry] of sessions) if (Date.now() > entry.expires) sessions.delete(id);
      if (sessions.size >= 3) throw importError('请等待当前二维码过期后重试', 429);
      await access(binary).catch(() => { throw importError('请先运行 npm run build:115', 503); });
      await crypt('storage-check');
      const session = await qrRequest('https://qrcodeapi.115.com/api/1.0/web/1.0/token');
      if (!session?.uid || !session.sign || !session.time || typeof session.qrcode !== 'string') throw importError('115 扫码响应无效', 502);
      const id = randomUUID(), expires = Date.now() + 240000;
      sessions.set(id, { session, expires });
      return { id, expires, image: await QRCode.toDataURL(session.qrcode, { width: 280 }) };
    },
    async loginPoll(id) {
      const entry = sessions.get(id);
      if (!entry || entry.expires < Date.now()) { sessions.delete(id); throw importError('二维码过期，请重新登录', 410); }
      if (entry.busy) throw importError('正在核对扫码结果', 409);
      entry.busy = true;
      try {
        const s = entry.session;
        const query = new URLSearchParams({ uid: s.uid, sign: s.sign, time: String(s.time), _: String(Math.floor(Date.now() / 1000)) });
        const state = await qrRequest(`https://qrcodeapi.115.com/get/status/?${query}`);
        if (state.status !== 2) {
          if (state.status < 0) { sessions.delete(id); throw importError('扫码已取消或过期，请重新登录', 410); }
          return { status: state.status === 1 ? 'scanned' : 'waiting' };
        }
        const result = await qrRequest('https://passportapi.115.com/app/1.0/web/1.0/login/qrcode', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ account: s.uid, app: 'web' }) });
        const credential = result?.cookie;
        if (!credential || !['UID', 'CID', 'SEID'].every(k => typeof credential[k] === 'string' && credential[k])) throw importError('115 授权不完整', 502);
        const identity = await invoke({ action: 'identity', credential });
        await mkdir(secrets, { recursive: true });
        const target = secretPath(identity.accountId), temp = `${target}.${randomUUID()}.tmp`;
        try { await writeFile(temp, await crypt(JSON.stringify(credential)), { flag: 'wx', mode: 0o600 }); await rename(temp, target); }
        finally { await rm(temp, { force: true }); }
        sessions.delete(id);
        taskSnapshots.delete(String(identity.accountId));
        return { status: 'connected', accountId: String(identity.accountId) };
      } finally { entry.busy = false; }
    },
  };
}
