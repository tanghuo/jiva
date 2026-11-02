// Keep summary sections and content blocks distinct. Completed items are
// authoritative snapshots; avoid duplicating text already received as deltas.
export function createCodexReasoningEvents(onEvent) {
  const parts = new Map();
  async function emit(messageId, kind, partIndex, text, snapshot = false) {
    if (typeof text !== 'string') return;
    // An omitted/empty final block is not a retraction of streamed content.
    if (snapshot && !text.trim()) return;
    const key = JSON.stringify([messageId, kind, partIndex]);
    const previous = parts.get(key) || '';
    if (snapshot && text === previous || !snapshot && !text) return;
    parts.set(key, snapshot ? text : previous + text);
    await onEvent(snapshot ? 'reasoning.updated' : 'reasoning.delta', { messageId, kind, partIndex, text });
  }
  return async (method, params) => {
    if (method === 'item/reasoning/summaryTextDelta') return emit(params.itemId, 'summary', params.summaryIndex, params.delta);
    if (method === 'item/reasoning/textDelta') return emit(params.itemId, 'content', params.contentIndex, params.delta);
    if (['item/started', 'item/completed'].includes(method) && params.item?.type === 'reasoning') {
      for (const kind of ['summary', 'content']) {
        for (const [index, text] of (params.item[kind] || []).entries()) await emit(params.item.id, kind, index, text, true);
      }
    }
  };
}
