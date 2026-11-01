// Account quotas are independent of this application's token usage.
export const quotaProviders = [
  { provider: 'codex', product: 'chatgpt', label: 'Codex' },
  { provider: 'grok', product: 'grok-build', label: 'Grok Build' },
  { provider: 'gemini', product: 'antigravity', label: 'Gemini · Antigravity' },
];
export const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const quotaPercent = value => finiteNumber(value) !== null && value >= 0 && value <= 100 ? value : null;
export function quotaBucket(value) {
  const used = quotaPercent(value.usedPercent), remaining = quotaPercent(value.remainingPercent);
  const balance = finiteNumber(value.balance?.value) !== null && typeof value.balance?.unit === 'string' && /^[\w $€¥.-]{1,24}$/.test(value.balance.unit) ? { value: value.balance.value, unit: value.balance.unit } : null;
  return {
    bucketId: value.bucketId, limitId: value.limitId, windowId: value.windowId || '', label: value.label,
    models: Array.isArray(value.models) ? value.models.filter(x => typeof x === 'string').slice(0, 100) : [],
    usedPercent: used ?? (remaining === null ? null : 100 - remaining),
    remainingPercent: remaining ?? (used === null ? null : 100 - used),
    windowMinutes: finiteNumber(value.windowMinutes) > 0 ? value.windowMinutes : null,
    resetsAt: finiteNumber(value.resetsAt) > 0 ? value.resetsAt : null, balance,
    status: used !== null || remaining !== null ? 'ok' : balance ? 'balance_only' : 'unknown',
  };
}
export function quotaPresentation(sources, accounts, now = Date.now()) {
  const presented = accounts.map(account => {
    const source = sources.find(s => s.sourceId === account.sourceId);
    const buckets = account.buckets.map(bucket => ({ ...bucket, ageMs: Math.max(0, now - bucket.observedAt),
      stale: source?.state !== 'ok' || now - bucket.observedAt > 1800000 || bucket.resetsAt !== null && bucket.resetsAt <= now,
    }));
    return { ...account, buckets };
  });
  const candidates = presented.flatMap(a => a.buckets.filter(b => !b.stale && b.remainingPercent !== null).map(b => ({ ...b, sourceId: a.sourceId, provider: a.provider, product: a.product })));
  candidates.sort((a, b) => a.remainingPercent - b.remainingPercent || (b.resetsAt ?? 0) - (a.resetsAt ?? 0) || `${a.sourceId}:${a.bucketId}`.localeCompare(`${b.sourceId}:${b.bucketId}`));
  const reached = presented.flatMap(a => a.limits.filter(l => l.reached === true && sources.find(s => s.sourceId === a.sourceId)?.state === 'ok' && now - a.observedAt <= 1800000 && !a.buckets.some(b => b.limitId === l.limitId && b.stale)).map(l => ({ ...l, sourceId: a.sourceId, provider: a.provider, product: a.product, reached: true })));
  reached.sort((a,b) => `${a.sourceId}:${a.limitId}`.localeCompare(`${b.sourceId}:${b.limitId}`));
  return { accounts: presented, tightest: reached[0] || candidates[0] || null };
}
