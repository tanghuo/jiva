import { useLayoutEffect, useRef, useState } from "react";
import { apiUrl } from "./api.js";

const ROW_HEIGHT = 96;

export default function AlbumMinimap({ items, index, position, visibleEnd, onSeek }) {
  const scroller = useRef(null);
  const dragging = useRef(null);
  const frame = useRef(null);
  const manualUntil = useRef(0);
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const [view, setView] = useState({ top: 0, height: 600 });

  useLayoutEffect(() => {
    const node = scroller.current;
    const measure = () => setView({ top: node.scrollTop, height: node.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); dragging.current = null; };
  }, []);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (dragging.current || performance.now() < manualUntil.current) return;
    const top = position * ROW_HEIGHT;
    if (top < node.scrollTop || top + ROW_HEIGHT > node.scrollTop + node.clientHeight) {
      node.scrollTop = top < node.scrollTop ? top : top + ROW_HEIGHT - node.clientHeight;
    }
    setView({ top: node.scrollTop, height: node.clientHeight });
  }, [position]);

  function seekFromPointer() {
    const node = scroller.current;
    const drag = dragging.current;
    if (!node || !drag) return;
    const y = Math.max(0, Math.min(node.clientHeight, drag.y - node.getBoundingClientRect().top));
    seekRef.current(Math.max(0, Math.min(items.length - 0.0001, (node.scrollTop + y - drag.offset) / ROW_HEIGHT)));
  }

  function advanceAtEdge(time) {
    const node = scroller.current;
    const drag = dragging.current;
    if (!node || !drag) return;
    const y = drag.y - node.getBoundingClientRect().top;
    // A wide activation band and bounded speed avoid the dead zone followed
    // by a sudden rush when the pointer leaves the navigation strip.
    const edge = Math.min(64, node.clientHeight / 3);
    const strength = y < edge ? -Math.min(1, (edge - y) / edge)
      : y > node.clientHeight - edge ? Math.min(1, (y - node.clientHeight + edge) / edge) : 0;
    const speed = Math.sign(strength) * strength * strength;
    const elapsed = Math.min(32, time - (drag.time || time));
    drag.time = time;
    const previousTop = node.scrollTop;
    if (speed && time >= (drag.wheelUntil || 0)) node.scrollTop += speed * elapsed * (ROW_HEIGHT * 2 / 1000);
    if (drag.changed || node.scrollTop !== previousTop) {
      drag.changed = false;
      seekFromPointer();
    }
    frame.current = requestAnimationFrame(advanceAtEdge);
  }

  function stopDragging(event) {
    const wasDragging = Boolean(dragging.current);
    if (dragging.current?.changed) seekFromPointer();
    dragging.current = null;
    cancelAnimationFrame(frame.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (wasDragging) {
      const node = scroller.current;
      const viewport = node.querySelector(".wiki-album-minimap-viewport");
      if (viewport.offsetTop < node.scrollTop) node.scrollTop = viewport.offsetTop;
      else if (viewport.offsetTop + viewport.offsetHeight > node.scrollTop + node.clientHeight) {
        node.scrollTop = viewport.offsetTop + Math.min(viewport.offsetHeight, node.clientHeight) - node.clientHeight;
      }
    }
  }

  const start = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - 3);
  const end = Math.min(items.length, Math.ceil((view.top + view.height) / ROW_HEIGHT) + 3);
  return <nav className="wiki-album-minimap" aria-label="图集缩略导航">
    <div ref={scroller} className="wiki-album-minimap-scroller" tabIndex={0}
      aria-label="图集进度" role="slider" aria-valuemin={1} aria-valuemax={items.length} aria-valuenow={index + 1} aria-orientation="vertical"
      onWheel={() => {
        manualUntil.current = performance.now() + 800;
        // Let native wheel scrolling finish without edge auto-scroll fighting it.
        if (dragging.current) dragging.current.wheelUntil = performance.now() + 180;
      }}
      onScroll={(event) => {
        setView({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight });
        // Wheel events still scroll the strip while the pointer is captured.
        // Recompute the dragged position even if the mouse hasn't moved.
        if (dragging.current) dragging.current.changed = true;
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || event.pointerType === "touch") return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const y = event.currentTarget.scrollTop + event.clientY - event.currentTarget.getBoundingClientRect().top;
        const insideViewport = y >= position * ROW_HEIGHT && y <= visibleEnd * ROW_HEIGHT;
        dragging.current = { y: event.clientY, offset: insideViewport ? y - position * ROW_HEIGHT : y % ROW_HEIGHT };
        seekFromPointer();
        frame.current = requestAnimationFrame(advanceAtEdge);
      }}
      onPointerMove={(event) => {
        if (!dragging.current) return;
        dragging.current.y = event.clientY;
        dragging.current.changed = true;
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={stopDragging}
      onClick={(event) => {
        if (event.detail === 0) return;
        // Touch taps select a thumbnail; mouse selection is handled on pointerdown.
        if (event.nativeEvent.pointerType !== "touch") return;
        const tile = event.target.closest("[data-minimap-index]");
        if (tile) onSeek(Number(tile.dataset.minimapIndex));
      }}
      onKeyDown={(event) => {
        const target = { Home: 0, End: items.length - 1, ArrowUp: index - 1, ArrowDown: index + 1, PageUp: index - 10, PageDown: index + 10 }[event.key];
        if (target === undefined) return;
        event.preventDefault();
        onSeek(Math.max(0, Math.min(items.length - 1, target)));
      }}>
      <div className="wiki-album-minimap-content" style={{ height: items.length * ROW_HEIGHT }}>
        {items.slice(start, end).map((item, offset) => {
          const itemIndex = start + offset;
          return <div key={item.id} data-minimap-index={itemIndex}
            aria-label={`跳到第 ${itemIndex + 1} 张`} aria-current={itemIndex === index ? "true" : undefined}
            title={`第 ${itemIndex + 1} 张`} style={{ top: itemIndex * ROW_HEIGHT, height: ROW_HEIGHT }}>
            <img src={apiUrl(`/api/elements/${item.id}/thumbnail`)} alt="" draggable={false} decoding="async" />
            <span>{itemIndex + 1}</span>
          </div>;
        })}
        <div className="wiki-album-minimap-viewport" aria-hidden="true"
          style={{ top: position * ROW_HEIGHT, height: Math.max(12, (visibleEnd - position) * ROW_HEIGHT) }} />
      </div>
    </div>
    <span className="wiki-album-minimap-count">{index + 1} / {items.length}</span>
  </nav>;
}
