import { importStates, importStages, importError } from '../../shared/domain/magnetImport.js';

export function createMagnetImportRepository(db) {
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function get(id) {
    const r = db.prepare('SELECT * FROM magnet_imports WHERE id=?').get(Number(id));
    if (!r) throw importError('导入任务不存在', 404);
    return { ...JSON.parse(r.data), id: r.id, connectionId: r.connection_id, spaceId: r.space_id, state: importStates[r.state], stage: importStages[r.stage], revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  function save(run) {
    const { id, state, stage, revision, connectionId, spaceId, createdAt, updatedAt, ...data } = run;
    const changed = db.prepare('UPDATE magnet_imports SET data=?,state=?,stage=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(JSON.stringify(data), importStates.indexOf(state), importStages.indexOf(stage), Date.now(), id, revision).changes;
    if (changed !== 1) throw importError('任务已改变，请刷新后重试', 409);
    return get(id);
  }
  const repo = {
    get, save,
    list: () => db.prepare('SELECT id FROM magnet_imports ORDER BY id DESC LIMIT 300').all().map(r => get(r.id)),
    runnable: () => db.prepare('SELECT id FROM magnet_imports WHERE state IN(0,1) ORDER BY id').all().map(r => get(r.id)),
    connections: () => db.prepare('SELECT id,account_id AS accountId,name,enabled FROM import_connections').all(),
    connection(id) { const c = repo.connections().find(c => c.id === Number(id)); if (!c) throw importError('115 连接不存在', 404); return c; },
    connect(accountId, name) {
      db.prepare('INSERT INTO import_connections(account_id,name) VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=1,name=excluded.name').run(String(accountId), name);
      return repo.connections().find(c => c.accountId === String(accountId));
    },
    disconnect(id) { repo.connection(id); db.prepare('UPDATE import_connections SET enabled=0 WHERE id=?').run(Number(id)); },
    create({ connectionId, spaceId, source, keepArchives, force = false }) {
      return transaction(() => {
        const existing = db.prepare('SELECT id,state FROM magnet_imports WHERE connection_id=? AND space_id=? AND source_hash=? AND state!=5 ORDER BY id DESC LIMIT 1').get(connectionId, spaceId, source.hash);
        if (existing && (existing.state !== 6 || !force)) return { ...get(existing.id), existing: true };
        const data = { source, keepArchives, templateVersion: 1, submitIntent: false, files: [], plan: null, cacheBytes: 0, error: '', attempts: 0 };
        const result = db.prepare('INSERT INTO magnet_imports(connection_id,space_id,source_hash,state,stage,data,created_at,updated_at) VALUES(?,?,?,0,0,?,?,?)').run(connectionId, spaceId, source.hash, JSON.stringify(data), Date.now(), Date.now());
        return get(Number(result.lastInsertRowid));
      });
    },
    albums: id => db.prepare('SELECT candidate_key AS key,album_id AS albumId FROM magnet_import_albums WHERE run_id=?').all(Number(id)),
    items: id => db.prepare(`SELECT i.file_key AS key,i.image_id AS imageId,
      CASE WHEN e.id IS NOT NULL AND e.deleted_at IS NULL AND e.space_id=r.space_id AND EXISTS(
        SELECT 1 FROM album_items ai JOIN magnet_import_albums a ON a.album_id=ai.album_id WHERE ai.image_id=i.image_id AND a.run_id=i.run_id)
        THEN 1 ELSE 0 END AS valid FROM magnet_import_items i JOIN magnet_imports r ON r.id=i.run_id LEFT JOIN elements e ON e.id=i.image_id WHERE i.run_id=?`).all(Number(id)),
    sources: albumId => db.prepare('SELECT run_id AS id FROM magnet_import_albums WHERE album_id=?').all(Number(albumId)).map(r => { const run = get(r.id); return { runId: run.id, source: run.source, state: run.state }; }),
    album(runId, key, create) {
      return transaction(() => {
        const previous = repo.albums(runId).find(r => r.key === key);
        if (previous) { if (!previous.albumId) throw importError('已导入图集被删除，请处理后重试', 409); return previous.albumId; }
        const album = create();
        db.prepare('INSERT INTO magnet_import_albums VALUES(?,?,?)').run(runId, key, album.id);
        return album.id;
      });
    },
    commitItem(runId, key, create) {
      return transaction(() => {
        const previous = repo.items(runId).find(r => r.key === key);
        if (previous) throw importError('该文件已完成导入', 409);
        const result = create();
        db.prepare('INSERT INTO magnet_import_items VALUES(?,?,?)').run(runId, key, result.element.memberId);
        return result;
      });
    },
  };
  return repo;
}
