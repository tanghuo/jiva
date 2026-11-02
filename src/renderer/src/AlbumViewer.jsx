import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, ChevronLeft, ChevronRight, Download, Grid2X2, ImageOff, Info, Minus, Plus, RotateCcw, X } from "lucide-react";
import Lightbox from "yet-another-react-lightbox";
import Inline from "yet-another-react-lightbox/plugins/inline";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { apiUrl } from "./api.js";
import { isEditableTarget } from "./shortcuts.js";

const maxZoomPixelRatio = 8;
const viewerContentSelector = "img, button, a, header, aside, [role='alert'], [role='status'], .wiki-album-zoom-tools, .wiki-album-filmstrip-dock";

function Thumbnail({ item }) {
  const [failed, setFailed] = useState(false);
  return failed ? <ImageOff size={18} aria-label="缩略图无法加载" />
    : <img src={apiUrl(`/api/elements/${item.id}/thumbnail?width=400`)} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export default function AlbumViewer({ items, index, onIndexChange, album, onClose }) {
  const dialogRef = useRef(null);
  const stripRef = useRef(null);
  const zoomRef = useRef(null);
  const panRef = useRef(null);
  const backgroundPressRef = useRef(null);
  const stageRef = useRef(null);
  const wheelAnchorRef = useRef(null);
  const wheelNavigationRef = useRef(null);
  wheelNavigationRef.current = { index, count: items.length, onIndexChange };
  const detailsButtonRef = useRef(null);
  const stripButtonRef = useRef(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [stripOpen, setStripOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const current = items[index];
  const meta = album.album || {};
  const title = meta.title || "图集";
  const image = current.image || {};
  const slides = useMemo(() => items.map((item) => ({
    src: apiUrl(`/api/elements/${item.id}/image${attempt ? `?retry=${attempt}` : ""}`),
    alt: item.image?.originalName || "图集图片",
    ...(item.image?.width && item.image?.height ? { width: item.image.width, height: item.image.height } : {}),
  })), [items, attempt]);

  useEffect(() => {
    panRef.current = null;
    wheelAnchorRef.current = null;
    setPanOffset({ x: 0, y: 0 });
  }, [index, attempt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const stage = stageRef.current;
    function onWheel(event) {
      const navigation = event.target.closest(".yarl__navigation_prev, .yarl__navigation_next");
      if (navigation || !event.target.closest(viewerContentSelector)) {
        if (!event.deltaY || event.ctrlKey) return;
        event.preventDefault();
        event.stopPropagation();
        const current = wheelNavigationRef.current;
        const next = current.index + Math.sign(event.deltaY);
        if (next < 0 || next >= current.count) return;
        current.index = next;
        current.onIndexChange(next);
        return;
      }
      if (!event.target.closest(".yarl__slide_current img")) return;
      const control = zoomRef.current;
      const img = stage.querySelector(".yarl__slide_current img");
      if (!control || control.disabled || !img?.naturalWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const delta = event.deltaY * unit;
      const next = Math.max(1, Math.min(control.maxZoom, control.zoom * Math.min(1 + Math.abs(delta) / 500, 2) ** -Math.sign(delta)));
      if (Math.abs(next - control.zoom) < .00001) return;
      const rect = img.getBoundingClientRect();
      wheelAnchorRef.current = {
        src: img.src, x: event.clientX, y: event.clientY,
        u: (event.clientX - rect.left) / rect.width,
        v: (event.clientY - rect.top) / rect.height,
      };
      panRef.current = null;
      control.changeZoom(next, true);
    }
    dialog.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => dialog.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  useLayoutEffect(() => {
    const anchor = wheelAnchorRef.current;
    wheelAnchorRef.current = null;
    if (!anchor || zoom <= 1) return;
    const img = stageRef.current?.querySelector(".yarl__slide_current img");
    if (!img || img.src !== anchor.src) return;
    const rect = img.getBoundingClientRect();
    // Compensate for both the lightbox's pan bounds and our freely dragged position.
    setPanOffset((value) => ({
      x: value.x + anchor.x - (rect.left + anchor.u * rect.width),
      y: value.y + anchor.y - (rect.top + anchor.v * rect.height),
    }));
  }, [zoom]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    stripRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index, stripOpen]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    function onWheel(event) {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      strip.scrollLeft += event.deltaY * unit;
    }
    // A non-passive listener lets a vertical mouse wheel scroll this horizontal list.
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [stripOpen]);

  function move(delta) { onIndexChange(Math.max(0, Math.min(items.length - 1, index + delta))); }
  function toggleDetails() {
    if (detailsOpen) detailsButtonRef.current?.focus();
    setDetailsOpen((value) => !value);
  }
  function toggleStrip() {
    if (stripOpen) stripButtonRef.current?.focus();
    setStripOpen((value) => !value);
  }
  function toggleZoom() {
    const control = zoomRef.current;
    if (control && !control.disabled) control.changeZoom(control.zoom > 1 ? 1 : Math.max(1, control.maxZoom / maxZoomPixelRatio));
  }
  function onKeyDown(event) {
    // The modal owns shortcuts; the lightbox handles zoomed image panning itself.
    event.stopPropagation();
    if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const outsideStage = !event.target.closest(".yarl__container");
    const externalArrow = outsideStage && (key === "arrowleft" || key === "arrowright");
    if (["j", "k", "home", "end", "z", "i", "t"].includes(key) || externalArrow) event.preventDefault();
    if (key === "j" || externalArrow && key === "arrowleft") move(-1);
    if (key === "k" || externalArrow && key === "arrowright") move(1);
    if (key === "home") onIndexChange(0);
    if (key === "end") onIndexChange(items.length - 1);
    if (key === "z") toggleZoom();
    if (key === "i") toggleDetails();
    if (key === "t") toggleStrip();
    if (outsideStage && ["+", "="].includes(key)) { event.preventDefault(); zoomRef.current?.zoomIn(); }
    if (outsideStage && key === "-") { event.preventDefault(); zoomRef.current?.zoomOut(); }
  }

  return createPortal(<dialog ref={dialogRef} tabIndex={-1} className={`wiki-album-viewer${detailsOpen ? " has-details" : ""}${stripOpen ? " has-filmstrip" : ""}`} aria-label="图集浏览" onKeyDown={onKeyDown}
    onPointerDownCapture={(event) => {
      backgroundPressRef.current = event.button === 0 && event.isPrimary && !event.target.closest(viewerContentSelector)
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false } : null;
    }}
    onPointerMoveCapture={(event) => {
      const press = backgroundPressRef.current;
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.moved = true;
    }}
    onPointerCancelCapture={() => { backgroundPressRef.current = null; }}
    onClickCapture={(event) => {
      const press = backgroundPressRef.current;
      backgroundPressRef.current = null;
      if (!event.detail || !press || press.moved || event.target.closest(viewerContentSelector)) return;
      event.stopPropagation();
      onClose();
    }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="wiki-album-viewer-main">
      <header className="wiki-album-viewer-bar">
        <div className="wiki-album-viewer-heading"><span>图集</span><strong title={title}>{title}</strong><span className="wiki-album-page-count" aria-live="polite">{index + 1} / {items.length}</span></div>
        <div className="wiki-album-viewer-tools">
          <button ref={stripButtonRef} type="button" onClick={toggleStrip} aria-label="缩略图" aria-expanded={stripOpen} aria-controls="album-filmstrip" title="缩略图（T）"><Grid2X2 size={18} /></button>
          <button ref={detailsButtonRef} type="button" onClick={toggleDetails} aria-label="图片详情" aria-expanded={detailsOpen} aria-controls="album-image-details" title="图片详情（I）"><Info size={18} /></button>
          <span className="wiki-album-tool-divider" />
          <button type="button" onClick={onClose} aria-label="关闭浏览" title="返回网格（Esc）" autoFocus><X size={20} /></button>
        </div>
      </header>
      <div ref={stageRef} className={`wiki-album-viewer-stage${zoom > 1 ? " is-pannable" : ""}`}
        onPointerDownCapture={(event) => {
          if (event.pointerType === "touch" || event.button !== 0 || zoomRef.current?.zoom <= 1 || !event.target.closest(".yarl__slide_current img")) return;
          event.stopPropagation();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          panRef.current = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...panOffset };
        }}
        onPointerMoveCapture={(event) => {
          const start = panRef.current;
          if (!start || start.id !== event.pointerId) return;
          event.stopPropagation();
          setPanOffset({ x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY });
        }}
        onPointerUpCapture={(event) => {
          if (panRef.current?.id !== event.pointerId) return;
          event.stopPropagation();
          panRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => { panRef.current = null; }} onLostPointerCapture={() => { panRef.current = null; }}
        onKeyDownCapture={(event) => {
          if (zoomRef.current?.zoom <= 1 || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
          const delta = { ArrowLeft: [-50, 0], ArrowRight: [50, 0], ArrowUp: [0, -50], ArrowDown: [0, 50] }[event.key];
          if (!delta) return;
          event.preventDefault();
          event.stopPropagation();
          setPanOffset((value) => ({ x: value.x + delta[0], y: value.y + delta[1] }));
        }} onDoubleClickCapture={(event) => {
          const control = zoomRef.current;
          if (!control || control.zoom <= 1 || event.target.closest("button, a")) return;
          event.preventDefault();
          event.stopPropagation();
          if (control.zoom >= control.maxZoom) control.changeZoom(1);
          else control.zoomIn();
        }} tabIndex={-1}>
        <Lightbox key={attempt} plugins={[Inline, Zoom]} slides={slides} index={index}
          on={{ view: ({ index: next }) => onIndexChange(next), zoom: ({ zoom: next }) => {
            setZoom(next);
            if (next <= 1) { panRef.current = null; setPanOffset({ x: 0, y: 0 }); }
          } }}
          carousel={{ finite: true, preload: 1, padding: 0, spacing: "12%" }}
          animation={{ swipe: 260, navigation: 0, zoom: 220 }}
          zoom={{ ref: zoomRef, scrollToZoom: true, maxZoomPixelRatio, wheelZoomDistanceFactor: 500 }}
          toolbar={{ buttons: [] }} controller={{ aria: false, closeOnEscape: false }}
          labels={{ Previous: "上一张", Next: "下一张", Slide: "图片", Carousel: "图片浏览", "Photo gallery": "图集", of: "/" }}
          render={{
            slideContainer: ({ slide, children }) => <div className="wiki-album-pan-layer" style={{ transform: slide.src === slides[index]?.src ? `translate(${panOffset.x}px, ${panOffset.y}px)` : undefined }}>{children}</div>,
            buttonZoom: () => null,
            iconPrev: () => <ChevronLeft size={36} />,
            iconNext: () => <ChevronRight size={36} />,
            iconLoading: () => <span className="wiki-album-load-message" role="status">正在加载图片…</span>,
            iconError: () => <div className="wiki-album-load-message" role="alert"><ImageOff size={28} /><span>图片加载失败</span><button type="button" onClick={() => { dialogRef.current?.focus(); setAttempt((value) => value + 1); }}>重试</button></div>,
          }} />
      </div>
      <div className="wiki-album-zoom-tools" role="group" aria-label="图片缩放">
        <button type="button" aria-label="缩小" title="缩小" disabled={zoom <= 1} onClick={() => zoomRef.current?.zoomOut()}><Minus size={17} /></button>
        <button type="button" className="wiki-album-zoom-value" aria-label="切换原尺寸与适应窗口" title="原尺寸 / 适应窗口（Z）；双击图片逐级放大" onClick={toggleZoom}>{zoom > 1.01 ? `${Math.round(zoom * 100)}%` : "适应"}</button>
        <button type="button" aria-label="放大" title="放大" onClick={() => zoomRef.current?.zoomIn()}><Plus size={17} /></button>
        <span className="wiki-album-tool-divider" />
        <button type="button" aria-label="重置缩放" title="适应窗口" disabled={zoom <= 1} onClick={() => zoomRef.current?.changeZoom(1)}><RotateCcw size={15} /></button>
      </div>
      {stripOpen && <div className="wiki-album-filmstrip-dock" id="album-filmstrip">
        <div ref={stripRef} className="wiki-album-filmstrip" aria-label="图片缩略图" onDragStart={(event) => event.preventDefault()}>
          {items.map((item, itemIndex) => <button type="button" key={item.id} aria-label={`查看第 ${itemIndex + 1} 张`} aria-current={itemIndex === index ? "true" : undefined}
            onClick={() => onIndexChange(itemIndex)}><Thumbnail item={item} /><span>{itemIndex + 1}</span></button>)}
        </div>
      </div>}
    </div>
    {detailsOpen && <aside className="wiki-album-image-details" id="album-image-details" aria-label="图片信息">
      <header><h2>图片详情</h2><button type="button" aria-label="收起图片详情" onClick={toggleDetails}><X size={18} /></button></header>
      <div className="wiki-album-details-name">{image.originalName || `图片 ${index + 1}`}</div>
      <dl><div><dt>尺寸</dt><dd>{image.width && image.height ? `${image.width} × ${image.height}` : "—"}</dd></div>
        <div><dt>大小</dt><dd>{fileSize(image.byteSize)}</dd></div>
        <div><dt>格式</dt><dd>{image.mimeType?.replace("image/", "").toUpperCase() || "—"}</dd></div>
        <div><dt>位置</dt><dd>{index + 1} / {items.length}</dd></div></dl>
      <h3>所属图集</h3><p>{title}</p>
      {album.tags?.length > 0 && <><h3>图集标签</h3><div className="wiki-album-detail-tags">{album.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></>}
      {meta.sourceUrl && <><h3>来源</h3><a href={meta.sourceUrl} target="_blank" rel="noreferrer" className="wiki-album-detail-source">{meta.sourceUrl}<ArrowUpRight size={15} /></a></>}
      <a className="wiki-album-download" href={apiUrl(`/api/elements/${current.id}/download`)} download><Download size={16} />下载原图</a>
      <div className="wiki-album-detail-shortcuts"><span>← → 切换图片</span><span>图片上滚轮缩放 · 放大后拖拽</span><span>空白处滚轮切图 · 点击返回</span><span>T 缩略图 · I 详情 · Esc 返回</span></div>
    </aside>}
  </dialog>, document.body);
}
