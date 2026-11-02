import { json, readJson, httpError } from './http.js';

export async function handleCodeProjectRoute(service, req, res, url, access) {
  if (!url.pathname.startsWith('/api/code-projects')) return false;
  if (access !== 'local' || req.localPrincipal) throw httpError(403, '代码项目仅限本机用户');
  const route = url.pathname.slice('/api/code-projects'.length), method = req.method;
  let result, match;
  if (route === '/jiva' && method === 'POST') {
    const payload = await readJson(req, { maxBytes: 4096 });
    if (Object.keys(payload).length) throw httpError(400, '此 Demo 固定展示 Jiva，不接受项目路径');
    result = await service.openJiva();
  }
  else if ((match = /^\/([a-f0-9-]{36})(?:\/(file|commit|diff))?$/.exec(route))) {
    if (!match[2] && method === 'DELETE') result = service.close(match[1]);
    else if (match[2] === 'file' && method === 'GET') result = service.file(match[1], url.searchParams.get('path'));
    else if (match[2] === 'commit' && method === 'GET') result = await service.commit(match[1], url.searchParams.get('hash'));
    else if (match[2] === 'diff' && method === 'GET') result = await service.diff(match[1], { hash: url.searchParams.get('hash'), file: url.searchParams.get('path'), area: url.searchParams.get('area') });
    else throw httpError(405, '不支持的代码项目操作');
  } else throw httpError(404, '代码项目接口不存在');
  json(res, 200, result); return true;
}
