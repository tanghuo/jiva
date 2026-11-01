import { randomUUID } from 'node:crypto';

export function createQuotaRepository(db) {
  const stateGet = db.prepare('SELECT payload FROM quota_source_state WHERE source_id=?');
  const statePut = db.prepare('INSERT INTO quota_source_state VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload');
  const currentGet = db.prepare('SELECT payload FROM quota_current WHERE source_id=? AND account_key=?');
  const currentPut = db.prepare('INSERT INTO quota_current VALUES(?,?,?,?,?) ON CONFLICT(source_id,account_key) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,observed_at=excluded.observed_at');
  const history = db.prepare('SELECT captured_at,payload,event_type FROM quota_snapshot WHERE source_id=? AND account_key=? AND bucket_id=? ORDER BY captured_at DESC,rowid DESC LIMIT 1');
  const append = db.prepare('INSERT INTO quota_snapshot VALUES(?,?,?,?,?,?,?,?)');
  const repo = {
    state(sourceId) { const row = stateGet.get(sourceId); return row ? JSON.parse(row.payload) : null; },
    saveState(state) { statePut.run(state.sourceId, JSON.stringify(state)); },
    current(sourceId, accountKey) { const row = currentGet.get(sourceId, accountKey); return row ? JSON.parse(row.payload) : null; },
    success(state, result, revision) {
      // Only one bounded provider snapshot (at most 200 buckets) is atomic. No I/O here.
      if (result.buckets.length > 200) throw new Error('Quota bucket limit exceeded');
      const previous = repo.current(result.sourceId, result.accountKey);
      const incoming = new Map(result.buckets.map(b => [b.bucketId, { ...b, observedAt: result.observedAt }]));
      const buckets = result.completeness === 'partial' ? new Map((previous?.buckets || []).map(b => [b.bucketId, b])) : new Map();
      for (const [id, bucket] of incoming) buckets.set(id, bucket);
      const limits = result.completeness === 'partial' ? [...new Map([...(previous?.limits || []), ...result.limits].map(l => [l.limitId,l])).values()] : result.limits;
      const next = { ...result, limits, buckets: [...buckets.values()] };
      const samples = [];
      const sample = (bucket, eventType) => {
        const data = JSON.stringify({ ...bucket, observedAt: undefined, limits: limits.filter(l => l.limitId === bucket.limitId) });
        const last = history.get(result.sourceId, result.accountKey, bucket.bucketId);
        if (!last || last.payload !== data || last.event_type !== eventType || result.observedAt - last.captured_at >= 1800000) samples.push([randomUUID(), result.sourceId,result.accountKey,bucket.bucketId,bucket.limitId,result.observedAt,eventType,data]);
      };
      for (const bucket of incoming.values()) sample(bucket, 0);
      if (result.completeness === 'full') for (const bucket of previous?.buckets || []) if (!incoming.has(bucket.bucketId)) sample(bucket, 1);
      // Limits can exist without windows; retain their changes as group events.
      for (const limit of result.limits) sample({ bucketId: `@limit:${limit.limitId}`, limitId: limit.limitId, ...limit }, 2);
      db.exec('BEGIN IMMEDIATE');
      try {
        currentPut.run(result.sourceId,result.accountKey,JSON.stringify(next),revision,result.observedAt);
        for (const args of samples) append.run(...args);
        repo.saveState(state);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return next;
    },
    cleanup(now = Date.now()) {
      return Number(db.prepare('DELETE FROM quota_snapshot WHERE rowid IN (SELECT rowid FROM quota_snapshot WHERE captured_at<? LIMIT 500)').run(now - 30 * 86400000).changes);
    },
  };
  return repo;
}
