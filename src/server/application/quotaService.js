import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { quotaProviders, quotaPresentation } from '../../shared/domain/quota.js';
import { readCodexQuota, readGrokQuota, readGeminiQuota, subscribeQuotaInvalidation, quotaSourceFingerprint } from './executorsPort.js';

const messages = {
  AUTH_REQUIRED:'请先在对应官方客户端登录，再检测额度', UNSUPPORTED:'当前客户端不支持此额度接口', TEAM_UNSUPPORTED:'当前接口不支持团队额度',
  NOT_RUNNING:'请先在工作台连接 Antigravity 账号，或打开并登录桌面端', NOT_CONFIGURED:'请先配置额度来源', PROTOCOL_ERROR:'客户端返回的额度格式暂不支持',
  QUOTA_UNAVAILABLE:'Antigravity 未返回可用的 Gemini 额度，请稍后重试',
  GROK_BILLING_AUTH_UNAVAILABLE:'Grok 额度服务未能确认认证上下文，请检查代理连接后刷新；这不代表本机登录已失效',
  AMBIGUOUS_SOURCE:'检测到多个 Antigravity 来源，无法确认当前账号', IDENTITY_CHANGED:'检测期间账号发生变化，请重试',
  TIMEOUT:'额度读取超时，请稍后重试', READ_FAILED:'额度暂时读不到，请检查本机客户端与网络',
};
const httpError = (statusCode,message) => Object.assign(new Error(message),{statusCode});
export async function createQuotaService({ repo, dataDir, executionConfig, readers = {codex:readCodexQuota,grok:readGrokQuota,gemini:readGeminiQuota}, now = Date.now, subscribe = subscribeQuotaInvalidation }) {
  const configPath = path.join(dataDir,'quota.json');
  let saved;
  try { saved=JSON.parse(await readFile(configPath,'utf8')); } catch(error) { if(error.code !== 'ENOENT') throw new Error('额度来源配置无法读取'); }
  if (!saved) {
    saved={salt:randomBytes(32).toString('hex'),sources:quotaProviders.map(p => ({...p,sourceId:randomUUID(),enabled:true,cliPath:'',generation:1}))};
    await writeFile(configPath,JSON.stringify(saved),{mode:0o600,flag:'wx'});
  }
  if(!/^[a-f0-9]{64}$/.test(saved.salt)||!Array.isArray(saved.sources)||saved.sources.length!==3||quotaProviders.some(p=>saved.sources.filter(s=>s.provider===p.provider&&s.product===p.product&&typeof s.sourceId==='string'&&typeof s.enabled==='boolean'&&Number.isSafeInteger(s.generation)).length!==1))throw new Error('额度来源配置格式无效');
  const cwd=path.join(dataDir,'quota-runtime'); await mkdir(cwd,{recursive:true});
  const epoch=randomUUID(), listeners=new Map(), jobs=new Map(), queue=[], controllers=new Set(), dirty=new Set(), timers=new Map();
  const sessionKeys = new Map(saved.sources.map(s => [s.sourceId,randomUUID()]));
  const lastManual=new Map(), lastEvent=new Map(), fingerprints=new Map();
  let revision=0, active=0, closed=false, cleanupAt=0, cleanupTimer, configuring=false;
  function providerConfig(source) {
    const config=executionConfig();
    return source.provider === 'codex' ? config : source.provider === 'grok' ? config.chat?.grokBuild || {} : {cliPath:source.cliPath};
  }
  function syncSources() {
    for (const source of saved.sources) {
      const fingerprint=quotaSourceFingerprint(source.provider,providerConfig(source));
      const previous=repo.state(source.sourceId);
      if(!fingerprints.has(source.sourceId)&&previous)source.generation=previous.generation;
      if (previous?.fingerprint !== fingerprint || previous?.configRevision !== (source.configRevision||1) || !fingerprints.has(source.sourceId) && previous?.identityStatus !== 'verified') {
        revision++;
        source.generation=Math.max(source.generation,previous?.generation || 0)+1;
        sessionKeys.set(source.sourceId,randomUUID());
        repo.saveState({sourceId:source.sourceId,generation:source.generation,configRevision:source.configRevision||1,fingerprint,accountKey:null,identityStatus:'unverified',state:source.enabled ? 'not_configured' : 'disabled',lastAttemptAt:null,lastSuccessAt:null,failureCount:0,nextAllowedAt:0,errorCode:null,safeMessage:''});
      }
      fingerprints.set(source.sourceId,fingerprint);
    }
  }
  syncSources();
  function snapshot() {
    syncSources();
    const generatedAt=now(), accounts=[];
    const sources=saved.sources.map(source => {
      const state=repo.state(source.sourceId);
      const job=jobs.get(source.sourceId);
      const current=state?.accountKey?repo.current(source.sourceId,state.accountKey):job?.generation===source.generation?job.previousAccount:null;
      if(current) accounts.push(current);
      const {fingerprint,accountKey,...publicState}=state || {};
      return {...publicState,sourceId:source.sourceId,provider:source.provider,product:source.product,label:source.label,enabled:source.enabled,
        configured:true,dirty:dirty.has(source.sourceId),state:source.enabled ? state?.state || 'not_configured' : 'disabled',cliConfigured:Boolean(source.cliPath)};
    });
    return {epoch,revision,generatedAt,sources,...quotaPresentation(sources,accounts,generatedAt),refreshingSources:[...jobs.keys()]};
  }
  function publish() { revision++; for(const listener of listeners.keys()) { try { listener(snapshot()); } catch { /* Isolated SSE observer. */ } } }
  function cleanupBatch(){if(closed)return;try{if(repo.cleanup(now())===500)cleanupTimer=setTimeout(cleanupBatch,0);}catch{/* Retry maintenance on the next active day. */}}
  function clean() { if(cleanupAt&&now()-cleanupAt<86400000) return; cleanupAt=now();cleanupBatch(); }
  clean();
  function scheduleEvent(source) {
    if(![...listeners.values()].some(Boolean)||!source.enabled||closed)return;
    const generation=source.generation;
    clearTimeout(timers.get(source.sourceId));
    const delay=Math.max(2000,15000-(now()-(lastEvent.get(source.sourceId)??-Infinity)));
    timers.set(source.sourceId,setTimeout(()=>{
      timers.delete(source.sourceId);
      const current=saved.sources.find(s=>s.sourceId===source.sourceId);
      if([...listeners.values()].some(Boolean)&&!closed&&current?.enabled&&generation===current.generation){try{refresh([source.sourceId],'notification',true);}catch{}}
    },delay));
  }
  function pump() {
    while(active<2 && queue.length && !closed) {
      const job=queue.shift(); active++;
      void run(job).catch(()=>{}).finally(() => {
        active--;jobs.delete(job.sourceId);job.resolve();
        if(!closed){
          if(job.invalidated&&dirty.has(job.sourceId)&&!(repo.state(job.sourceId)?.nextAllowedAt>now()))scheduleEvent(saved.sources.find(s=>s.sourceId===job.sourceId));
          publish();pump();
        }
      });
    }
  }
  async function run(job) {
    const source=saved.sources.find(s=>s.sourceId===job.sourceId), generation=source.generation;
    if(job.generation!==generation)return;
    const controller=new AbortController(); controllers.add(controller);
    const timeout=setTimeout(()=>controller.abort(new Error('TIMEOUT')),source.provider==='gemini'?90000:30000);
    const state={...repo.state(source.sourceId),lastAttemptAt:now()};
    // Keep the previous reading visible during the probe, without binding the new
    // unverified session to its identity. Discard this display fallback on failure.
    if(state.identityStatus==='unverified'){
      job.previousAccount=state.accountKey?repo.current(source.sourceId,state.accountKey):null;
      state.accountKey=null;
    }
    try {
      repo.saveState(state);publish();
      const result=await readers[source.provider](providerConfig(source),{cwd,signal:controller.signal,salt:saved.salt,sessionKey:sessionKeys.get(source.sourceId),onIdentity(identity){
        if(closed||generation!==saved.sources.find(s=>s.sourceId===source.sourceId)?.generation)return;
        if(state.accountKey!==identity.accountKey){job.previousAccount=null;state.accountKey=null;state.lastSuccessAt=null;repo.saveState(state);publish();}
      }});
      syncSources();
      if(closed || generation!==saved.sources.find(s=>s.sourceId===source.sourceId)?.generation || controller.signal.aborted) return;
      const observedAt=now();
      repo.success({...state,state:'ok',accountKey:result.accountKey,identityStatus:result.identityStatus,lastSuccessAt:observedAt,failureCount:0,nextAllowedAt:0,errorCode:null,rpcErrorCode:null,safeMessage:''},
        {...result,sourceId:source.sourceId,provider:source.provider,product:source.product,generation,observedAt},revision+1);
      if(!job.invalidated) dirty.delete(source.sourceId);
      clean();
    } catch(error) {
      job.previousAccount=null;
      if(closed || generation!==saved.sources.find(s=>s.sourceId===source.sourceId)?.generation) return;
      const code=error.code===-32601?'UNSUPPORTED':controller.signal.aborted?'TIMEOUT':Object.hasOwn(messages,error.code)?error.code:'READ_FAILED';
      const failureCount=(state.failureCount||0)+1;
      const retryAfter=Number.isFinite(error.retryAfterMs)?Math.max(0,error.retryAfterMs):0;
      repo.saveState({...state,state:code==='AUTH_REQUIRED'?'auth_required':['UNSUPPORTED','TEAM_UNSUPPORTED'].includes(code)?'unsupported':'error',failureCount,
        ...(code==='IDENTITY_CHANGED'?{accountKey:null}:{}),nextAllowedAt:now()+Math.max(retryAfter,Math.min(3600000,120000*2**Math.min(5,failureCount-1))),retryAfterAt:now()+retryAfter,errorCode:code,rpcErrorCode:Number.isSafeInteger(error.code)?error.code:null,safeMessage:source.provider==='gemini'&&code==='AUTH_REQUIRED'?'Antigravity 授权不可用，请在工作台重新连接账号后重试':messages[code]});
    } finally {clearTimeout(timeout);controllers.delete(controller);}
  }
  function refresh(sourceIds,reason='open',internal=false) {
    if(closed) throw httpError(503,'额度服务正在关闭');
    if(configuring) throw httpError(503,'额度配置正在保存');
    if(!(internal?['task','notification']:['open','manual','interval']).includes(reason)) throw httpError(400,'无效的刷新原因');
    if(sourceIds!==undefined && (!Array.isArray(sourceIds)||sourceIds.length>3||sourceIds.some(id=>typeof id!=='string'||!saved.sources.some(s=>s.sourceId===id)))) throw httpError(400,'无效的额度来源');
    syncSources(); const acceptedSources=[];
    for(const source of saved.sources.filter(s=>!sourceIds||sourceIds.includes(s.sourceId))) {
      if(jobs.has(source.sourceId)) { acceptedSources.push(source.sourceId);continue; }
      if(!source.enabled && reason!=='manual') continue;
      const state=repo.state(source.sourceId), t=now();
      if(reason==='manual') { if(t-(lastManual.get(source.sourceId)??-Infinity)<5000||t<(state.retryAfterAt||0)) continue; lastManual.set(source.sourceId,t); }
      else if(t<(state.nextAllowedAt||0) || !internal && !dirty.has(source.sourceId) && state.lastSuccessAt && t-state.lastSuccessAt<120000) continue;
      if(internal && t-(lastEvent.get(source.sourceId)??-Infinity)<15000) continue;
      if(internal) lastEvent.set(source.sourceId,t);
      let resolve; const promise=new Promise(r=>{resolve=r;});
      const job={sourceId:source.sourceId,generation:source.generation,promise,resolve};jobs.set(source.sourceId,job);queue.push(job);acceptedSources.push(source.sourceId);
    }
    publish();pump();return {...snapshot(),acceptedSources};
  }
  const unsubscribe=subscribe(event=>{
    if(closed) return;
    for(const source of saved.sources) if(source.provider===event.provider && fingerprints.get(source.sourceId)===event.fingerprint) {
      dirty.add(source.sourceId);if(jobs.has(source.sourceId)) jobs.get(source.sourceId).invalidated=true;
      scheduleEvent(source);
    }
  });
  return {
    snapshot,refresh,
    subscribe(listener,{collect=true}={}) {if(closed) throw httpError(503,'额度服务正在关闭');listeners.set(listener,collect);return ()=>listeners.delete(listener);},
    async configure(input) {
      if(closed) throw httpError(503,'额度服务正在关闭');
      if(configuring) throw httpError(409,'额度配置正在保存');
      if(!input||typeof input.sourceId!=='string'||typeof input.enabled!=='boolean'||Object.keys(input).some(k=>!['sourceId','enabled','cliPath'].includes(k))) throw httpError(400,'无效的额度配置');
      const source=saved.sources.find(s=>s.sourceId===input.sourceId);if(!source) throw httpError(404,'额度来源不存在');
      if(input.cliPath!==undefined && (source.provider!=='gemini'||typeof input.cliPath!=='string'||input.cliPath.length>1024||input.cliPath && (!path.isAbsolute(input.cliPath)||!/\.exe$/i.test(input.cliPath)))) throw httpError(400,'官方 CLI 路径须为绝对 exe 路径');
      configuring=true;
      try {
        const next=structuredClone(saved), target=next.sources.find(s=>s.sourceId===source.sourceId);target.enabled=input.enabled;target.cliPath=input.cliPath??target.cliPath;target.configRevision=(target.configRevision||1)+1;
        await writeFile(`${configPath}.tmp`,JSON.stringify(next),{mode:0o600});await rename(`${configPath}.tmp`,configPath);saved=next;syncSources();publish();return snapshot();
      } finally {configuring=false;}
    },
    async close() {
      if(closed)return;closed=true;unsubscribe();clearTimeout(cleanupTimer);for(const timer of timers.values())clearTimeout(timer);timers.clear();
      for(const controller of controllers)controller.abort();
      for(const listener of listeners.keys()){try{listener(null);}catch{}}listeners.clear();
      for(const job of queue.splice(0)) {jobs.delete(job.sourceId);job.resolve();}
      await Promise.allSettled([...jobs.values()].map(j=>j.promise));
    },
  };
}
