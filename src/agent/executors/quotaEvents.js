import { createHash } from 'node:crypto';
const listeners = new Set();
export function quotaSourceFingerprint(provider, config) {
  const fields = provider === 'codex' ? [config.codexCli?.executable || 'codex', config.codexCli?.codexHome || '', config.codexCli?.reuseLocalAuth === true] : provider === 'grok' ? [config.executable || 'grok'] : ['acp-oauth-v1', config.cliPath || ''];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
export function invalidateQuota(provider, config) {
  for (const listener of listeners) {
    try { Promise.resolve(listener({ provider, fingerprint: quotaSourceFingerprint(provider, config) })).catch(() => {}); } catch { /* Quotas never fail a workbench task. */ }
  }
}
export function subscribeQuotaInvalidation(listener) { listeners.add(listener); return () => listeners.delete(listener); }
