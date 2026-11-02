import { lazy, Suspense, useEffect, useState } from "react";
import { ImageIcon, FileText, Video, X, Check } from "lucide-react";
import { maxElementBody } from "../../shared/domain/elements.js";
import TagInput from "./TagInput.jsx";
import { savedContentStatus } from "./contentDrafts.js";
const MarkdownPreview = lazy(() => import("./features/agentWorkbench/WorkbenchMarkdown.jsx"));

export default function ContentDraft({ entry, index, single = false, busy, saving, onChange, onRemove }) {
  const [preview, setPreview] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const image = entry.kind === "image", video = entry.kind === "video";
  const label = video ? "视频" : image ? "图片" : "文字";
  const disabled = busy || Boolean(entry.saved) || entry.loading;
  useEffect(() => {
    if (entry.kind !== "text" || !entry.file) return;
    let cancelled = false;
    async function read() {
      try {
        if (entry.file.size > maxElementBody * 4) throw new Error(`文字最多 ${maxElementBody} 字`);
        const bytes = new Uint8Array(await entry.file.arrayBuffer());
        const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (body.includes("\0")) throw new Error("请选择 UTF-8 文本文件");
        if (body.length > maxElementBody) throw new Error(`文字最多 ${maxElementBody} 字`);
        if (!cancelled) onChange({ body, file: undefined, loading: false, importError: false, error: "" });
      } catch (failure) {
        if (!cancelled) onChange({ file: undefined, loading: false, preview: false, importError: true, error: `无法导入 ${entry.file.name}：${failure.message}` });
      }
    }
    void read();
    return () => { cancelled = true; };
  }, [entry.file, entry.kind]);
  useEffect(() => {
    if (!entry.file || entry.kind === "text") return;
    const url = URL.createObjectURL(entry.file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [entry.file]);
  return <article className={`wiki-content-draft${single ? " is-single" : ""}`} aria-label={`${label}内容 ${index + 1}`}>
    <header><span>{video ? <Video size={16} /> : image ? <ImageIcon size={16} /> : <FileText size={16} />}{label}{single ? "" : ` ${index + 1}`}{entry.sourceName && !image && !video ? ` · ${entry.sourceName}` : ""}</span>
      {entry.saved ? <span className="wiki-draft-saved"><Check size={15} />{savedContentStatus(entry.saved)}</span>
        : <button type="button" className="icon-only" disabled={busy} aria-label={`移除待保存内容 ${index + 1}`} onClick={onRemove}><X size={15} /></button>}
    </header>
    {image || video ? <div className="wiki-draft-image"><div>{video ? preview ? <video src={preview} controls preload="metadata" aria-label={entry.file.name} /> : <Video size={26} /> : preview && !previewFailed ? <img src={preview} alt={entry.file.name} onError={() => setPreviewFailed(true)} /> : <ImageIcon size={26} />}</div>
      <p><span>{entry.file.name}</span><small>{video ? `${(entry.file.size / 1024 / 1024).toFixed(1)} MiB` : `${(entry.file.size / 1024).toFixed(1)} KB`}</small></p></div>
      : <><div className="wiki-draft-text-tools" role="group" aria-label="文字显示方式"><button type="button" aria-pressed={!entry.preview} onClick={() => onChange({ preview: false })}>编辑</button><button type="button" aria-pressed={Boolean(entry.preview)} onClick={() => onChange({ preview: true })}>预览</button></div>
        {entry.loading ? <p role="status">正在读取文件…</p> : entry.preview ? <div className="wiki-draft-markdown" role="region" aria-label="Markdown 预览"><Suspense fallback={<p role="status">正在加载预览…</p>}><MarkdownPreview>{entry.body || "暂无内容"}</MarkdownPreview></Suspense></div> : <textarea id={`draft-${entry.key}`} aria-label="文字" rows={single ? 12 : 3} maxLength={maxElementBody} value={entry.body} disabled={disabled} autoFocus
        placeholder="输入文字或 Markdown，也可粘贴图片、视频、MD 文件…" onChange={(event) => onChange({ body: event.target.value, error: "", importError: false })} />}</>}
    {(!single || entry.tags.tags.length > 0 || entry.tags.draft) && <details className="wiki-draft-tags" onToggle={(event) => setShowTags(event.currentTarget.open)}>
      <summary>单独加标签{entry.tags.tags.length ? ` · ${entry.tags.tags.join("、")}` : ""}</summary>
      {showTags && <TagInput label="此项标签" value={entry.tags} disabled={disabled} onChange={(tags) => onChange({ tags, error: "" })} />}
    </details>}
    {saving && <p className="wiki-muted" role="status">正在保存这项内容…</p>}
    {entry.error && <p className="wiki-error" role="alert">{entry.error}</p>}
  </article>;
}
