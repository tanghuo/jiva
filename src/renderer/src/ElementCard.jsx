import { useLayoutEffect, useRef, useState } from "react";
import { BookOpen, Copy, ImageIcon, RotateCcw } from "lucide-react";
import { preloadImage } from "./imagePreload.js";
import VideoCardPreview from "./VideoCardPreview.jsx";
import { apiUrl } from "./api.js";
import { elementLabel, imagePreviewWidths } from "../../shared/domain/elements.js";

// Keep measured proportions across filter changes without retaining decoded images.
const previewRatios = new Map();

const NOTE_TINTS = {
  "设计": "peach", "灵感": "peach", "海报": "peach",
  "旅行": "sky", "海边": "sky", "计划": "sky",
  "生活": "mint", "咖啡": "mint", "菜谱": "mint",
  "阅读": "lavender", "摘录": "lavender",
  "猫": "butter", "宠物": "butter",
  "提示词": "neutral", "prompt": "neutral", "Prompt": "neutral",
  "资料": "butter",
};

const PROMPT_TAG_KEYS = ["提示词", "prompt"];
const MATERIAL_TAG_KEYS = ["资料"];

function tagMatches(tags = [], keys) {
  return tags.some((tag) => keys.some((key) => tag === key || tag.toLowerCase?.() === key.toLowerCase() || tag.includes(key)));
}

function noteFace(element) {
  const tags = element.tags || [];
  if (tagMatches(tags, PROMPT_TAG_KEYS)) return "prompt";
  if (element.material || tagMatches(tags, MATERIAL_TAG_KEYS)) return "material";
  return "note";
}

function noteTint(tags = [], face) {
  if (face === "prompt") return "neutral";
  // Materials stay on butter/paper so they stay distinct from excerpt lavender notes.
  if (face === "material") return "butter";
  for (const tag of tags) {
    if (NOTE_TINTS[tag]) return NOTE_TINTS[tag];
    for (const [key, tint] of Object.entries(NOTE_TINTS)) if (tag.includes(key)) return tint;
  }
  return "neutral";
}

function noteHeading(element, fallback) {
  const explicit = String(element.title || "").trim();
  if (explicit) return explicit.length > 40 ? `${explicit.slice(0, 40)}…` : explicit;
  const body = (element.body || "").trim();
  if (!body) return fallback;
  const line = (body.split(/\n/).find((part) => part.trim()) || fallback).trim();
  const cut = line.search(/[，。！？,.!?；;]/);
  const sentence = (cut >= 0 ? line.slice(0, cut) : line).trim() || line;
  return sentence.length > 40 ? `${sentence.slice(0, 40)}…` : sentence;
}

function noteBodyPreview(element, heading) {
  const body = (element.body || "").trim();
  if (!body) return "";
  const clipped = heading.endsWith("…") ? heading.slice(0, -1) : heading;
  let rest = body;
  if (rest === heading || rest === clipped) return "";
  if (clipped && rest.startsWith(clipped)) {
    rest = rest.slice(clipped.length).replace(/^[，。！？,.!?\s；;：:]+/, "").trim();
  } else if (heading && rest.startsWith(heading)) {
    rest = rest.slice(heading.length).replace(/^[，。！？,.!?\s；;：:]+/, "").trim();
  }
  const lines = rest.split(/\n/);
  if (lines[0] && (lines[0].trim() === clipped || lines[0].trim() === heading)) {
    rest = lines.slice(1).join("\n").trim();
  }
  return rest;
}

