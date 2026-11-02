import { useEffect, useState } from 'react';
import { request } from './api.js';

export default function Pan115Connections({ onChanged }) {
  const [connections, setConnections] = useState([]), [login, setLogin] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  async function refresh() { const data = await request('/api/magnet-imports'); setConnections(data.connections); }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!login) return;
    let canceled = false, timer;
    const controller = new AbortController();
    async function poll() {
      if (Date.now() > login.expires) { setLogin(null); setError('二维码已过期，请重新登录'); return; }
      try {
        const result = await request(`/api/magnet-imports/login/${login.id}`, { method: 'POST', body: '{}', signal: controller.signal });
        if (canceled) return;
        if (result.status === 'connected') { setLogin(null); setStatus('115 已连接'); await refresh(); onChanged?.(); return; }
        setStatus(result.status === 'scanned' ? '请在手机上确认登录' : '等待扫码');
      } catch (e) { if (canceled) return; setError(e.message); }
      if (!canceled) timer = setTimeout(poll, 2000);
    }
    timer = setTimeout(poll, 1000);
    return () => { canceled = true; clearTimeout(timer); controller.abort(); };
  }, [login?.id]);
  async function start() { setBusy(true); setError(''); try { setLogin(await request('/api/magnet-imports/login', { method: 'POST', body: '{}' })); setStatus('等待扫码'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function disconnect(c) {
    if (!window.confirm('断开后，引用此连接的未完成任务将进入待处理。115 远端任务和文件会保留。')) return;
    setBusy(true); setError('');
    try { await request(`/api/magnet-imports/connections/${c.id}`, { method: 'DELETE' }); await refresh(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="pan115-connections" aria-label="115 连接管理">
    <h2>115 连接</h2><p>登录凭证由本机 Windows 安全存储加密保存。重新登录时，请使用任务原账号。</p>
    {error && <p role="alert">{error}</p>}
    <ul>{connections.map(c => <li key={c.id}>{c.name} · {c.enabled ? '已授权' : '已断开'} {Boolean(c.enabled) && <button disabled={busy} onClick={() => disconnect(c)}>断开连接</button>}</li>)}</ul>
    <button disabled={busy || Boolean(login)} onClick={start}>{busy ? '正在连接…' : '扫码登录 / 重新登录'}</button>
    {login && <div><img src={login.image} width="280" height="280" alt="使用 115 手机 App 扫码登录" /><p role="status">{status}</p><button onClick={() => setLogin(null)}>关闭二维码</button></div>}
    {!login && status && <p role="status">{status}</p>}
  </section>;
}
