import https from 'node:https';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { quotaError, quotaIdentity } from './quotaIdentity.js';
import { normalizeGeminiQuota } from './geminiQuotaNormalizer.js';
import { antigravityVersion } from './antigravityProcess.js';

export const geminiCredentialPath = () => path.join(os.homedir(), '.gemini', 'antigravity-acp', 'acp_token.json');
const origins = ['https://daily-cloudcode-pa.googleapis.com', 'https://cloudcode-pa.googleapis.com'];
const allowedHosts = new Set(['oauth2.googleapis.com', 'www.googleapis.com', ...origins.map(url => new URL(url).hostname)]);

// No redirects, server-supplied URLs, raw diagnostics, token persistence, or TLS exceptions.
export function googleQuotaRequest(url, { body, headers = {}, signal } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !allowedHosts.has(target.hostname) || target.port || target.username || target.password) throw quotaError('PROTOCOL_ERROR');
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = https.request(target, { method: body === undefined ? 'GET' : 'POST', signal,
      headers: { ...headers, ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }) } }, res => {
      let size = 0, text = '';
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) req.destroy(quotaError('OUTPUT_LIMIT'));
        else text += chunk;
      });
      res.on('error', () => reject(quotaError('READ_FAILED')));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(quotaError(
          res.statusCode === 401 || target.hostname === 'oauth2.googleapis.com' && [400, 403].includes(res.statusCode)
            ? 'AUTH_REQUIRED' : res.statusCode === 403 ? 'QUOTA_UNAVAILABLE' : 'READ_FAILED'));
        try { resolve(JSON.parse(text)); } catch { reject(quotaError('PROTOCOL_ERROR')); }
      });
    });
    // Absolute deadline also bounds a server that trickles response bytes forever.
    const timer = setTimeout(() => req.destroy(quotaError('TIMEOUT')), 10000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', error => reject(quotaError(signal?.aborted ? 'TIMEOUT' : ['TIMEOUT', 'OUTPUT_LIMIT'].includes(error.code) ? error.code : 'READ_FAILED')));
    req.end(body);
  });
}

async function credentials(file) {
  let handle;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw quotaError('PROTOCOL_ERROR');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw quotaError(error.code === 'PROTOCOL_ERROR' ? error.code : 'READ_FAILED');
  } finally { await handle?.close(); }
}

export async function readGeminiRemoteQuota(context, { credentialPath = geminiCredentialPath(), request = googleQuotaRequest } = {}) {
  const { signal } = context;
  signal?.throwIfAborted();
  const before = await credentials(credentialPath);
  if (before === null) return null;
  let token;
  try { token = JSON.parse(before); } catch { throw quotaError('PROTOCOL_ERROR'); }
  if (!token || ['client_id', 'client_secret', 'refresh_token'].some(key => typeof token[key] !== 'string' || !token[key])) throw quotaError('AUTH_REQUIRED');
  if (token.project_id !== undefined && typeof token.project_id !== 'string') throw quotaError('PROTOCOL_ERROR');
  const refreshed = await request('https://oauth2.googleapis.com/token', {
    signal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: token.client_id, client_secret: token.client_secret, refresh_token: token.refresh_token, grant_type: 'refresh_token' }).toString(),
  });
  if (typeof refreshed?.access_token !== 'string' || !refreshed.access_token) throw quotaError('AUTH_REQUIRED');
  const authorization = { Authorization: `Bearer ${refreshed.access_token}` };
  let user;
  try { user = await request('https://www.googleapis.com/oauth2/v2/userinfo', { signal, headers: authorization }); }
  catch { signal?.throwIfAborted(); /* Quota remains usable without a verified identity. */ }
  const identity = quotaIdentity({ ...context, provider: 'gemini', product: 'antigravity',
    subject: typeof user?.id === 'string' ? user.id : undefined, email: user?.email,
    workspace: token.project_id || '', sessionKey: randomUUID() });
  if (identity.identityStatus === 'verified' && !user.email) identity.accountLabel = 'Antigravity ACP 登录（身份已验证）';
  if (identity.identityStatus === 'unverified') identity.accountLabel = 'Antigravity ACP 登录（身份未验证）';
  context.onIdentity?.(identity);
  let result, lastError = quotaError('QUOTA_UNAVAILABLE');
  for (const origin of origins) {
    signal?.throwIfAborted();
    try {
      const value = await request(`${origin}/v1internal:retrieveUserQuotaSummary`, {
        signal, headers: { ...authorization, 'content-type': 'application/json',
          'User-Agent': `antigravity/acp/${antigravityVersion} (aidev_client; os_type=${process.platform}; arch=${process.arch})` },
        body: JSON.stringify(token.project_id ? { project: token.project_id } : {}),
      });
      const normalized = normalizeGeminiQuota(value);
      // A nonempty third-party group alone does not prove Gemini quota was returned.
      if (!normalized.buckets.some(bucket => bucket.windowId.startsWith('gemini-') && bucket.remainingPercent !== null)) throw quotaError('QUOTA_UNAVAILABLE');
      result = { ...normalized, ...identity };
      break;
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
    }
  }
  signal?.throwIfAborted();
  // Do not publish a result for a login that changed while the requests were running.
  if (before !== await credentials(credentialPath)) throw quotaError('IDENTITY_CHANGED');
  if (!result) throw lastError;
  return result;
}
