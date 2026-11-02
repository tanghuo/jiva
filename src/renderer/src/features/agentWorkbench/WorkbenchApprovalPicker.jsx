import { useEffect, useRef, useState } from 'react';
import { Check, Hand, ShieldCheck, TriangleAlert } from 'lucide-react';
import { approvalModes } from '../../../../shared/domain/agentWorkbench/approvalPolicy.js';

const icons = { ask: Hand, auto: ShieldCheck, allow: TriangleAlert };
const descriptions = {
  'antigravity-acp': {
    ask: '原生操作请求逐次审批',
    auto: '自动批准文件编辑和项目内已识别的只读命令（如 git status）；其他命令仍需确认',
    allow: 'Antigravity 自动执行文件编辑和命令，使用当前用户权限',
  },
  'grok-build': {
    ask: '修改文件或运行命令时始终询问',
    auto: '仅对 Grok 判定为风险的操作请求批准',
    allow: '自动执行范围内的文件修改和命令',
  },
  'codex-cli': {
    ask: '写入和命令都会询问',
    auto: '工作区内可直接修改，越界或危险操作仍会询问',
    allow: '自动执行工作区内的文件修改和命令',
  },
};

export default function WorkbenchApprovalPicker({ mode = 'ask', engine, disabled, active = false, update, onChange }) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({});
  const root = useRef(null), popup = useRef(null), trigger = useRef(null);
  const current = approvalModes.find(value => value.id === mode) || approvalModes[0];
  const Icon = icons[current.id] || ShieldCheck;
  const copy = descriptions[engine] || descriptions['grok-build'];
  const switchable = ['grok-build', 'codex-cli', 'antigravity-acp'].includes(engine);
  const locked = disabled || !switchable;
  const options = approvalModes.filter(value => switchable || value.id === 'ask');
  function close(focus = false) { setOpen(false); if (focus) trigger.current?.focus(); }
  function show(event) {
    if (locked) return;
    if (open) { close(); return; }
    trigger.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const above = rect.top >= window.innerHeight - rect.bottom;
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 372)),
      ...(above ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      maxHeight: Math.max(0, (above ? rect.top : window.innerHeight - rect.bottom) - 20),
    });
    setOpen(true);
  }
  useEffect(() => {
    if (!open) return;
    (popup.current?.querySelector('button[aria-pressed="true"]') || popup.current)?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) close(); };
    const resize = () => close();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); };
  }, [open]);
  return <div className="workbench-approval-picker" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const buttons = [...popup.current.querySelectorAll('.workbench-approval-option')];
      const index = buttons.indexOf(document.activeElement);
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }}>
    <button type="button" ref={trigger} className="workbench-approval-trigger" data-mode={current.id} aria-label="审批模式" aria-haspopup="dialog" aria-expanded={open} disabled={locked} title={active ? update?.message || `${copy[current.id]}。切换后将显示本轮生效范围` : copy[current.id]} onClick={show}>
      <Icon size={15} /><span>{current.label}{active && ({ partial: ' · 部分生效', deferred: ' · 下一轮', pending: ' · 应用中' }[update?.status] || '')}</span>
    </button>
    {open && <div ref={popup} tabIndex={-1} className="workbench-approval-popover" style={position} role="dialog" aria-label="选择审批模式">
      <header>应如何批准这些操作？</header>
      {active && <p className="workbench-muted">切换会尽量应用到本轮后续操作和待审批请求；原生引擎的限制会在切换后说明。已经执行的操作不受影响。</p>}
      {options.map(value => {
        const OptionIcon = icons[value.id];
        return <button type="button" className="workbench-approval-option" data-mode={value.id} key={value.id} aria-label={value.label} aria-pressed={mode === value.id} onClick={() => { if (value.id !== mode) onChange(value.id); close(true); }}>
          <OptionIcon size={18} />
          <span><strong>{value.label}</strong><small>{copy[value.id]}</small></span>
          {mode === value.id ? <Check size={16} /> : <span className="workbench-approval-check" aria-hidden="true" />}
        </button>;
      })}
    </div>}
  </div>;
}
