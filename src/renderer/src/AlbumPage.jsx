import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Grid2X2, Images, MoreHorizontal, PanelTop, Play, Plus } from "lucide-react";
import AlbumMinimap from "./AlbumMinimap.jsx";
import useWikiResource from "./useWikiResource.js";
import { apiUrl, request } from "./api.js";
import { Button } from "./ui/Button.jsx";
import TagInput, { readTagInput } from "./TagInput.jsx";
import { elementTags } from "../../shared/domain/elements.js";
import { persistAlbumLayout, readStoredAlbumLayout } from "./albumLayout.js";
import {
  STRIP_OVERSCAN,
  STRIP_GAP_PX,
  buildStripOffsets,
  computeStripWindow,
  defaultStripItemHeight,
  findStripIndexAtOffset,
  stripIndexFromScroll,
  stripTotalHeight,
} from "./albumStripVirtual.js";

const AlbumViewer = lazy(() => import("./AlbumViewer.jsx"));

export default function AlbumPage({ id, revision = 0, readOnly = false, onBack, onChanged, onBusyChange }) {
  const resource = useWikiResource(`/api/albums/${id}`, revision);
  const album = resource.data?.album;
  const items = resource.data?.items || [];
  const [layout, setLayout] = useState(readStoredAlbumLayout); // grid | strip
  const [viewerOpen, setViewerOpen] = useState(false);
  const [tileSize, setTileSize] = useState(200);
  const [stripWidth, setStripWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("wikiAlbumStripWidth"));
      return Number.isFinite(saved) && saved >= 480 && saved <= 1920 ? saved : 1000;
    } catch { return 1000; }
  });
  const [index, setIndex] = useState(0);
  const [managing, setManaging] = useState(false);
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [tags, setTags] = useState({ tags: [], draft: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [importSources, setImportSources] = useState([]);
  const [stripIndex, setStripIndex] = useState(0);
  const [stripScroll, setStripScroll] = useState({ top: 0, height: 600, width: 640 });
  const [heightTick, setHeightTick] = useState(0);
  const stripStageRef = useRef(null);
  const aspectRatiosRef = useRef(new Map());
  const measuredMembershipRef = useRef(null);
  const previousOffsetsRef = useRef(null);
  const seekingRef = useRef(false);
  const wheelMotionRef = useRef(null);

  useEffect(() => {
    if (['read-only', 'lan-edit'].includes(document.querySelector('meta[name="wiki-access"]')?.content)) return;
    let canceled = false;
    request(`/api/magnet-imports/sources/${id}`).then(r => { if (!canceled) setImportSources(r.sources || []); }).catch(() => {});
    return () => { canceled = true; };
  }, [id, revision]);

  useEffect(() => {
    try { localStorage.setItem("wikiAlbumStripWidth", String(stripWidth)); }
    catch { /* Keep width adjustment available when storage is blocked. */ }
  }, [stripWidth]);

  useEffect(() => {
    if (!album) return;
    setTitle(album.album?.title || "");
    setSourceUrl(album.album?.sourceUrl || "");
    setTags({ tags: album.tags || [], draft: "" });
  }, [album?.id, album?.updatedAt, revision]);

  useEffect(() => { onBusyChange?.(busy || resource.loading); return () => onBusyChange?.(false); }, [busy, resource.loading, onBusyChange]);

  useEffect(() => { persistAlbumLayout(layout); }, [layout]);

  const membershipKey = JSON.stringify([id, items.map((item) => item.id)]);
  useEffect(() => {
    // Activity reconnects effects when returning to the library, while keeping
    // loaded images mounted. Preserve their dimensions: onLoad won't fire again.
    if (measuredMembershipRef.current === membershipKey) return;
    measuredMembershipRef.current = membershipKey;
    aspectRatiosRef.current = new Map();
    setHeightTick((value) => value + 1);
    setStripIndex(0);
  }, [membershipKey]);

  const stripOffsets = useMemo(() => {
    if (layout !== "strip" || !items.length) return new Float64Array([0]);
    const colW = Math.max(120, stripScroll.width || 640);
    const fallback = defaultStripItemHeight(colW);
    return buildStripOffsets(items.length, (i) => {
      const idKey = items[i]?.id;
      const image = items[i]?.image;
      const ratio = (idKey != null ? aspectRatiosRef.current.get(idKey) : undefined)
        || (image?.width > 0 && image?.height > 0 ? image.height / image.width : undefined);
      return (ratio ? colW * ratio : fallback) + (managing && !readOnly ? 44 : 0);
    });
    // heightTick forces rebuild after measure; stripScroll.width when column changes
  }, [layout, items, stripScroll.width, heightTick, managing, readOnly]);

  const stripWindow = useMemo(() => {
    if (layout !== "strip" || !items.length) return { start: 0, end: -1, padTop: 0, padBottom: 0 };
    return computeStripWindow({
      scrollTop: stripScroll.top,
      viewportHeight: stripScroll.height,
      itemCount: items.length,
      offsets: stripOffsets,
      overscan: STRIP_OVERSCAN,
    });
  }, [layout, items.length, stripScroll.top, stripScroll.height, stripOffsets]);

  const syncStripMetrics = useCallback(() => {
    const stage = stripStageRef.current;
    if (!stage) return;
    const grid = stage.querySelector(".wiki-album-grid.is-strip");
    const next = {
      top: stage.scrollTop,
      height: stage.clientHeight || 600,
      width: (grid?.clientWidth || stage.clientWidth) || 640,
    };
    setStripScroll((prev) => (
      prev.top === next.top && prev.height === next.height && prev.width === next.width ? prev : next
    ));
    if (!seekingRef.current) {
      const atBottom = next.top > 0 && next.top + stage.clientHeight >= stage.scrollHeight - 1;
      setStripIndex(atBottom ? Math.max(0, stripOffsets.length - 2) : stripIndexFromScroll(stripOffsets, next.top, next.height));
    }
  }, [stripOffsets]);

  useLayoutEffect(() => {
    const stage = stripStageRef.current;
    const previous = previousOffsetsRef.current;
    previousOffsetsRef.current = stripOffsets;
    if (!stage || layout !== "strip" || !previous || previous.length !== stripOffsets.length) return;
    // Keep the same image in view when decoded dimensions or column width change.
    const anchor = findStripIndexAtOffset(previous, stage.scrollTop);
    const fraction = (stage.scrollTop - previous[anchor]) / Math.max(1, previous[anchor + 1] - previous[anchor]);
    const oldTop = stage.scrollTop;
    stage.scrollTop = stripOffsets[anchor] + fraction * (stripOffsets[anchor + 1] - stripOffsets[anchor]);
    if (wheelMotionRef.current?.frame != null) {
      wheelMotionRef.current.target += stage.scrollTop - oldTop;
    }
  }, [layout, stripOffsets]);

  useLayoutEffect(() => {
    if (layout !== "strip" || viewerOpen || !items.length) return undefined;
    const stage = stripStageRef.current;
    if (!stage) return undefined;
    const container = stage.parentElement;
    const resizeReadingArea = () => {
      const main = stage.closest(".wiki-main");
      const shell = stage.closest(".wiki-shell");
      const bottomPadding = (main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0)
        + (shell ? parseFloat(getComputedStyle(shell).paddingBottom) || 0 : 0);
      const availableHeight = window.innerHeight - container.getBoundingClientRect().top - bottomPadding;
      container.style.setProperty("--album-strip-height", `${Math.max(1, availableHeight)}px`);
      syncStripMetrics();
    };
    resizeReadingArea();
    syncStripMetrics();
    const onScroll = () => {
      if (seekingRef.current) return;
      syncStripMetrics();
    };
    stage.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => syncStripMetrics()) : null;
    ro?.observe(stage);
    const headerObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resizeReadingArea) : null;
    for (const child of container.parentElement.children) {
      if (child !== container) headerObserver?.observe(child);
    }
    window.addEventListener("resize", resizeReadingArea);
    return () => {
      stage.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resizeReadingArea);
      ro?.disconnect();
      headerObserver?.disconnect();
    };
  }, [layout, viewerOpen, items.length, syncStripMetrics]);

  // Keep wheel animation independent of image measurements and offset rebuilds.
  useLayoutEffect(() => {
    const stage = stripStageRef.current;
    if (layout !== "strip" || viewerOpen || !items.length || !stage) return;
    const motion = { frame: null, target: stage.scrollTop, time: 0, cancel: () => {
      cancelAnimationFrame(motion.frame);
      motion.frame = null;
    } };
    wheelMotionRef.current = motion;
    const animate = (time) => {
      motion.target = Math.max(0, Math.min(stage.scrollHeight - stage.clientHeight, motion.target));
      const distance = motion.target - stage.scrollTop;
      if (Math.abs(distance) < 1.5) {
        stage.scrollTop = motion.target;
        motion.frame = null;
        return;
      }
      const elapsed = Math.min(32, Math.max(1, time - motion.time));
      motion.time = time;
      const step = distance * (1 - Math.exp(-elapsed / 45));
      stage.scrollTop += Math.sign(distance) * Math.max(1, Math.abs(step));
      motion.frame = requestAnimationFrame(animate);
    };
    const onWheel = (event) => {
      const wheelStep = event.deltaMode === 1
        || (event.deltaMode === 0 && Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 50);
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.deltaX || !event.deltaY || !wheelStep) {
        motion.cancel();
        return;
      }
      event.preventDefault();
      if (motion.frame == null || Math.sign(event.deltaY) !== Math.sign(motion.target - stage.scrollTop)) {
        motion.target = stage.scrollTop;
      }
      motion.target = Math.max(0, Math.min(stage.scrollHeight - stage.clientHeight,
        motion.target + event.deltaY * (event.deltaMode === 1 ? 16 : 1) * 1.4));
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        motion.cancel();
        stage.scrollTop = motion.target;
      } else if (motion.frame == null) {
        motion.time = performance.now();
        motion.frame = requestAnimationFrame(animate);
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      motion.cancel();
      stage.removeEventListener("wheel", onWheel);
      if (wheelMotionRef.current === motion) wheelMotionRef.current = null;
    };
  }, [layout, viewerOpen, items.length]);

  function stripPositionAtOffset(offset) {
    if (!items.length) return 0;
    const item = findStripIndexAtOffset(stripOffsets, offset);
    const fraction = (offset - stripOffsets[item]) / Math.max(1, stripOffsets[item + 1] - stripOffsets[item]);
    return Math.max(0, Math.min(items.length, item + fraction));
  }

  const coverId = album?.album?.coverImageId || album?.album?.cover?.imageId;

  function changeLayout(next) {
    setLayout(next === "strip" ? "strip" : "grid");
  }

  function openViewerAt(itemIndex) {
    setIndex(itemIndex);
    setViewerOpen(true);
  }

  function seekStripToIndex(itemIndex) {
    const stage = stripStageRef.current;
    if (!stage || !items.length) return;
    wheelMotionRef.current?.cancel();
    const clamped = Math.max(0, Math.min(items.length - 0.0001, itemIndex));
    const item = Math.floor(clamped);
    seekingRef.current = true;
    setStripIndex(item);
    stage.scrollTop = stripOffsets[item] + (clamped - item) * (stripOffsets[item + 1] - stripOffsets[item]);
    setStripScroll((prev) => ({ ...prev, top: stage.scrollTop }));
    requestAnimationFrame(() => {
      seekingRef.current = false;
      syncStripMetrics();
    });
  }

  function onStripItemLoad(itemId, event) {
    const img = event.currentTarget;
    const ratio = img.naturalHeight / img.naturalWidth;
    if (!ratio || !Number.isFinite(ratio)) return;
    const prev = aspectRatiosRef.current.get(itemId);
    if (prev === ratio) return;
    aspectRatiosRef.current.set(itemId, ratio);
    setHeightTick((value) => value + 1);
  }

  async function saveMeta() {
    if (readOnly || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/api/albums/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, sourceUrl, tags: elementTags([...readTagInput(tags)]) }),
      });
      onChanged?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function setCover(imageId) {
    if (readOnly || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/api/albums/${id}`, { method: "PATCH", body: JSON.stringify({ coverImageId: imageId }) });
      onChanged?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setMenuOpen(false); }
  }

  async function removeItem(imageId) {
    if (readOnly || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/api/albums/${id}/items/${imageId}`, { method: "DELETE", body: "{}" });
      onChanged?.();
      setIndex((value) => Math.max(0, Math.min(value, items.length - 2)));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function sortBy(mode) {
    if (readOnly || busy) return;
    setBusy(true); setError("");
    try {
      await request(`/api/albums/${id}`, { method: "PATCH", body: JSON.stringify({ sortMode: mode }) });
      onChanged?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); setMenuOpen(false); }
  }

  async function appendFiles(fileList) {
    if (readOnly || busy) return;
    const files = [...fileList || []].filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file.name));
    if (!files.length) return;
    setBusy(true); setError("");
    try {
      for (const file of files) {
        await request("/api/images", {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-album-id": String(id),
            "x-image-tags": btoa(""),
          },
          body: file,
        });
      }
      onChanged?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  if (resource.error) {
    return <section className="wiki-album-page" data-c-surface="album">
      <p className="wiki-error" role="alert">{resource.error}</p>
      <Button onClick={onBack}>返回</Button>
    </section>;
  }
  if (!album) return <section className="wiki-album-page" data-c-surface="album"><p className="wiki-muted">正在读取图集…</p></section>;

  const meta = album.album || {};

  function renderTileActions(item) {
    if (!(managing && !readOnly)) return null;
    return <div className="wiki-album-tile-actions">
      <button type="button" disabled={busy} onClick={() => setCover(item.id)}>设为封面</button>
      <button type="button" disabled={busy} onClick={() => removeItem(item.id)}>移出图集</button>
    </div>;
  }

  function renderStripTiles() {
    if (stripWindow.end < stripWindow.start) return null;
    const nodes = [];
    for (let itemIndex = stripWindow.start; itemIndex <= stripWindow.end; itemIndex += 1) {
      const item = items[itemIndex];
      if (!item) continue;
      nodes.push(
        <article
          key={item.id}
          className="wiki-album-tile"
          data-strip-index={itemIndex}
          style={{ position: "absolute", top: stripOffsets[itemIndex], width: "100%" }}
        >
          <button type="button" className="wiki-album-tile-open" aria-label={`浏览第 ${itemIndex + 1} 张`}
            style={{ height: stripOffsets[itemIndex + 1] - stripOffsets[itemIndex]
              - (itemIndex < items.length - 1 ? STRIP_GAP_PX : 0)
              - (managing && !readOnly ? 44 : 0) }}
            onClick={() => openViewerAt(itemIndex)}>
            <img
              src={apiUrl(`/api/elements/${item.id}/thumbnail?width=1600`)}
              alt={item.image?.originalName || `第 ${itemIndex + 1} 张图片`}
              draggable={false}
              loading="eager"
              decoding="async"
              onLoad={(event) => onStripItemLoad(item.id, event)}
            />
            <span className="wiki-album-tile-number">{String(itemIndex + 1).padStart(2, "0")}</span>
            {coverId === item.id && <span className="wiki-album-cover-badge">封面</span>}
          </button>
          {renderTileActions(item)}
        </article>,
      );
    }
    return nodes;
  }

  return <section className="wiki-album-page" data-c-surface="album">
    <header className="page-header wiki-album-header">
      <div className="page-header-row">
        <div className="page-header-text">
          <button type="button" className="text-button wiki-album-back" onClick={onBack}><ArrowLeft size={16} />返回库</button>
          {managing && !readOnly
            ? <input className="wiki-album-title-input" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} onBlur={saveMeta} aria-label="图集标题" />
            : <h1>{meta.title || "图集"}</h1>}
          <div className="page-header-sub wiki-album-sub">
            <span><Images size={14} aria-hidden="true" /> {meta.itemCount || items.length} 张</span>
            {(album.tags || []).slice(0, 3).map((tag) => <span className="wiki-tag" key={tag}>{tag}</span>)}
            {meta.sourceUrl && <a className="wiki-album-source" href={meta.sourceUrl} target="_blank" rel="noreferrer">来源 <ArrowUpRight size={12} /></a>}
            {importSources.map(s => <a key={s.runId} className="wiki-album-source" href={`#imports?task=${s.runId}`}>导入来源 · 任务 #{s.runId}</a>)}
          </div>
        </div>
        <div className="page-header-actions">
          {!readOnly && <div className="wiki-album-more">
            <button type="button" className="icon-only button-sm" aria-label="更多" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><MoreHorizontal size={16} /></button>
            {menuOpen && <div className="wiki-album-menu" role="menu">
              <button type="button" role="menuitem" disabled={busy} onClick={() => { setManaging((value) => !value); setMenuOpen(false); }}>{managing ? "完成管理" : "管理"}</button>
              <button type="button" role="menuitem" disabled={busy} onClick={() => sortBy("name")}>按文件名排序</button>
              <button type="button" role="menuitem" disabled={busy} onClick={() => sortBy("added")}>按添加时间排序</button>
              <label className="wiki-album-append">追加图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy}
                onChange={(e) => { appendFiles(e.target.files); e.target.value = ""; setMenuOpen(false); }} /></label>
            </div>}
          </div>}
          {!managing && <Button variant="primary" disabled={!items.length || busy} onClick={() => openViewerAt(0)}><Play size={15} />开始浏览</Button>}
        </div>
      </div>
    </header>
    {managing && !readOnly && <div className="wiki-album-manage-bar">
      <TagInput label="标签" value={tags} disabled={busy} onChange={setTags} />
      <label>来源链接<input value={sourceUrl} disabled={busy} onChange={(e) => setSourceUrl(e.target.value)} onBlur={saveMeta} /></label>
      <Button variant="secondary" disabled={busy} onClick={saveMeta}>保存标题与标签</Button>
    </div>}
    <div className="wiki-album-toolbar">
      <div className="wiki-album-view-toggle ui-segmented" role="group" aria-label="总览布局">
        <button type="button" aria-pressed={layout === "grid"} onClick={() => changeLayout("grid")}>方格</button>
        <button type="button" aria-pressed={layout === "strip"} aria-label="竖向长条" onClick={() => changeLayout("strip")}>长条</button>
      </div>
      {layout === "grid" && <label className="wiki-album-density"><Grid2X2 size={13} aria-hidden="true" />
        <input type="range" min="140" max="320" step="20" value={tileSize} onChange={(event) => setTileSize(Number(event.target.value))} aria-label="缩略图大小" />
        <Grid2X2 size={19} aria-hidden="true" />
      </label>}
      {layout === "strip" && <label className="wiki-album-density wiki-album-strip-width">
        <span>图片宽度</span>
        <input type="range" min="480" max="1920" step="40" value={stripWidth} onChange={(event) => setStripWidth(Number(event.target.value))} aria-label="长条图片宽度" />
        <output>{stripWidth}px</output>
      </label>}
    </div>
    {error && <p className="wiki-error" role="alert">{error}</p>}
    <div className={`wiki-album-grid-stage${layout === "strip" ? " is-strip-stage" : ""}`}>
      {layout === "strip" ? (
        <>
          <div className="wiki-album-strip-scroller" ref={stripStageRef}>
            <div
              className={`wiki-album-grid is-strip${managing ? " is-managing" : ""}`}
              style={{ "--album-strip-width": `${stripWidth}px`, height: items.length ? stripTotalHeight(stripOffsets) : undefined }}
            >
              {renderStripTiles()}
              {!items.length && <div className="wiki-album-empty">
                <p className="wiki-muted">这个图集还没有图片</p>
                {!readOnly && <label className="button-sm"><Plus size={16} />添加图片
                  <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy}
                    onChange={(e) => { appendFiles(e.target.files); e.target.value = ""; }} />
                </label>}
              </div>}
            </div>
          </div>
          {items.length > 0 && <>
            <AlbumMinimap items={items} index={stripIndex}
              position={stripPositionAtOffset(stripScroll.top)} visibleEnd={stripPositionAtOffset(stripScroll.top + stripScroll.height)}
              onSeek={seekStripToIndex} />
            <div className="wiki-album-strip-progress" aria-live="polite">
              <span className="wiki-album-strip-progress-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(4, ((stripIndex + 1) / items.length) * 100)}%` }} />
              </span>
              <span className="wiki-album-strip-progress-count">{stripIndex + 1} / {items.length}</span>
            </div>
          </>}
        </>
      ) : (
        <div className={`wiki-album-grid${managing ? " is-managing" : ""}`} style={{ "--album-tile-size": `${tileSize}px` }}>
          {items.map((item, itemIndex) => <article key={item.id} className="wiki-album-tile">
            <button type="button" className="wiki-album-tile-open" aria-label={`浏览第 ${itemIndex + 1} 张`} onClick={() => openViewerAt(itemIndex)}>
              <img src={apiUrl(`/api/elements/${item.id}/thumbnail?width=800`)} alt={item.image?.originalName || `第 ${itemIndex + 1} 张图片`} draggable={false} loading="lazy" />
              <span className="wiki-album-tile-number">{String(itemIndex + 1).padStart(2, "0")}</span>
              {coverId === item.id && <span className="wiki-album-cover-badge">封面</span>}
            </button>
            {renderTileActions(item)}
          </article>)}
          {!items.length && <div className="wiki-album-empty">
            <p className="wiki-muted">这个图集还没有图片</p>
            {!readOnly && <label className="button-sm"><Plus size={16} />添加图片
              <input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={busy}
                onChange={(e) => { appendFiles(e.target.files); e.target.value = ""; }} />
            </label>}
          </div>}
        </div>
      )}
    </div>
    {viewerOpen && items.length > 0 && <Suspense fallback={null}><AlbumViewer items={items} index={Math.min(index, items.length - 1)} onIndexChange={setIndex} album={album} onClose={() => setViewerOpen(false)} /></Suspense>}
  </section>;
}
