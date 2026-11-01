import { toolStatus } from '../../shared/domain/agentWorkbench/events.js';

// ACP v1 has no message ID/phase. Separate replies and thoughts, and start
// a new segment when the content type changes or tool/plan activity intervenes.
export function createAcpWorkbenchEvents(onEvent) {
  let message = 0, speaking;
  return value => {
    if (['agent_message_chunk', 'agent_thought_chunk'].includes(value.sessionUpdate) && value.content?.type === 'text') {
      if (!value.content.text) return;
      const type = value.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'message';
      if (speaking !== type) message++;
      speaking = type;
      return onEvent(`${type}.delta`, { text: value.content.text, messageId: `acp-${type}-${message}` });
    }
    if (value.sessionUpdate === 'plan') {
      speaking = undefined;
      return onEvent('plan.updated', { entries: value.entries });
    }
    if (['tool_call', 'tool_call_update'].includes(value.sessionUpdate)) {
      speaking = undefined;
      return onEvent('tool.updated', { id: value.toolCallId, title: value.title, status: toolStatus(value.status ?? (value.sessionUpdate === 'tool_call' ? 'pending' : undefined)), kind: value.kind, content: value.content });
    }
  };
}
