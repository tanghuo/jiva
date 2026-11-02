import { agentError } from './contracts.js';

export const approvalModes = Object.freeze([
  { id: 'ask', label: '手动审批' },
  { id: 'auto', label: '自动审批' },
  { id: 'allow', label: '全部允许' },
]);

export function approvalMode(value = 'ask', engine = 'grok-build') {
  if (!approvalModes.some(mode => mode.id === value)) throw agentError('INVALID_POLICY', '无效的审批模式');
  if (!['grok-build', 'codex-cli', 'antigravity-acp'].includes(engine) && value !== 'ask') throw agentError('UNSUPPORTED_POLICY', '此引擎暂不支持该审批模式');
  return value;
}

// Native classifiers and sandboxes may be frozen for the duration of a prompt.
// Only advertise the portion that our mandatory approval gateways can enforce.
export function liveApprovalPolicy(engine, nativeMode, requestedMode) {
  if (nativeMode === requestedMode || engine === 'antigravity-acp') return { mode: requestedMode, status: 'applied', message: '已对本轮后续操作生效；已执行的操作不受影响' };
  if (engine === 'grok-build') {
    if (requestedMode === 'auto') return { mode: 'ask', status: 'partial', message: '本轮先按手动审批处理；Grok 自动判断从下一轮生效' };
    return { mode: requestedMode, status: 'applied', message: '已对本轮后续操作及待审批请求生效' };
  }
  if (engine === 'codex-cli' && requestedMode === 'allow') return { mode: 'allow', status: 'partial', message: '本轮收到的审批请求已自动放行；Codex 原生审批策略和沙箱权限从下一轮生效' };
  return { mode: nativeMode, status: 'deferred', message: '已保存，下一轮生效；当前引擎无法在本轮切换原生审批策略和沙箱权限' };
}
