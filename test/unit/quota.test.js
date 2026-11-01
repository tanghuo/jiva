import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCodexQuota } from '../../src/agent/executors/codexQuota.js';
import { normalizeGrokQuota } from '../../src/agent/executors/grokQuota.js';
import { normalizeGeminiQuota } from '../../src/agent/executors/geminiQuota.js';
import { quotaBucket,quotaPresentation } from '../../src/shared/domain/quota.js';
import { quotaIdentity } from '../../src/agent/executors/quotaIdentity.js';
import { invalidateQuota,subscribeQuotaInvalidation } from '../../src/agent/executors/quotaEvents.js';
const fixture = provider => JSON.parse(readFileSync(new URL(`../fixtures/quota/${provider}.json`,import.meta.url),'utf8'));
test('quota normalizers preserve real provider units, maps and zero without inventing absent percentages',()=>{
  const codex=normalizeCodexQuota(fixture('codex'));
  assert.equal(codex.buckets.length,2);assert.equal(codex.buckets[0].windowMinutes,300);assert.equal(codex.buckets[1].windowMinutes,10080);
  assert.equal(codex.buckets[0].resetsAt,fixture('codex').rateLimits.primary.resetsAt*1000);
  assert.deepEqual(normalizeCodexQuota({rateLimitsByLimitId:{},rateLimits:fixture('codex').rateLimits}).buckets,[]);
  assert.equal(normalizeCodexQuota({rateLimits:fixture('codex').rateLimits}).buckets.length,2);
  const multi=normalizeCodexQuota({rateLimitsByLimitId:{a:{rateLimitReachedType:'group',primary:{usedPercent:0}},b:{secondary:{usedPercent:100}}}});
  assert.equal(multi.limits[0].reached,true);assert.equal(multi.buckets[0].remainingPercent,100);assert.equal(multi.buckets[1].remainingPercent,0);
  const grok=normalizeGrokQuota(fixture('grok'));
  assert.equal(grok.buckets[0].usedPercent,11);assert.equal(grok.buckets[1].status,'balance_only');assert.deepEqual(grok.buckets[1].balance,{value:0,unit:'cents'});
  assert.equal(normalizeGrokQuota({config:{currentPeriod:{end:'2026-11-01'}}}).buckets[0].usedPercent,null);
  assert.equal(normalizeGrokQuota({monthlyLimit:{val:100},usage:{totalUsed:{val:5}}}).buckets[0].remainingPercent,95);
  assert.equal(normalizeGrokQuota({monthlyLimit:{val:0},usage:{totalUsed:{val:0}}}).buckets[0].usedPercent,null);
  const gemini=normalizeGeminiQuota(fixture('gemini'));
  assert.equal(gemini.buckets.length,4);assert.equal(gemini.buckets[0].remainingPercent,98.21942);assert.equal(gemini.buckets[0].windowMinutes,10080);
  assert.equal(gemini.buckets[1].remainingPercent,100);assert.notEqual(gemini.buckets[0].limitId,gemini.buckets[2].limitId);
});
test('quota freshness, resets, group limits and stable ordering do not advertise old data as current',()=>{
  for(const usedPercent of [null,undefined,NaN,Infinity,-1,101,'0'])assert.equal(quotaBucket({usedPercent}).remainingPercent,null);
  const sources=[{sourceId:'s',state:'ok'}],bucket=(id,p,reset)=>({...quotaBucket({bucketId:id,label:id,usedPercent:100-p,resetsAt:reset}),observedAt:1000});
  const account={sourceId:'s',provider:'grok',observedAt:1000,limits:[],buckets:[bucket('a',5,2000),bucket('b',5,3000),bucket('c',0,1500)]};
  assert.equal(quotaPresentation(sources,[account],1600).tightest.bucketId,'b');
  assert.equal(quotaPresentation([{sourceId:'s',state:'error'}],[account],1600).tightest,null);
  assert.equal(quotaPresentation(sources,[account],1801001).tightest,null);
  const reached={...account,limits:[{limitId:'x',reached:true}],buckets:[]};assert.equal(quotaPresentation(sources,[reached],1600).tightest.reached,true);
});
test('quota identities include provider, product and workspace; subscriber faults never reach the workbench',async()=>{
  const identity=workspace=>quotaIdentity({provider:'codex',product:'chatgpt',subject:'private-id',workspace,email:'private@example.test',salt:'local-salt'});
  assert.equal(identity('team-a').accountKey,identity('team-a').accountKey);assert.notEqual(identity('team-a').accountKey,identity('team-b').accountKey);
  assert.equal(JSON.stringify(identity('team-a')).includes('private-id'),false);assert.equal(identity('team-a').accountLabel,'p***@example.test');
  assert.notEqual(quotaIdentity({salt:'salt'}).accountKey,quotaIdentity({salt:'salt'}).accountKey);
  let received=0;const off1=subscribeQuotaInvalidation(()=>{throw new Error('subscriber failure');});const off2=subscribeQuotaInvalidation(async()=>{throw new Error('async subscriber failure');});const off3=subscribeQuotaInvalidation(()=>{received++;});
  try{invalidateQuota('codex',{codexCli:{}});await Promise.resolve();assert.equal(received,1);}finally{off1();off2();off3();}
  const secret='SENSITIVE_SENTINEL';for(const normalizer of [normalizeCodexQuota,normalizeGrokQuota])assert.equal(JSON.stringify(normalizer({secret})).includes(secret),false);
});
