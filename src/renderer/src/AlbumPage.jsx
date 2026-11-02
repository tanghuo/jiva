import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Grid2X2, Images, MoreHorizontal, PanelTop, Play, Plus } from "lucide-react";
import useWikiResource from "./useWikiResource.js";
import { apiUrl, request } from "./api.js";
import { Button } from "./ui/Button.jsx";
import TagInput, { readTagInput } from "./TagInput.jsx";
import { elementTags } from "../../shared/domain/elements.js";
import { persistAlbumLayout, readStoredAlbumLayout } from "./albumLayout.js";

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
  const stripStageRef = useRef(null);

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

  useEffect(() => {
    if (layout !== "strip" || viewerOpen || !items.length) {
      setStripIndex(0);
      return undefined;
    }
    const stage = stripStageRef.current;
    if (!stage) return undefined;
    const nodes = [...stage.querySelectorAll("[data-strip-index]")];
    if (!nodes.length) return undefined;
    const ratios = new Map();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const idx = Number(entry.target.getAttribute("data-strip-index"));
        if (!Number.isFinite(idx)) continue;
        ratios.set(idx, entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      let best = 0;
      let bestRatio = -1;
      for (const [idx, ratio] of ratios) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          best = idx;
        }
      }
      setStripIndex(best);
    }, { root: null, threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [layout, viewerOpen, items.length, items.map((item) => item.id).join(",")]);

  const coverId = album?.album?.coverImageId || album?.album?.cover?.imageId;

  function changeLayout(next) {
    setLayout(next === "strip" ? "strip" : "grid");
  }

  function openViewerAt(itemIndex) {
    setIndex(itemIndex);
    setViewerOpen(true);
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
    <div className={`wiki-album-grid-stage${layout === "strip" ? " is-strip-stage" : ""}`} ref={layout === "strip" ? stripStageRef : undefined}>
      <div className={`wiki-album-grid${layout === "strip" ? " is-strip" : ""}${managing ? " is-managing" : ""}`} style={{ "--album-tile-size": `${tileSize}px`, "--album-strip-width": `${stripWidth}px` }}>
        {items.map((item, itemIndex) => <article
          key={item.id}
          className="wiki-album-tile"
          data-strip-index={layout === "strip" ? itemIndex : undefined}
        >
          <button type="button" className="wiki-album-tile-open" aria-label={`浏览第 ${itemIndex + 1} 张`}
            onClick={() => openViewerAt(itemIndex)}>
            <img src={apiUrl(`/api/elements/${item.id}/thumbnail?width=${layout === "strip" ? 1600 : 800}`)} alt={item.image?.originalName || `第 ${itemIndex + 1} 张图片`} draggable={false} loading="lazy" />
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
      {layout === "strip" && items.length > 0 && <div className="wiki-album-strip-progress" aria-live="polite">
        <span className="wiki-album-strip-progress-bar" aria-hidden="true">
          <i style={{ width: `${Math.max(4, ((stripIndex + 1) / items.length) * 100)}%` }} />
        </span>
        <span className="wiki-album-strip-progress-count">{stripIndex + 1} / {items.length}</span>
      </div>}
    </div>
    {viewerOpen && items.length > 0 && <Suspense fallback={null}><AlbumViewer items={items} index={Math.min(index, items.length - 1)} onIndexChange={setIndex} album={album} onClose={() => setViewerOpen(false)} /></Suspense>}
  </section>;
}
