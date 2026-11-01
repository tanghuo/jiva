import { createHmac, randomUUID } from 'node:crypto';
export function quotaIdentity({ provider, product, subject, workspace = '', email, salt, sessionKey }) {
  const verified = typeof subject === 'string' && subject.length > 0;
  const accountKey = verified ? createHmac('sha256',salt).update(JSON.stringify([provider,product,subject,workspace])).digest('hex') : sessionKey || randomUUID();
  return { accountKey, identityStatus: verified ? 'verified' : 'unverified',
    accountLabel: verified && typeof email === 'string' && email.includes('@') ? `${email.slice(0,1)}***@${email.split('@')[1]}` : '当前本机登录（身份未验证）' };
}
export const quotaError = code => Object.assign(new Error(code), { code });
