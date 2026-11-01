import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../../src/server/data/sqlite.js';
import { createQuotaRepository } from '../../src/server/data/quotaRepository.js';
import { createQuotaService } from '../../src/server/application/quotaService.js';
import { quotaBucket } from '../../src/shared/domain/quota.js';
import { createServer } from '../../src/server/server.js';
import { lanRestriction } from '../../src/server/http/lanRoutes.js';
import { quotaSourceFingerprint } from '../../src/agent/executors/quotaEvents.js';
import { readGrokQuota } from '../../src/agent/executors/grokQuota.js';
const result=(id='account')=>({accountKey:id,identityStatus:'verified',accountLabel:'a***@example.test',completeness:'full',limits:[],buckets:[quotaBucket({bucketId:'a',limitId:'a',label:'fixture',usedPercent:12})]});
const settle=async predicate=>{const until=Date.now()+5000;while(!predicate()){if(Date.now()>until)throw new Error('Quota did not settle');await new Promise(r=>setTimeout(r,10));}};
test('Grok quota authenticates headlessly before billing and does not reject stale cache metadata',{timeout:15000},async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'wiki-quota-grok-auth-')),previousGrokHome=process.env.GROK_HOME;
  t.after(async()=>{if(previousGrokHome===undefined)delete process.env.GROK_HOME;else process.env.GROK_HOME=previousGrokHome;assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wiki-quota-grok-auth-'));await rm(dir,{recursive:true,force:true});});
  const authHome=path.join(dir,'auth');await mkdir(authHome);process.env.GROK_HOME=authHome;
  await writeFile(path.join(authHome,'auth.json'),JSON.stringify({'https://auth.x.ai::fixture':{user_id:'fixture-subject',expires_at:1}}));
  const executable=path.join(dir,'grok.mjs');
  await writeFile(executable,`import readline from 'node:readline';import {appendFileSync} from 'node:fs';let authenticated=false;
    readline.createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);appendFileSync('calls.jsonl',JSON.stringify({method:v.method,params:v.params})+'\\n');let result;
      if(v.method==='initialize')result={authMethods:process.argv.includes('no-auth')?[]:[{id:'cached_token'}]};
      else if(v.method==='authenticate'){authenticated=v.params.methodId==='cached_token'&&v.params._meta?.headless===true;result={};}
      else if(v.method==='_x.ai/billing'&&authenticated)result={config:{creditUsagePercent:13}};
      if(result===undefined)process.stdout.write(JSON.stringify({id:v.id,error:{code:-32603,message:'Internal error'}})+'\\n');else process.stdout.write(JSON.stringify({id:v.id,result})+'\\n');
    });process.stdin.on('end',()=>process.exit(0));`);
  const result=await readGrokQuota({executable},{cwd:dir,signal:AbortSignal.timeout(10000),salt:'fixture'});
  assert.equal(result.buckets[0].remainingPercent,87);
  const calls=(await readFile(path.join(dir,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map(c=>c.method),['initialize','authenticate','_x.ai/billing']);assert.equal(calls[1].params._meta.headless,true);
  await assert.rejects(readGrokQuota({executable,model:'no-auth'},{cwd:dir,signal:AbortSignal.timeout(10000),salt:'fixture'}),{code:'AUTH_REQUIRED'});
});
async function setup(t,readers,options={}){const dir=await mkdtemp(path.join(os.tmpdir(),'wiki-quota-'));const db=initDb(':memory:');const repo=createQuotaRepository(db);let time=10000000;const service=await createQuotaService({repo,dataDir:dir,executionConfig:()=>({codexCli:{}}),readers,now:()=>time,subscribe:()=>()=>{},...options});t.after(async()=>{await service.close();db.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wiki-quota-'));await rm(dir,{recursive:true,force:true});});return {db,repo,service,advance:n=>{time+=n;}};}
test('quota repository keeps freshness separately, deduplicates history and removes only on full snapshots',async t=>{
  const {db,repo}=await setup(t,{});const state={sourceId:'s'};const r={...result(),sourceId:'s',observedAt:1000};
  repo.success(state,r,1);const count=()=>Number(db.prepare('SELECT count(*) n FROM quota_snapshot').get().n);assert.equal(count(),1);
  repo.success(state,{...r,observedAt:2000},2);assert.equal(count(),1);assert.equal(repo.current('s','account').buckets[0].observedAt,2000);
  repo.success(state,{...r,completeness:'partial',buckets:[],observedAt:3000},3);assert.equal(repo.current('s','account').buckets.length,1);assert.equal(repo.current('s','account').buckets[0].observedAt,2000);
  repo.success(state,{...r,buckets:[],observedAt:4000},4);assert.equal(repo.current('s','account').buckets.length,0);assert.equal(count(),2);
  repo.cleanup(31*86400000);assert.equal(count(),0);assert.ok(repo.current('s','account'));
});
test('quota scheduling accepts independently, caps concurrency, shares inflight, caches and backs off failures',async t=>{
  let active=0,peak=0,calls=0;let release;const blocked=new Promise(r=>{release=r;});
  const read=async()=>{calls++;active++;peak=Math.max(peak,active);await blocked;active--;return result();};
  const {service,advance}=await setup(t,{codex:read,grok:read,gemini:read});
  assert.equal(service.refresh(undefined,'open').acceptedSources.length,3);assert.equal(service.refresh(undefined,'open').acceptedSources.length,3);assert.equal(calls,2);
  release();await settle(()=>!service.snapshot().refreshingSources.length);assert.equal(calls,3);assert.equal(peak,2);
  assert.deepEqual(service.refresh(undefined,'open').acceptedSources,[]);assert.equal(service.refresh(undefined,'manual').acceptedSources.length,3);
  await settle(()=>!service.snapshot().refreshingSources.length);assert.deepEqual(service.refresh(undefined,'manual').acceptedSources,[]);
  advance(5000);assert.equal(service.refresh(undefined,'manual').acceptedSources.length,3);await settle(()=>!service.snapshot().refreshingSources.length);
});
test('quota errors are sanitized and config generation discards late responses',async t=>{
  let resolve;const {service,advance}=await setup(t,{codex:async()=>new Promise(r=>{resolve=r;}),grok:async()=>{throw Object.assign(new Error('SECRET token=must-not-leak'),{code:-32601});},gemini:async()=>result('gemini')});
  service.refresh(undefined,'open');await settle(()=>Boolean(resolve));const source=service.snapshot().sources.find(s=>s.provider==='codex');
  await service.configure({sourceId:source.sourceId,enabled:false});resolve(result('late'));await settle(()=>!service.snapshot().refreshingSources.length);
  const snap=service.snapshot();assert.equal(snap.accounts.some(a=>a.accountKey==='late'),false);assert.equal(snap.sources.find(s=>s.provider==='grok').state,'unsupported');assert.equal(JSON.stringify(snap).includes('SECRET'),false);
  const grok=snap.sources.find(s=>s.provider==='grok');assert.deepEqual(service.refresh([grok.sourceId],'open').acceptedSources,[]);advance(120000);assert.equal(service.refresh([grok.sourceId],'open').acceptedSources.length,1);
});
test('quota API protects local auth and LAN, streams snapshots and closes SSE before HTTP shutdown',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'wiki-quota-http-'));const app=await createServer({port:0,dataDir:dir,quotaReaders:{codex:async()=>result(),grok:async()=>result(),gemini:async()=>result()}});
  t.after(async()=>{await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('wiki-quota-http-'));await rm(dir,{recursive:true,force:true});});
  for(const suffix of ['', '/events','/refresh'])assert.equal((await fetch(new URL('/api/quota'+suffix,app.url),{method:suffix==='/refresh'?'POST':'GET'})).status,401);
  for(const method of ['GET','POST','PUT'])assert.ok(lanRestriction(method,'/api/quota/events',{allowWrite:true}));
  const headers={...app.managementHeaders(),'content-type':'application/json'};
  assert.equal((await fetch(new URL('/api/quota/refresh',app.url),{method:'POST',headers,body:'{"reason":"task"}'})).status,400);
  assert.equal((await fetch(new URL('/api/quota/refresh',app.url),{method:'POST',headers,body:'{"sourceIds":["missing"]}'})).status,400);
  const response=await fetch(new URL('/api/quota/events',app.url),{headers});const reader=response.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: snapshot/);
  assert.equal((await fetch(new URL('/api/quota/refresh',app.url),{method:'POST',headers,body:'{"reason":"manual"}'})).status,202);
  await app.close();await reader.cancel();
});
test('quota account changes clear old bindings, failures preserve confirmed identity values, and recovery clears errors',async t=>{
  let mode='success';
  const read=async(_config,context)=>{if(mode==='failure')throw new Error('offline');if(mode==='switch'){context.onIdentity({accountKey:'new-account'});throw Object.assign(new Error('login'),{code:'AUTH_REQUIRED'});}return result();};
  const {service,advance}=await setup(t,{codex:read,grok:read,gemini:read});const id=service.snapshot().sources[0].sourceId;
  const refresh=async()=>{service.refresh([id],'manual');await settle(()=>!service.snapshot().refreshingSources.length);advance(5000);};
  await refresh();const success=service.snapshot().sources[0].lastSuccessAt;
  mode='failure';await refresh();let snap=service.snapshot();assert.equal(snap.accounts[0].accountKey,'account');assert.equal(snap.sources[0].lastSuccessAt,success);assert.equal(snap.accounts[0].buckets[0].stale,true);
  mode='success';await refresh();snap=service.snapshot();assert.equal(snap.sources[0].failureCount,0);assert.equal(snap.sources[0].errorCode,null);assert.equal(snap.accounts[0].buckets[0].stale,false);
  mode='switch';await refresh();assert.equal(service.snapshot().accounts.length,0);assert.equal(service.snapshot().sources[0].lastSuccessAt,null);
});
test('quota disabled queued jobs do not launch, and cancellation closes owned work without launching queued probes',async t=>{
  let started=0,release;const blocked=new Promise(r=>{release=r;});const read=async()=>{started++;await blocked;return result();};
  const {service}=await setup(t,{codex:read,grok:read,gemini:read});service.refresh(undefined,'manual');assert.equal(started,2);
  const source=service.snapshot().sources.find(s=>s.provider==='gemini');await service.configure({sourceId:source.sourceId,enabled:false});release();await settle(()=>!service.snapshot().refreshingSources.length);assert.equal(started,2);
});
test('quota events stay dirty without a collecting subscriber and debounce into a cache-bypassing refresh',async t=>{
  let event,calls=0;const read=async()=>{calls++;return result();};const {service}=await setup(t,{codex:read,grok:read,gemini:read},{subscribe:listener=>{event=listener;return()=>{};}});
  const source=service.snapshot().sources[0],notice={provider:'codex',fingerprint:quotaSourceFingerprint('codex',{codexCli:{}})};
  service.refresh([source.sourceId],'open');await settle(()=>!service.snapshot().refreshingSources.length);assert.equal(calls,1);
  const offSettings=service.subscribe(()=>{},{collect:false});event(notice);await new Promise(r=>setTimeout(r,2100));assert.equal(calls,1);assert.equal(service.snapshot().sources[0].dirty,true);offSettings();
  const off=service.subscribe(()=>{});event(notice);event(notice);await settle(()=>calls===2);await settle(()=>!service.snapshot().refreshingSources.length);assert.equal(service.snapshot().sources[0].dirty,false);off();
});
