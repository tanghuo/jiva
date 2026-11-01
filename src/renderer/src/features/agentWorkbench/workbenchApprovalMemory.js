const KEY = 'workbenchLastApprovalMode';
const modes = new Set(['ask', 'auto', 'allow']);

function storageOf(storage) {
  return storage || globalThis.localStorage;
}

function readModes(storage) {
  try {
    const parsed = JSON.parse(storageOf(storage).getItem(KEY) || '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([engine, mode]) => {
      if (!['grok-build', 'antigravity-acp'].includes(engine) || !modes.has(mode)) return [];
      return [[engine, mode]];
    }));
  } catch {
    return {};
  }
}

export function rememberedApprovalMode(engine, storage) {
  if (!['grok-build', 'antigravity-acp'].includes(engine)) return 'ask';
  return readModes(storage)[engine] || 'ask';
}

export function hasRememberedApprovalMode(engine, storage) {
  return ['grok-build', 'antigravity-acp'].includes(engine) && Boolean(readModes(storage)[engine]);
}

export function rememberApprovalMode(engine, mode, storage) {
  if (!['grok-build', 'antigravity-acp'].includes(engine) || !modes.has(mode)) return;
  const target = storageOf(storage);
  if (!target) return;
  try { target.setItem(KEY, JSON.stringify({ ...readModes(target), [engine]: mode })); } catch { /* keep the in-memory choice when storage is unavailable */ }
}
