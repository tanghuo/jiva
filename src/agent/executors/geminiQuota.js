import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { normalizeGeminiQuota } from './geminiQuotaNormalizer.js';
import { readGeminiRemoteQuota } from './geminiRemoteQuota.js';
export { normalizeGeminiQuota } from './geminiQuotaNormalizer.js';
import { quotaIdentity, quotaError } from './quotaIdentity.js';
const exec = promisify(execFile);

export async function discoverAntigravity(signal) {
  if (process.platform !== 'win32') throw quotaError('UNSUPPORTED');
  // Query only the desktop's language server, check owner, and enumerate its sockets.
  const script = String.raw`$ErrorActionPreference='Stop'
    $candidates=@(Get-CimInstance Win32_Process -Filter "Name LIKE 'language_server%'")
    $items=@()
    foreach($candidate in $candidates) {
      if($candidate.ExecutablePath -notmatch '[\\/]antigravity[\\/]') { continue }
      $owner=Invoke-CimMethod -InputObject $candidate -MethodName GetOwner
      if($owner.User -ne $env:USERNAME) { continue }
      $ports=@(netstat.exe -ano -p TCP | Where-Object { $_ -match ('\sLISTENING\s+'+$candidate.ProcessId+'$') } | ForEach-Object { if($_ -match '\s(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)\s') { [int]$Matches[1] } } | Select-Object -Unique)
      $items+=@{pid=$candidate.ProcessId;command=$candidate.CommandLine;ports=$ports}
    }
    ConvertTo-Json -InputObject $items -Depth 4 -Compress`;
  const { stdout } = await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,shell:false,signal,timeout:10000,maxBuffer:1024*1024});
  const items = JSON.parse(stdout.replace(/^\uFEFF/,''));
  return items.map(item => {
    const flag = name => { const m = item.command.match(new RegExp(`--${name}(?:=|\\s+)(?:"([^"]+)"|([^\\s]+))`)); return m?.[1] || m?.[2] || ''; };
    return { pid:item.pid, csrf:flag('csrf_token'), extensionCsrf:flag('extension_server_csrf_token'), extensionPort:Number(flag('extension_server_port')), ports:item.ports };
  }).filter(item => item.csrf && Array.isArray(item.ports));
}
export function antigravityRequest({ port, csrf, secure = true }, method, signal) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw quotaError('PROTOCOL_ERROR');
  const body = JSON.stringify({ metadata:{ideName:'antigravity',extensionName:'antigravity',locale:'en',ideVersion:'unknown'} });
  return new Promise((resolve,reject) => {
    // Certificate exception applies to this same-user loopback request only.
    const req = (secure ? https : http).request({hostname:'127.0.0.1',port,method:'POST',path:`/exa.language_server_pb.LanguageServerService/${method}`,rejectUnauthorized:false,signal,
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),'X-Codeium-Csrf-Token':csrf,'Connect-Protocol-Version':'1'} }, res => {
      let text='', size=0;
      res.on('data',chunk => { size+=chunk.length; if(size>1024*1024) req.destroy(quotaError('OUTPUT_LIMIT')); else text+=chunk; });
      res.on('error',reject);
      res.on('end',() => { if(res.statusCode !== 200) return reject(quotaError(res.statusCode === 401 || res.statusCode === 403 ? 'AUTH_REQUIRED' : 'UNSUPPORTED')); try { resolve(JSON.parse(text)); } catch { reject(quotaError('PROTOCOL_ERROR')); } });
    });
    req.setTimeout(3000,() => req.destroy(quotaError('TIMEOUT'))); req.on('error',reject); req.end(body);
  });
}
export async function readGeminiDesktopQuota(config, context) {
  const candidates = await discoverAntigravity(context.signal);
  if (!candidates.length) throw quotaError('NOT_RUNNING');
  // Several independent desktop sessions cannot be silently treated as one account.
  if (candidates.length > 1) throw quotaError('AMBIGUOUS_SOURCE');
  const candidate = candidates[0];
  let lastError = quotaError('UNSUPPORTED');
  const endpoints = candidate.ports.slice(0,8).map(port => ({port,csrf:candidate.csrf,secure:true}));
  if(candidate.extensionPort) endpoints.push({port:candidate.extensionPort,csrf:candidate.extensionCsrf || candidate.csrf,secure:false});
  for (const endpoint of endpoints) {
    for (const method of ['RetrieveUserQuotaSummary','GetUserStatus']) {
      context.signal?.throwIfAborted();
      try {
        const value = await antigravityRequest(endpoint,method,context.signal);
        const normalized = normalizeGeminiQuota(value);
        if (!normalized.buckets.some(bucket => bucket.remainingPercent !== null)) throw quotaError('QUOTA_UNAVAILABLE');
        // Desktop identity is not assumed to match the ACP or CLI login.
        return { ...normalized,...quotaIdentity({provider:'gemini',product:'antigravity',...context,sessionKey:randomUUID()}) };
      } catch(error) { lastError=error; }
    }
  }
  throw lastError;
}

// Existing ACP credentials select the account. Never substitute an unrelated desktop login
// when that account is expired, unavailable, or missing Gemini quota.
export async function readGeminiQuota(config, context, { readRemote = readGeminiRemoteQuota, readDesktop = readGeminiDesktopQuota } = {}) {
  context.signal?.throwIfAborted();
  const remote = await readRemote(context);
  context.signal?.throwIfAborted();
  return remote ?? readDesktop(config, context);
}
