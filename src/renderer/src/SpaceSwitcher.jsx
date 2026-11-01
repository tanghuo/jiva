import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { DialogFrame } from "./ui/ConfirmDialog.jsx";
import { SPACE_COLOR_PRESETS } from "./spacePreferences.js";

export function CreateSpaceDialog({ busy, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SPACE_COLOR_PRESETS[0].color);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    try { await onCreate({ name, color }); }
    catch (failure) { setError(failure.message); }
  }
  return <DialogFrame label="新建空间" title="新建空间" description="名称必填；颜色用于侧栏顶的淡色提示。" busy={busy} onClose={onClose} closeLabel="关闭"
    onSubmit={submit}
    footer={<>
      <button type="button" disabled={busy} onClick={onClose}>取消</button>
      <button type="submit" className="primary" disabled={busy || !name.trim()}>{busy ? "正在创建…" : "创建并切换"}</button>
    </>}>
    <label className="field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={40} disabled={busy} placeholder="例如：工作" /></label>
    <fieldset className="space-color-picker">
      <legend>颜色</legend>
      <div className="space-color-options">
        {SPACE_COLOR_PRESETS.map((preset) => <label key={preset.color} className="space-color-option" title={preset.name}>
          <input type="radio" name="space-color" value={preset.color} checked={color === preset.color} disabled={busy} onChange={() => setColor(preset.color)} />
          <span style={{ background: preset.color }} aria-hidden="true" />
          <span className="space-color-name">{preset.name}</span>
        </label>)}
      </div>
    </fieldset>
    {error && <p className="wiki-error" role="alert">{error}</p>}
  </DialogFrame>;
}

export function MoveToSpaceDialog({ spaces, currentSpaceId, count, busy, onClose, onMove }) {
  const targets = spaces.filter((space) => space.id !== currentSpaceId);
  const [targetId, setTargetId] = useState(targets[0]?.id || null);
  const [error, setError] = useState("");
  async function confirm() {
    if (busy || !targetId) return;
    setError("");
    try { await onMove(targetId); }
    catch (failure) { setError(failure.message); }
  }
  return <DialogFrame label="移动到空间" title={`移动 ${count} 项到…`} description="搬家后从当前空间消失，不会复制。" busy={busy} onClose={onClose} closeLabel="关闭"
    footer={<>
      <button type="button" disabled={busy} onClick={onClose}>取消</button>
      <button type="button" className="primary" disabled={busy || !targetId} onClick={confirm}>{busy ? "正在移动…" : "移动"}</button>
    </>}>
    {!targets.length ? <p className="wiki-muted">还没有其他空间。请先新建一个空间。</p> : <ul className="space-move-list">
      {targets.map((space) => <li key={space.id}>
        <button type="button" className={`space-move-item ${targetId === space.id ? "is-selected" : ""}`} disabled={busy} onClick={() => setTargetId(space.id)}>
          <span className="space-swatch" style={{ background: space.color }} aria-hidden="true" />
          <span>{space.name}</span>
          {targetId === space.id && <Check size={16} aria-hidden="true" />}
        </button>
      </li>)}
    </ul>}
    {error && <p className="wiki-error" role="alert">{error}</p>}
  </DialogFrame>;
}

export default function SpaceSwitcher({ spaces, current, readOnly = false, busy = false, switching = false, onSelect, onCreateRequest }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const key = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  const name = current?.name || "空间";
  if (readOnly) {
    return <div className="workspace-brand space-switcher is-readonly" title={name}>
      <img className="workspace-brand-mark" src="./brand/jiva-small.svg" width="28" height="28" alt="" />
      <strong className="space-switcher-name">{name}</strong>
    </div>;
  }
  return <div className={`space-switcher ${open ? "is-open" : ""} ${switching ? "is-switching" : ""}`} ref={root}>
    <button type="button" className="workspace-brand space-switcher-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
      disabled={busy} title={name} onClick={() => setOpen((value) => !value)}>
      <img className="workspace-brand-mark" src="./brand/jiva-small.svg" width="28" height="28" alt="" />
      <strong className="space-switcher-name">{name}</strong>
      <ChevronDown size={15} className="space-switcher-chevron" aria-hidden="true" />
    </button>
    {open && <div id={menuId} className="space-switcher-menu" role="menu" aria-label="切换空间">
      <ul className="space-switcher-list">
        {spaces.map((space) => <li key={space.id}>
          <button type="button" role="menuitemradio" aria-checked={space.id === current?.id} className="space-switcher-item" disabled={busy}
            onClick={() => { onSelect?.(space); setOpen(false); }}>
            <span className="space-swatch" style={{ background: space.color }} aria-hidden="true" />
            <span className="space-switcher-item-name">{space.name}</span>
            {space.id === current?.id && <Check size={16} aria-hidden="true" />}
          </button>
        </li>)}
      </ul>
      <div className="space-switcher-separator" role="separator" />
      <button type="button" role="menuitem" className="space-switcher-create" disabled={busy}
        onClick={() => { setOpen(false); onCreateRequest?.(); }}>
        <Plus size={15} aria-hidden="true" />新建空间
      </button>
    </div>}
  </div>;
}