export default function ElementCard({ element, onOpen, onRestore, onSelect, selected = false, disabled, loading = "lazy" }) {
  const title = elementLabel(element);
  const image = element.kind === "image";
  const canPreview = image && (!element.deletedAt || Boolean(element.image.thumbnailUrl));
  const thumbnailUrl = element.image?.thumbnailUrl || `/api/elements/${element.id}/thumbnail`;
  const sizedThumbnail = (width) => apiUrl(`${thumbnailUrl}${thumbnailUrl.includes("?") ? "&" : "?"}width=${width}${attempt ? `&retry=${attempt}` : ""}`);
  const [preview, setPreview] = useState("loading");
  const [imageRatio, setImageRatio] = useState(() => element.image?.width && element.image?.height ? element.image.width / element.image.height : previewRatios.get(element.id));
  const [attempt, setAttempt] = useState(0);
  const card = useRef(null), imageNode = useRef(null), finishPreload = useRef(null);
  const [requested, setRequested] = useState(loading === "eager");
  useLayoutEffect(() => {
    if (!canPreview) return;
    if (loading === "eager") { setRequested(true); return; }
    if (imageNode.current?.complete && imageNode.current.naturalWidth) return;
    setRequested(false);
    const finish = preloadImage(card.current, () => setRequested(true));
    finishPreload.current = finish;
    return () => { finish(); if (finishPreload.current === finish) finishPreload.current = null; };
  }, [canPreview, loading, attempt]);
  const [previewSize, setPreviewSize] = useState(null);
  useLayoutEffect(() => {
    if (!canPreview) return;
    function measure() {
      const width = card.current.getBoundingClientRect().width;
      if (width > 0) setPreviewSize(`${Math.ceil(width)}px`);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(card.current);
    measure();
    return () => observer.disconnect();
  }, [canPreview]);
  async function loaded(event) {
    const img = event.currentTarget, finish = finishPreload.current;
    // Decode while the card is still ahead of the viewport, not during the next scroll paint.
    try { await img.decode(); } catch { /* onError handles broken responses; a changed src can also interrupt decode. */ }
    finish?.();
    if (imageNode.current !== img || !img.complete || !img.naturalWidth) return;
    const ratio = (element.image?.width && element.image?.height ? element.image.width / element.image.height : imageRatio) || previewRatios.get(element.id) || img.naturalWidth / img.naturalHeight;
    previewRatios.delete(element.id);
    previewRatios.set(element.id, ratio);
    if (previewRatios.size > 256) previewRatios.delete(previewRatios.keys().next().value);
    setImageRatio(ratio);
    setPreview("ready");
  }
  const pending = canPreview && preview === "loading";
  const face = element.kind === "text" ? noteFace(element) : undefined;
  const tint = element.kind === "text" ? noteTint(element.tags, face) : undefined;
  const faceClass = face === "prompt" ? " is-prompt" : face === "material" ? " is-material-note" : face === "note" ? " is-note" : "";
  return <article data-element-id={element.id} data-note-tint={tint} data-note-face={face} ref={card} className={`wiki-card is-${element.kind}${faceClass} ${element.material ? "has-material" : ""} ${element.deletedAt ? "is-trashed" : ""} ${selected ? "is-selected" : ""} ${pending ? "is-loading" : ""}`} aria-busy={pending || undefined}>
    {onSelect && <input className="wiki-card-select" type="checkbox" aria-label={`选择内容：${title}`} checked={selected} disabled={disabled} onChange={() => onSelect(element.id)} />}
    <button className={`wiki-card-open${element.tags?.length ? " has-tags" : ""}`} disabled={disabled || (Boolean(element.deletedAt) && !onSelect)} onClick={() => onSelect ? onSelect(element.id) : onOpen(element.id)} aria-label={`${onSelect ? "选择内容" : "打开内容"}：${title}`} aria-pressed={onSelect ? selected : undefined}>
      {image ? <div className={`wiki-card-image${imageRatio ? " has-ratio" : ""}`} style={imageRatio ? { "--wiki-image-ratio": imageRatio } : undefined}>{!canPreview ? <ImageIcon size={34} /> : preview === "error" ? <span className="wiki-card-image-error"><ImageIcon size={24} />预览无法加载</span> : <>{previewSize && requested && <img ref={imageNode} key={attempt} src={sizedThumbnail(400)} srcSet={imagePreviewWidths.map((width) => `${sizedThumbnail(width)} ${width}w`).join(", ")} sizes={previewSize} alt={title} loading="eager" decoding="async" onLoad={loaded} onError={() => { finishPreload.current?.(); setPreview("error"); }} />}{pending && <span className="wiki-card-image-loading" aria-hidden="true"><ImageIcon size={24} />正在加载预览…</span>}</>}</div>
        : element.kind === "video" ? <VideoCardPreview key={element.id} element={element} disabled={disabled || Boolean(onSelect)} />
          : <div className="wiki-card-text">{face === "prompt" ? <p className="wiki-card-note-kind">提示词</p> : face === "material" ? <p className="wiki-card-note-kind"><BookOpen size={13} aria-hidden="true" /> 资料</p> : <span className="wiki-card-note-quote" aria-hidden="true">“</span>}{(() => { const heading = noteHeading(element, title); const preview = noteBodyPreview(element, heading); return <><strong className="wiki-card-note-title">{heading}</strong>{preview ? <p className="wiki-card-note-body">{preview}</p> : null}</>; })()}</div>}
      {element.tags?.length > 0 && <div className="wiki-card-tags" title={element.tags.join(" · ")}>{element.tags.slice(0, 2).map((tag) => <span className="wiki-tag" key={tag}>{tag}{element.aiTags?.some((a) => a.name === tag) && <span className="ai-source" title="AI 添加，打开内容查看整理记录">AI</span>}</span>)}{element.tags.length > 2 && <span className="wiki-card-tag-count">+{element.tags.length - 2}</span>}</div>}
    </button>
    {element.copyCount > 0 && <div className={`wiki-card-copy-count${face === "prompt" ? " is-prompt-count" : ""}`} title="累计复制成功次数；历史未记录的操作不计入，相似堆叠仅显示当前封面内容的次数。"><Copy size={12} aria-hidden="true" />复制 {element.copyCount} 次</div>}
    {element.material && element.kind !== "text" && <span className="wiki-material-badge">资料</span>}
    {preview === "error" && <button className="wiki-preview-retry" disabled={disabled} onClick={() => { setAttempt((value) => value + 1); setPreview("loading"); }}>重试预览</button>}
    {element.deletedAt && <div className="wiki-trash-meta">{image && <strong title={element.image.originalName}>{element.image.originalName}</strong>}<time dateTime={element.deletedAt}>删除于 {new Date(element.deletedAt).toLocaleString("zh-CN")}</time></div>}
    {element.deletedAt && <button className="wiki-restore" disabled={disabled} onClick={() => onRestore(element.id)}><RotateCcw size={14} />恢复内容</button>}
  </article>;
}
