import { importError, magnetSource } from '../../shared/domain/magnetImport.js';
import { albumTitle, maxAlbumItems } from '../../shared/domain/albums.js';
import { elementTags } from '../../shared/domain/elements.js';

export function createMagnetImportService({ repo, wiki, adapter, store, limits }) {
  let closing = false, timer, working;
  const controllers = new Map();
  const live = id => { const run = repo.get(id); if (closing || run.state === 'canceled') throw importError('任务已停止', 409, 'IMPORT_STOPPED'); return run; };
  function patch(id, changes) { return repo.save({ ...live(id), ...changes }); }
  const connection = run => { const c = repo.connection(run.connectionId); if (!c.enabled || c.accountId !== run.accountId) throw importError('请重新连接原 115 账号', 409, 'AUTH_REQUIRED'); return c; };
  function target(run) { try { if (wiki.resolveSpaceId(run.spaceId) !== run.spaceId) throw new Error(); } catch { throw importError('目标空间不可用，请恢复原空间后重试', 409); } }
  async function execute(id) {
    const controller = new AbortController(); controllers.set(id, controller);
    const timeout = setTimeout(() => controller.abort(), limits.stageMs);
    const signal = controller.signal;
    const started = Date.now();
    let submitting = false;
    try {
      let run = live(id);
      const c = connection(run);
      const call = (action, fields = {}, options = {}) => adapter.call(c.accountId, action, fields, { signal, ...options });
      patch(id, { state: 'running', error: '', errorCode: '' });
      for (let steps = 0; steps < 8; steps++) {
        run = live(id); signal.throwIfAborted();
        if (Date.now() - started > limits.stageMs) throw importError('阶段执行时间超限', 408);
        if (run.stage === 'submit') {
          const tasks = await call('tasks'); live(id);
          const found = tasks.find(t => t.info_hash?.toLowerCase() === run.source.hash);
          if (found) { patch(id, { stage: 'wait', remoteHash: run.source.hash, attempts: 0 }); continue; }
          if (run.submitIntent) throw importError('远端提交结果不明，未找到匹配任务。请核对原账号远端任务后重试；不会自动再次提交', 409, 'SUBMISSION_UNKNOWN');
          patch(id, { submitIntent: true });
          submitting = true;
          const hashes = await call('submit', { magnet: run.source.magnet });
          submitting = false;
          if (!Array.isArray(hashes) || !hashes.some(hash => hash?.toLowerCase() === run.source.hash)) throw importError('115 提交未返回匹配任务标识，请先核对远端任务', 409, 'SUBMISSION_UNKNOWN');
          patch(id, { stage: 'wait', remoteHash: run.source.hash, attempts: 0 }); continue;
        }
        if (run.stage === 'wait') {
          const tasks = await call('tasks'), found = tasks.find(t => t.info_hash?.toLowerCase() === run.source.hash); live(id);
          if (!found) throw importError('远端任务不存在，请核对原账号', 409);
          if (typeof found.name === 'string' && found.name.trim()) patch(id, { remoteName: found.name.trim() });
          if (found.status === -1) throw importError('115 远端离线任务失败，请在 115 中处理后重试', 409);
          if (found.status !== 2) { patch(id, { remoteStatus: found.status === 0 ? '排队中' : '下载中', nextAt: Date.now() + 15000 }); return; }
          if (!/^\d+$/.test(found.file_id) || found.file_id === '0') throw importError('115 未提供精确结果 ID，不能按文件名猜测归属', 409);
          patch(id, { stage: 'locate', resultId: found.file_id, remoteStatus: '已完成', attempts: 0 }); continue;
        }
        if (run.stage === 'locate') {
          const files = [], skipped = [], seen = new Set(); let bytes = 0, count = 0;
          const root = await call('stat', { id: run.resultId });
          async function walk(f, relative, depth = 0) {
            live(id); signal.throwIfAborted();
            if (depth > 40 || ++count > limits.files || seen.has(f.FileID)) throw importError('远端目录循环或文件数超限', 413);
            seen.add(f.FileID);
            if (!/^\d+$/.test(f.FileID) || /[\\/\x00-\x1f]/.test(f.Name) || ['.', '..'].includes(f.Name)) throw importError('远端文件标识或名称无效', 409);
            if (f.IsDirectory) {
              for (const child of await call('list', { id: f.FileID })) {
                if (child.ParentID !== f.FileID) throw importError('远端结果归属不一致', 409);
                await walk(child, `${relative}/${child.Name}`, depth + 1);
              }
            } else if (/\.(png|jpe?g|webp|gif|zip)$/i.test(f.Name)) {
              if (!Number.isSafeInteger(f.Size) || f.Size <= 0 || (bytes += f.Size) > limits.downloadBytes) throw importError('下载总量超限或文件大小无效', 413);
              files.push({ id: f.FileID, name: f.Name, relativePath: relative, size: f.Size, sha1: f.Sha1 });
            } else skipped.push({ path: relative, reason: '非图片或不支持的压缩格式，未下载' });
          }
          await walk(root, root.Name.replace(/\.zip$/i, ''));
          // Keep original file extension in the logical resource name, independent of cache directories.
          if (!root.IsDirectory && files.length === 1) files[0].relativePath = root.Name;
          if (!files.length) throw importError('远端结果没有可处理的图片或 ZIP', 409);
          patch(id, { files, skipped, stage: 'download', attempts: 0 }); continue;
        }
        if (run.stage === 'download') {
          for (const f of run.files) {
            const local = await store.download(run, f, call, signal);
            const current = live(id);
            patch(id, { files: current.files.map(item => item.id === f.id ? { ...item, local } : item), cacheBytes: await store.usage(id) });
          }
          patch(id, { stage: 'prepare', attempts: 0 }); continue;
        }
        if (run.stage === 'prepare') {
          const plan = await store.prepare(run, signal);
          patch(id, { plan, cacheBytes: await store.usage(id), state: plan.candidates.length ? 'confirmation' : 'attention', error: plan.candidates.length ? '' : '没有可导入图片，请查看跳过项', attempts: 0 }); return;
        }
        if (run.stage === 'import') {
          target(run);
          if (repo.items(id).some(item => !item.valid)) throw importError('已导入成员被删除、移出图集或移动到其他空间，请处理后重试', 409);
          if (!run.plan?.confirmed) throw importError('请先确认导入计划', 409);
          const candidates = run.plan.candidates.filter(a => a.selected);
          // Verify the full confirmed set before creating any additional content.
          for (const candidate of candidates) for (const file of candidate.files) await store.verified(id, file);
          for (const candidate of candidates) {
            live(id); target(run); connection(run);
            const albumId = repo.album(id, candidate.key, () => wiki.createAlbum({ title: candidate.title, tags: candidate.tags, spaceId: run.spaceId }));
            const existing = wiki.get(albumId);
            if (existing.kind !== 'album' || existing.spaceId !== run.spaceId) throw importError('结果图集已移动或失效，请处理后重试', 409);
            const done = new Set(repo.items(id).map(item => item.key));
            for (const file of candidate.files) {
              live(id); signal.throwIfAborted(); target(run); connection(run);
              if (done.has(file.key)) continue;
              const bytes = await store.verified(id, file);
              await wiki.importImage(bytes, file.fileName, [], false, run.spaceId, albumId, write => {
                live(id); signal.throwIfAborted(); target(run); connection(run);
                return repo.commitItem(id, file.key, write);
              });
            }
          }
          patch(id, { state: 'completed', error: '', completedAt: Date.now(), cleanup: 'pending' });
          await clean(id, true); return;
        }
      }
    } catch (error) {
      const current = repo.get(id);
      if (current.state === 'canceled' || closing || current.state === 'completed') return;
      if (error.code === 'IMPORT_STOPPED') return;
      const attempts = (current.attempts || 0) + 1;
      if (submitting && ['QUOTA_EXHAUSTED', 'REMOTE_LINK_INVALID', 'AUTH_REQUIRED'].includes(error.code)) current.submitIntent = false;
      const transient = ['115_TIMEOUT', 'REMOTE_NETWORK_FAILED', 'REMOTE_HTTP_FAILED', 'TASK_LIST_FAILED', 'FILE_LIST_FAILED', 'FILE_STAT_FAILED', 'DOWNLOAD_URL_FAILED', 'DOWNLOAD_FAILED', 'DOWNLOAD_HTTP_FAILED', 'DOWNLOAD_INCOMPLETE'].includes(error.code);
      repo.save({ ...current, ...(error.code === 'PLAN_CHANGED' ? { plan: null, stage: 'prepare' } : {}), state: transient && attempts < 3 ? 'queued' : error.statusCode === 409 || ['AUTH_REQUIRED', 'REMOTE_BLOCKED', 'QUOTA_EXHAUSTED', 'REMOTE_LINK_INVALID', 'IDENTITY_CHECK_FAILED', 'SUBMISSION_UNKNOWN_RECONCILE_FIRST'].includes(error.code) ? 'attention' : 'failed', errorCode: error.code || '', error: error.code === 'QUOTA_EXHAUSTED' ? '115 离线配额不足，请在 115 中处理后重试' : error.code === 'AUTH_REQUIRED' ? '115 登录失效，请用原账号重新登录' : error.statusCode ? error.message : '阶段执行失败，请检查文件或服务状态后重试', attempts, nextAt: Date.now() + 5000 * 2 ** Math.min(attempts, 4) });
    } finally {
      clearTimeout(timeout);
      try {
        if (repo.get(id).state !== 'completed') {
          const cacheBytes = await store.usage(id), current = repo.get(id);
          if (current.cacheBytes !== cacheBytes) repo.save({ ...current, cacheBytes });
        }
      } catch { /* Preserve the stage error if cache inspection itself fails. */ }
      controllers.delete(id);
    }
  }
  async function clean(id, success = false) {
    const run = repo.get(id);
    if (!success && controllers.has(Number(id))) throw importError('本地执行正在停止，请稍后清理', 409);
    if (!success && ['running', 'queued'].includes(run.state)) throw importError('请先取消任务，再清理缓存', 409);
    const invalidates = run.state !== 'completed';
    if (invalidates) repo.save({ ...run, state: run.state === 'canceled' ? 'canceled' : 'attention', error: '缓存已清理，重试后需要重新下载和确认计划', plan: null, files: run.files.map(f => ({ ...f, local: undefined })), stage: run.files.length ? 'download' : run.stage, cleanup: 'pending' });
    try {
      const cacheBytes = await store.clean(run, success && run.keepArchives);
      repo.save({ ...repo.get(id), cacheBytes, cleanup: 'done' });
    } catch { repo.save({ ...repo.get(id), cleanup: 'pending', cleanupError: '缓存清理失败，可稍后重试' }); }
    return detail(id);
  }
  function detail(id) { return { ...repo.get(id), results: repo.albums(id), imported: repo.items(id).length }; }
  async function tick() {
    if (closing || working) return;
    working = (async () => { for (const run of repo.runnable()) { if (closing) break; if ((run.nextAt || 0) <= Date.now()) await execute(run.id); } })();
    try { await working; } finally { working = null; }
  }
  const service = {
    async status() { return { available: await adapter.available(), connections: repo.connections(), tasks: repo.list().map(r => { const { plan, files, ...summary } = detail(r.id); return summary; }), limits }; },
    detail,
    sources(albumId) { wiki.get(Number(albumId)); return { sources: repo.sources(albumId) }; },
    create(input) {
      const source = magnetSource(input?.magnet), connectionId = Number(input.connectionId), spaceId = Number(input.spaceId);
      if (!Number.isSafeInteger(spaceId) || spaceId < 1) throw importError('请选择目标空间');
      const c = repo.connection(connectionId); if (!c.enabled) throw importError('请先登录 115');
      target({ spaceId });
      const run = repo.create({ connectionId, spaceId, source, keepArchives: input.keepArchives === true, force: input.force === true });
      if (!run.existing) repo.save({ ...run, accountId: c.accountId });
      void tick(); return detail(run.id);
    },
    confirm(id, input) {
      const run = repo.get(id); target(run); connection(run);
      if (run.state !== 'confirmation' || run.plan?.version !== input?.version) throw importError('计划已改变，请刷新后重新确认', 409);
      if (!Array.isArray(input.candidates) || input.candidates.length !== run.plan.candidates.length) throw importError('图集选项不完整');
      if (run.plan.skipped.length && input.excludeSkipped !== true) throw importError('请明确确认排除跳过项');
      const candidates = run.plan.candidates.map(a => {
        const edits = input.candidates.filter(e => e.key === a.key); if (edits.length !== 1) throw importError('图集选项无效');
        const e = edits[0];
        if (typeof e.selected !== 'boolean') throw importError('请选择图集');
        const keys = e.fileKeys === undefined ? a.files.map(f => f.key) : e.fileKeys;
        if (!Array.isArray(keys) || new Set(keys).size !== keys.length || keys.some(k => !a.files.some(f => f.key === k))) throw importError('图片选择不属于当前计划');
        const files = a.files.filter(f => keys.includes(f.key));
        if (e.selected && (files.length > maxAlbumItems || !files.length)) throw importError('所选图集为空或超过容量限制');
        return { ...a, selected: e.selected, files, excludedFiles: a.files.filter(f => !keys.includes(f.key)).map(f => f.key), title: albumTitle(e.title), tags: elementTags(e.tags) };
      });
      if (!candidates.some(c => c.selected)) throw importError('请至少选择一个图集');
      repo.save({ ...run, plan: { ...run.plan, candidates, confirmed: { at: Date.now(), version: run.plan.version, excludeSkipped: input.excludeSkipped === true } }, stage: 'import', state: 'queued', nextAt: 0 });
      void tick(); return detail(id);
    },
    cancel(id) { const run = repo.get(id); if (run.state === 'completed') throw importError('任务已完成', 409); repo.save({ ...run, state: 'canceled', error: '本地处理已取消，已导入图集保留；115 远端可能仍在运行' }); controllers.get(Number(id))?.abort(); return detail(id); },
    retry(id) { const run = repo.get(id); if (!['attention', 'failed', 'canceled'].includes(run.state)) throw importError('当前任务不能重试', 409); connection(run); const state = run.plan && !run.plan.confirmed ? 'confirmation' : 'queued'; repo.save({ ...run, state, error: '', attempts: 0, nextAt: 0 }); void tick(); return detail(id); },
    clean: id => clean(id),
    async preview(id, key) { const run = repo.get(id); const file = run.plan?.candidates.flatMap(c => c.files).find(f => f.key === key); if (!file) throw importError('预览不存在', 404); return { bytes: await store.verified(run.id, file), contentType: file.mime }; },
    loginStart: () => adapter.loginStart(),
    async loginPoll(id) { const result = await adapter.loginPoll(id); if (result.status === 'connected') { repo.connect(result.accountId, `115 · ${result.accountId}`); return { status: 'connected' }; } return result; },
    disconnect(id) {
      repo.disconnect(id);
      for (const run of repo.list().filter(r => r.connectionId === Number(id) && !['completed', 'canceled'].includes(r.state))) { controllers.get(run.id)?.abort(); repo.save({ ...run, state: 'attention', error: '连接已断开，请使用原账号重新登录' }); }
      return { ok: true };
    },
    start() { timer ||= setInterval(() => { void tick().catch(() => {}); }, 3000); timer.unref?.(); void tick().catch(() => {}); },
    async close() { closing = true; clearInterval(timer); for (const controller of controllers.values()) controller.abort(); await working; },
  };
  return service;
}
