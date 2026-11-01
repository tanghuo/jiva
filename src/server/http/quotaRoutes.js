import { json,readJson,httpError } from './http.js';

export async function handleQuotaRoute(quota,req,res,url,access='local') {
  if(url.pathname!=='/api/quota'&&!url.pathname.startsWith('/api/quota/'))return false;
  if(access!=='local'||req.localPrincipal==='organizer-worker')throw httpError(403,'账号额度仅限本机管理访问');
  if(req.method==='GET'&&url.pathname==='/api/quota')json(res,200,quota.snapshot());
  else if(req.method==='POST'&&url.pathname==='/api/quota/refresh') {
    const body=await readJson(req);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['sourceIds','reason'].includes(k)))throw httpError(400,'无效的刷新请求');
    json(res,202,quota.refresh(body.sourceIds,body.reason||'open'));
  } else if(req.method==='PUT'&&url.pathname==='/api/quota/config')json(res,200,await quota.configure(await readJson(req)));
  else if(req.method==='GET'&&url.pathname==='/api/quota/events') {
    let pending=null,blocked=false,done=false,unsubscribe=()=>{},heartbeat;
    function close(destroy=false){if(done)return;done=true;clearInterval(heartbeat);unsubscribe();if(destroy)res.destroy();else res.end();}
    function send(snapshot) {
      if(snapshot===null){close();return;}
      if(done)return;
      pending=`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
      if(res.writableLength>256*1024||Buffer.byteLength(pending)>256*1024){close(true);return;}
      if(!blocked){const data=pending;pending=null;blocked=!res.write(data);if(res.writableLength>256*1024)close(true);}
    }
    unsubscribe=quota.subscribe(send,{collect:url.searchParams.get('collect')==='1'});
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-store','connection':'keep-alive','x-accel-buffering':'no'});
    res.on('drain',()=>{blocked=false;if(pending&&!done){const data=pending;pending=null;blocked=!res.write(data);if(res.writableLength>256*1024)close(true);}});
    res.once('close',close);res.once('error',close);
    send(quota.snapshot());
    if(!done)heartbeat=setInterval(()=>{if(!done&&!blocked)blocked=!res.write(': heartbeat\n\n');},15000);
  } else throw httpError(404,'额度接口不存在');
  return true;
}
