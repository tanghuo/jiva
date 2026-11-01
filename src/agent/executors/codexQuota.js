import { startCodexAppServer } from './codexAppServer.js';
import { quotaBucket, finiteNumber } from '../../shared/domain/quota.js';
import { quotaIdentity, quotaError } from './quotaIdentity.js';

export function normalizeCodexQuota(value) {
  let groups;
  if (Object.hasOwn(value, 'rateLimitsByLimitId') && value.rateLimitsByLimitId !== null) {
    if (typeof value.rateLimitsByLimitId !== 'object' || Array.isArray(value.rateLimitsByLimitId)) throw quotaError('PROTOCOL_ERROR');
    groups = Object.entries(value.rateLimitsByLimitId);
  } else groups = value.rateLimits ? [[value.rateLimits.limitId || 'codex', value.rateLimits]] : [];
  const limits = [], buckets = [];
  for (const [id, group] of groups) {
    if (!group || typeof group !== 'object') throw quotaError('PROTOCOL_ERROR');
    const label = typeof group.limitName === 'string' ? group.limitName.slice(0,120) : id;
    limits.push({ limitId: id, label, reached: group.rateLimitReachedType ? true : null, reachedType: typeof group.rateLimitReachedType === 'string' ? group.rateLimitReachedType : null });
    for (const windowId of ['primary', 'secondary']) {
      const window = group[windowId]; if (!window) continue;
      buckets.push(quotaBucket({ bucketId: `${id}:${windowId}`, limitId: id, windowId,
        label: `${label} · ${window.windowDurationMins ? `${window.windowDurationMins} 分钟` : windowId}`,
        usedPercent: window.usedPercent, windowMinutes: window.windowDurationMins,
        resetsAt: finiteNumber(window.resetsAt) === null ? null : window.resetsAt * 1000 }));
    }
  }
  return { limits, buckets, completeness: 'full' };
}
export async function readCodexQuota(config, context) {
  const client = await startCodexAppServer(config, { cwd: context.cwd, signal: context.signal, configurationOnly: true, restricted: true, quotaOnly: true });
  try {
    const before = client.account;
    if (before.account?.type === 'apiKey') throw quotaError('UNSUPPORTED');
    if (!before.account) throw quotaError('AUTH_REQUIRED');
    const identity = quotaIdentity({ provider:'codex', product:'chatgpt', subject:before.workspaceRouting?.chatgptAccountId, email:before.account.email, ...context });
    context.onIdentity?.(identity);
    const value = await client.request('account/rateLimits/read', {}, 10000);
    const after = await client.request('account/read', { refreshToken: false }, 10000);
    const subject = before.workspaceRouting?.chatgptAccountId;
    if (subject && (subject !== after.workspaceRouting?.chatgptAccountId || value.accountId && value.accountId !== subject)) throw quotaError('IDENTITY_CHANGED');
    return { ...normalizeCodexQuota(value), ...identity };
  } finally { await client.close(); }
}
