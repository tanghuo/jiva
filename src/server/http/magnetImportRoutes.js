import { json, readJson, readImage, httpError } from './http.js';
import { torrentMagnet } from '../assets/torrentMagnet.js';
import { clipboardTorrent } from '../adapters/torrentClipboard.js';

export async function handleMagnetImportRoute(service, req, res, url, access) {
  if (!url.pathname.startsWith('/api/magnet-imports')) return false;
  if (access !== 'local' || req.localPrincipal) throw httpError(403, '磁力导入仅限本机管理');
  const root = '/api/magnet-imports';
  if (url.pathname === `${root}/torrent` && req.method === 'POST') {
    const bytes = await readImage(req, { maxBytes: 16 * 1024 * 1024, limitMessage: '种子文件不能超过 16 MiB' });
    try { json(res, 200, { magnet: torrentMagnet(bytes) }); } catch { throw httpError(400, '种子文件无效，请选择完整的 .torrent 文件'); }
  }
  else if (url.pathname === `${root}/clipboard-torrent` && req.method === 'POST') {
    try { json(res, 200, { input: await clipboardTorrent() }); } catch { throw httpError(400, '无法读取剪贴板种子，请使用“选择种子文件”'); }
  }
  else if (url.pathname === root && req.method === 'GET') json(res, 200, await service.status());
  else if (url.pathname === root && req.method === 'POST') json(res, 201, service.create(await readJson(req)));
  else if (url.pathname === `${root}/login` && req.method === 'POST') json(res, 200, await service.loginStart());
  else {
    const login = url.pathname.match(/^\/api\/magnet-imports\/login\/([a-f\d-]{36})$/);
    const connection = url.pathname.match(/^\/api\/magnet-imports\/connections\/(\d+)$/);
    const source = url.pathname.match(/^\/api\/magnet-imports\/sources\/(\d+)$/);
    const task = url.pathname.match(/^\/api\/magnet-imports\/(\d+)(?:\/(confirm|retry|cancel|clean|preview))?$/);
    if (source && req.method === 'GET') json(res, 200, service.sources(Number(source[1])));
    else if (login && req.method === 'POST') json(res, 200, await service.loginPoll(login[1]));
    else if (connection && req.method === 'DELETE') json(res, 200, service.disconnect(Number(connection[1])));
    else if (task) {
      const id = Number(task[1]), action = task[2];
      if (!action && req.method === 'GET') json(res, 200, service.detail(id));
      else if (action === 'preview' && req.method === 'GET') {
        const preview = await service.preview(id, url.searchParams.get('key'));
        res.writeHead(200, { 'content-type': preview.contentType, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }); res.end(preview.bytes);
      } else if (req.method === 'POST' && ['confirm', 'retry', 'cancel', 'clean'].includes(action)) json(res, 200, await service[action](id, action === 'confirm' ? await readJson(req, { maxBytes: 16 * 1024 * 1024 }) : undefined));
      else throw httpError(405, '不支持的导入操作');
    } else throw httpError(404, '导入接口不存在');
  }
  return true;
}
