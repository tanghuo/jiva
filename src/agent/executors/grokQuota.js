import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startGrokAcp } from './grokProcess.js';
import { finiteNumber, quotaBucket } from '../../shared/domain/quota.js';
import { quotaIdentity, quotaError } from './quotaIdentity.js';
const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
export function normalizeGrokQuota(value) {
  const c = value.config || value, period = c.currentPeriod || value.billingCycle || {};
  const start = timestamp(period.start || period.billingPeriodStart || c.billingPeriodStart);
  const end = timestamp(period.end || period.billingPeriodEnd || c.billingPeriodEnd);
  let usedPercent = finiteNumber(c.creditUsagePercent);
  if (usedPercent === null && finiteNumber(value.monthlyLimit?.val) > 0 && finiteNumber(value.usage?.totalUsed?.val) !== null) usedPercent = value.usage.totalUsed.val / value.monthlyLimit.val * 100;
  const buckets = [quotaBucket({ bucketId:'credits',limitId:'credits',windowId:'period',label:period.type==='USAGE_PERIOD_TYPE_WEEKLY'?'Grok · 每周积分':'Grok · 积分周期', usedPercent,
    resetsAt:end,windowMinutes:start !== null && end > start ? (end-start)/60000 : null })];
  // The verified billing protocol expresses val in cents, not dollars or a quota pool.
  if (finiteNumber(c.prepaidBalance?.val) !== null) buckets.push(quotaBucket({ bucketId:'prepaid',limitId:'wallet',label:'预付余额',balance:{ value:c.prepaidBalance.val,unit:'cents' } }));
  return { completeness:'full',limits:[],buckets };
}
async function authIdentity() {
  try {
    const data = JSON.parse(await readFile(path.join(process.env.GROK_HOME || path.join(os.homedir(),'.grok'),'auth.json'),'utf8'));
    const entries = Object.entries(data).filter(([k,v]) => k.startsWith('https://auth.x.ai::') && v && typeof v === 'object');
    // Multiple cached principals cannot be attributed merely by preferring the first entry.
    if (entries.length !== 1) return {};
    const v = entries[0][1];
    return { subject: v.user_id, workspace: v.team_id || '', email:v.email, team:v.principal_type === 'team' };
  } catch { return {}; }
}
export async function readGrokQuota(config, context) {
  const before = await authIdentity();
  if (before.team) throw quotaError('TEAM_UNSUPPORTED');
  const client = await startGrokAcp({ ...config,model:config.model || 'grok-4.6' }, { cwd:context.cwd,signal:context.signal,quotaOnly:true });
  try {
    const init=await client.request('initialize',{ protocolVersion:1,clientCapabilities:{},clientInfo:{name:'self-wiki-quota',version:'1'} },10000);
    if(!init.authMethods?.some(method=>method.id==='cached_token'))throw quotaError('AUTH_REQUIRED');
    // Let the official CLI establish its cached login, as the workbench does.
    // auth.json expiry alone is not proof that the CLI cannot authenticate.
    await client.request('authenticate',{methodId:'cached_token',_meta:{headless:true}},10000);
    const value = await client.request('_x.ai/billing',{},10000);
    const after = await authIdentity();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw quotaError('IDENTITY_CHANGED');
    // RPC does not echo its principal: keep attribution unverified even if auth.json exists.
    return { ...normalizeGrokQuota(value), ...quotaIdentity({provider:'grok',product:'grok-build',...context,sessionKey:randomUUID()}) };
  } finally { await client.close(); }
}
