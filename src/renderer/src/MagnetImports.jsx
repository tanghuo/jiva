import { useEffect, useRef, useState } from 'react';
import { apiUrl, request } from './api.js';
import Pan115Connections from './Pan115Connections.jsx';
import { takeMagnetImportInput, torrentFiles, magnetFromTorrent, clipboardMagnet } from './magnetImportInput.js';
import './magnetImports.css';

const states = { queued: '排队中', running: '运行中', confirmation: '待确认', attention: '待处理', failed: '失败', canceled: '已取消', completed: '已完成' };
const stages = { submit: '远端提交', wait: '远端等待', locate: '定位结果', download: '本地下载', prepare: '解压扫描', import: '导入' };
const bytes = n => `${((n || 0) / 1024 ** 2).toFixed(1)} MiB`;
const post = (url, body = {}) => request(url, { method: 'POST', body: JSON.stringify(body) });

export default function MagnetImports({ spaces, currentSpaceId, onOpen, onChanged }) {
  const [data, setData] = useState(null), [id, setId] = useState(() => Number(new URLSearchParams(window.location.hash.split('?')[1]).get('task')) || null), [detail, setDetail] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [magnet, setMagnet] = useState(''), [spaceId, setSpaceId] = useState(currentSpaceId || ''), [connectionId, setConnectionId] = useState(''), [keepArchives, setKeepArchives] = useState(false), [force, setForce] = useState(false);
  const [edits, setEdits] = useState([]), [excludeSkipped, setExcludeSkipped] = useState(false), [showConnections, setShowConnections] = useState(false);
  const [inputNotice, setInputNotice] = useState('');
  const torrentPicker = useRef(null), inputBusy = useRef(false);
  const needsLogin = detail?.errorCode === 'AUTH_REQUIRED' || /AUTH_REQUIRED|IDENTITY_CHECK_FAILED|登录失效|登录已失效|重新登录/.test(detail?.error || '');
  useEffect(() => {
    if (showConnections) document.querySelector('.pan115-connections')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [showConnections]);
  async function acceptInput(input) {
    if (inputBusy.current) return;
    inputBusy.current = true; setError(''); setInputNotice('正在读取种子…');
    try {
      const value = typeof input === 'string' ? input : await magnetFromTorrent(input);
      setMagnet(value); setInputNotice('已识别磁力，请确认连接与目标空间，再点击“创建导入任务”。');
    } catch (e) { setError(e.message); setInputNotice(''); }
    finally { inputBusy.current = false; }
  }
  useEffect(() => {
    const pending = takeMagnetImportInput(); if (pending) void acceptInput(pending);
    let canceled = false, timer, pasteVersion = 0;
    async function nativePaste() {
      try { const value = await clipboardMagnet(); if (!canceled) { if (value) await acceptInput(value); else setError('剪贴板未读到 .torrent 文件。可以选择种子文件，或粘贴 magnet: 链接。'); } }
      catch (e) { if (!canceled) setError(e.message); }
    }
    function paste(event) {
      clearTimeout(timer); pasteVersion++;
      if (event.defaultPrevented || event.target.closest?.('dialog, .pan115-connections')) return;
      const files = torrentFiles(event.clipboardData);
      if (files.length) { event.preventDefault(); if (files.length !== 1) setError('请每次粘贴一个种子文件'); else void acceptInput(files[0]); return; }
      if (event.clipboardData?.files?.length) { event.preventDefault(); setError('请粘贴 .torrent 种子文件，或粘贴 magnet: 链接文字'); return; }
      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (/^magnet:/i.test(text || '')) { event.preventDefault(); void acceptInput(text); }
      else if (!text && !event.clipboardData?.files?.length) void nativePaste();
    }
    function shortcut(event) {
      if (!(event.ctrlKey || event.metaKey) || event.code !== 'KeyV' || event.repeat || event.altKey || event.shiftKey || event.target.closest?.('input,textarea,select,[contenteditable],dialog')) return;
      const version = pasteVersion; clearTimeout(timer);
      timer = setTimeout(() => { if (version === pasteVersion) void nativePaste(); }, 150);
    }
    window.addEventListener('paste', paste); window.addEventListener('keydown', shortcut);
    return () => { canceled = true; clearTimeout(timer); window.removeEventListener('paste', paste); window.removeEventListener('keydown', shortcut); };
  }, []);
  const selected = useRef(id); selected.current = id;
  useEffect(() => { if (!spaceId && currentSpaceId) setSpaceId(currentSpaceId); }, [currentSpaceId]);
  async function refresh() {
    const next = await request('/api/magnet-imports'); setData(next);
    if (selected.current) { const task = await request(`/api/magnet-imports/${selected.current}`); if (selected.current === task.id) setDetail(task); }
  }
  useEffect(() => {
    let stopped = false, timer;
    async function poll() { try { await refresh(); } catch (e) { if (!stopped) setError(e.message); } if (!stopped) timer = setTimeout(poll, 4000); }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, []);
  useEffect(() => { let canceled = false; if (!id) return; request(`/api/magnet-imports/${id}`).then(d => { if (!canceled) setDetail(d); }).catch(e => setError(e.message)); return () => { canceled = true; }; }, [id]);
  useEffect(() => {
    setEdits(detail?.plan?.candidates.map(c => ({ key: c.key, title: c.title, tags: c.tags.join(', '), selected: c.selected, fileKeys: c.files.map(f => f.key) })) || []); setExcludeSkipped(false);
  }, [detail?.id, detail?.plan?.version]);
  async function act(action, body) {
    setBusy(true); setError('');
    try { const task = await post(`/api/magnet-imports/${id}/${action}`, body); setDetail(task); await refresh(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function create(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const task = await post('/api/magnet-imports', { magnet, connectionId: Number(connectionId || data.connections.find(c => c.enabled)?.id), spaceId: Number(spaceId), keepArchives, force }); setId(task.id); setDetail(task); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function edit(key, changes) { setEdits(current => current.map(c => c.key === key ? { ...c, ...changes } : c)); }
  return <main className="magnet-imports" id="main-content" onDragOver={e => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const files = torrentFiles(e.dataTransfer); if (files.length === 1) void acceptInput(files[0]); else setError('请拖入一个 .torrent 种子文件'); }}>
    <header><h1>磁力导入图集</h1><p>获取文件 → 准备图集 → 确认导入。任务在后台继续，关闭应用后下次启动恢复。</p><button onClick={() => setShowConnections(v => !v)}>管理 115 连接</button></header>
    {showConnections && <Pan115Connections onChanged={refresh} />}
    {error && <p role="alert">{error}</p>}
    {inputNotice && <p role="status">{inputNotice}</p>}
    {data && !data.available && <p role="alert">115 辅助程序不可用。请安装 Go 1.24+ 后运行 npm run build:115。</p>}
    <form onSubmit={create} className="magnet-create">
      <label>磁力链接<textarea aria-label="磁力链接" required value={magnet} onChange={e => setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:…" maxLength={16000} /></label>
      <input ref={torrentPicker} type="file" accept=".torrent,application/x-bittorrent" hidden aria-label="种子文件" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void acceptInput(file); }} />
      <button type="button" onClick={() => torrentPicker.current?.click()}>选择种子文件</button>
      <label>115 连接<select value={connectionId || data?.connections.find(c => c.enabled)?.id || ''} onChange={e => setConnectionId(e.target.value)} required><option value="">请选择连接</option>{data?.connections.filter(c => c.enabled).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>目标空间<select value={spaceId} required onChange={e => setSpaceId(Number(e.target.value))}><option value="">请选择空间</option>{spaces.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <label><input type="checkbox" checked={keepArchives} onChange={e => setKeepArchives(e.target.checked)} />导入成功后保留源 ZIP</label>
      <label><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />已有成功结果时另建任务</label>
      <button type="submit" disabled={busy || !data?.available || !data?.connections.some(c => c.enabled)}>创建导入任务</button>
    </form>
    <div className="magnet-columns">
      <section className="magnet-task-list" aria-label="导入任务列表"><h2>导入任务</h2>{!data?.tasks.length && <p>还没有任务。</p>}{data?.tasks.map(t => <button key={t.id} aria-current={id === t.id ? 'true' : undefined} onClick={() => { setId(t.id); if (detail?.id !== t.id) setDetail(null); }}><strong>任务 #{t.id} · {states[t.state]}</strong><span className="magnet-task-name">{t.remoteName || "等待 115 返回名称"}</span><span>{stages[t.stage]} · 缓存 {bytes(t.cacheBytes)}</span><small>{t.source.hash.slice(0, 16)}…</small></button>)}</section>
      <section className="magnet-task-detail" aria-label="任务详情">{detail && <>
        <h2>任务 #{detail.id} · {states[detail.state]}</h2><p>{stages[detail.stage]}{detail.remoteStatus ? ` · ${detail.error ? '上次 115 状态：' : '115 '}${detail.remoteStatus}` : ''} · 目标空间：{spaces.find(s => s.id === detail.spaceId)?.name || `空间 #${detail.spaceId}（不可用）`}</p>
        <p className="magnet-task-name">115 任务名：{detail.remoteName || '等待 115 返回名称'}</p>
        <p>缓存 {bytes(detail.cacheBytes)} · 已导入 {detail.imported} 项{detail.stage === 'download' && ` · 下载文件 ${detail.files.filter(f => f.local).length}/${detail.files.length}`}</p>
        <details><summary>来源与处理记录</summary><p className="magnet-source">{detail.source.original}</p><p>创建：{new Date(detail.createdAt).toLocaleString()} · 模板 v{detail.templateVersion} · 当前阶段：{stages[detail.stage]} · 重试次数：{detail.attempts || 0}</p></details>
        {detail.error && <p role="status">{detail.error}</p>}
        {detail.cleanup === 'pending' && <p role="status">{detail.state === 'completed' ? '导入完成，缓存待清理' : '缓存待清理'}</p>}
        <div className="magnet-actions">
          {needsLogin && <button disabled={busy} onClick={() => setShowConnections(true)}>重新登录 115</button>}
          {['failed', 'attention', 'canceled'].includes(detail.state) && <button disabled={busy} onClick={() => act('retry')}>从当前阶段重试</button>}
          {!['canceled', 'completed'].includes(detail.state) && <button disabled={busy} onClick={() => act('cancel')}>取消本地执行</button>}
          {!['queued', 'running'].includes(detail.state) && <button disabled={busy} onClick={() => { if (window.confirm('清理只删除本任务缓存，保留已入库内容。未完成任务可能需要重新下载和确认计划，是否继续？')) act('clean'); }}>清理缓存</button>}
        </div>
        {detail.results.length > 0 && <div><h3>结果图集</h3>{detail.results.map(r => <button key={r.key} disabled={!r.albumId} onClick={() => onOpen(r.albumId)}>{r.albumId ? `打开图集 #${r.albumId}` : '图集已删除'}</button>)}</div>}
        {detail.plan && <div className="magnet-plan"><h3>图集预览</h3>{detail.plan.candidates.map(c => {
          const value = edits.find(e => e.key === c.key) || { ...c, tags: c.tags.join(', '), fileKeys: c.files.map(f => f.key) }, editable = detail.state === 'confirmation';
          return <article key={c.key}><label><input type="checkbox" disabled={!editable || busy} checked={value.selected} onChange={e => edit(c.key, { selected: e.target.checked })} />{c.files.length} 张图片{c.overLimit && ' · 超出图集容量，请排除此组'}</label><label>标题<input value={value.title} disabled={!editable || busy} onChange={e => edit(c.key, { title: e.target.value })} maxLength={200} /></label><label>标签（逗号分隔）<input value={value.tags} disabled={!editable || busy} onChange={e => edit(c.key, { tags: e.target.value })} /></label>
            {detail.state !== 'completed' && <div className="magnet-thumbs">{c.files.slice(0, 8).map(f => <img key={f.key} loading="lazy" src={apiUrl(`/api/magnet-imports/${detail.id}/preview?key=${encodeURIComponent(f.key)}`)} alt={f.fileName} />)}</div>}
            <details><summary>选择图片（{value.fileKeys.length}/{c.files.length}）</summary><div className="magnet-file-selection">{c.files.map(f => <label key={f.key}><input type="checkbox" disabled={!editable || busy} checked={value.fileKeys.includes(f.key)} onChange={e => edit(c.key, { fileKeys: e.target.checked ? [...value.fileKeys, f.key] : value.fileKeys.filter(k => k !== f.key) })} />{f.fileName}</label>)}</div></details></article>;
        })}
        {detail.plan.skipped.length > 0 && <details open><summary>跳过项（{detail.plan.skipped.length}）</summary><ul>{detail.plan.skipped.map((s, i) => <li key={i}>{s.path}：{s.reason}</li>)}</ul></details>}
        {detail.state === 'confirmation' && <><label><input type="checkbox" checked={excludeSkipped} onChange={e => setExcludeSkipped(e.target.checked)} />确认排除上述跳过项</label><button disabled={busy || !edits.some(e => e.selected) || (detail.plan.skipped.length > 0 && !excludeSkipped)} onClick={() => act('confirm', { version: detail.plan.version, candidates: edits.map(e => ({ ...e, tags: e.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) })), excludeSkipped })}>确认导入所选图集</button></>}
        </div>}
        {detail.state === 'canceled' && <p>取消只停止本地执行。115 远端可能仍在运行，已有图集会保留。</p>}
      </>}</section>
    </div>
  </main>;
}
