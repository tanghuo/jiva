import { quotaBucket, finiteNumber } from '../../shared/domain/quota.js';
import { quotaError } from './quotaIdentity.js';

const time = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
export function normalizeGeminiQuota(value) {
  const buckets = [], limits = [];
  if (!value || typeof value !== 'object') throw quotaError('PROTOCOL_ERROR');
  const groups = value.response?.groups ?? value.groups;
  if (Array.isArray(groups)) {
    for (const group of groups) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.buckets)) throw quotaError('PROTOCOL_ERROR');
      const groupId = group.groupId || group.displayName;
      if (typeof groupId !== 'string') continue;
      for (const bucket of group.buckets || []) {
        if (!bucket || typeof bucket !== 'object') throw quotaError('PROTOCOL_ERROR');
        if (typeof bucket.bucketId !== 'string' || bucket.disabled === true || bucket.enabled === false) continue;
        const fraction = finiteNumber(bucket.remaining?.remainingFraction ?? bucket.remainingFraction);
        buckets.push(quotaBucket({bucketId:`${groupId}:${bucket.bucketId}`,limitId:groupId,windowId:bucket.bucketId,
          label:`${group.displayName || groupId}（共享） · ${bucket.displayName || bucket.bucketId}`,remainingPercent:fraction === null ? null : fraction*100,
          windowMinutes: bucket.window === 'weekly' ? 10080 : bucket.window === '5h' ? 300 : null,
          resetsAt:time(bucket.remaining?.resetTime || bucket.resetTime) }));
      }
    }
  } else {
    const configs = value.userStatus?.cascadeModelConfigData?.clientModelConfigs;
    if (!Array.isArray(configs)) throw quotaError('PROTOCOL_ERROR');
    for (const model of configs) {
      const id = model.modelOrAlias?.model || model.model || model.label;
      if (typeof id !== 'string' || !model.quotaInfo) continue;
      const fraction = finiteNumber(model.quotaInfo.remainingFraction);
      buckets.push(quotaBucket({ bucketId:id,limitId:id,label:model.label || id,models:[id],remainingPercent:fraction === null ? null : fraction*100,resetsAt:time(model.quotaInfo.resetTime) }));
    }
  }
  if (!buckets.length) throw quotaError('QUOTA_UNAVAILABLE');
  if (buckets.length > 200 || new Set(buckets.map(b => b.bucketId)).size !== buckets.length) throw quotaError('PROTOCOL_ERROR');
  return { completeness:Array.isArray(groups) && buckets.every(bucket => bucket.remainingPercent !== null) ? 'full' : 'partial',limits,buckets };
}
