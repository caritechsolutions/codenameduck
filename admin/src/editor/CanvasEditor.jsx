import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HANDLES, PLACEMENT_TYPES, dragRect, resizeRect, guideSnap, zoneLabel, snap, pageZoneIds, isOnPage } from './geometry.js';

// 16:9 canvas that draws the layout's zones as boxes you can select (shift/ctrl for several),
// drag and resize. Snap to an 8 px grid plus smart guides to other zones and the canvas
// (Alt = free). Palette items are dropped onto it. Coordinates convert between screen pixels
// and canvas pixels via `scale`.
export default function CanvasEditor({ doc, onChange, selectedIds = [], onSelect, pageId, width = 960, errorsByZone = {}, onDropType }) {
  const canvas = doc.canvas || { w: 1920, h: 1080 };
  const scale = width / canvas.w;
  const height = canvas.h * scale;
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);       // { ids, primary, mode, start, rects, shift, alt }
  const [ghost, setGhost] = useState(null);      // { [id]: rect } during a drag
  const [guides, setGuides] = useState([]);
  const [over, setOver] = useState(false);
  const shownIds = new Set(pageZoneIds(doc, pageId));
  const inScreen = (z) => PLACEMENT_TYPES.includes(z.type) || shownIds.has(z.id);
  const inherited = (z) => shownIds.has(z.id) && !isOnPage(doc, pageId, z.id);
  const isSel = (id) => selectedIds.includes(id);

  const onPointerDown = (e, z, mode) => {
    e.preventDefault(); e.stopPropagation();
    let ids;
    if (mode === 'move' && (e.shiftKey || e.ctrlKey || e.metaKey)) ids = isSel(z.id) ? selectedIds.filter((i) => i !== z.id) : [...selectedIds, z.id];
    else ids = isSel(z.id) ? selectedIds : [z.id];
    onSelect(ids);
    if (!ids.includes(z.id) || z.locked || !Number.isFinite(e.clientX)) return;
    ref.current.setPointerCapture && ref.current.setPointerCapture(e.pointerId);
    const movable = mode === 'move' ? ids.filter((id) => { const x = doc.zones.find((q) => q.id === id); return x && !x.locked; }) : [z.id];
    const rects = {};
    for (const id of movable) { const x = doc.zones.find((q) => q.id === id); rects[id] = { x: x.x, y: x.y, w: x.w, h: x.h }; }
    setDrag({ ids: movable, primary: z.id, mode, start: { x: e.clientX, y: e.clientY }, rects, shift: e.shiftKey, alt: e.altKey });
    setGhost({ ...rects });
  };
  const compute = useCallback((e) => {
    if (!drag) return null;
    const dx = (e.clientX - drag.start.x) / scale, dy = (e.clientY - drag.start.y) / scale;
    const free = e.altKey || drag.alt;
    const out = {}; let lines = [];
    if (drag.mode === 'move') {
      const p = drag.rects[drag.primary];
      let pr = dragRect(p, dx, dy, canvas, { free });
      if (!free) { const g = guideSnap(pr, doc.zones.filter((z) => !drag.ids.includes(z.id) && inScreen(z)), canvas); pr = g.rect; lines = g.guides; }
      const ddx = pr.x - p.x, ddy = pr.y - p.y;
      for (const id of drag.ids) { const r = drag.rects[id]; out[id] = id === drag.primary ? pr : dragRect(r, ddx, ddy, canvas, { free: true }); }
    } else {
      const z = doc.zones.find((x) => x.id === drag.primary);
      const r = drag.rects[drag.primary];
      const aspect = e.shiftKey || drag.shift ? r.w / r.h : (z && z.type === 'video' && !free ? 16 / 9 : null);
      out[drag.primary] = resizeRect(r, drag.mode, dx, dy, canvas, { free, aspect });
    }
    return { rects: out, lines };
  }, [drag, scale, canvas, doc.zones]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => { const r = compute(e); if (r) { setGhost(r.rects); setGuides(r.lines); } };
    const up = (e) => {
      const moved = Math.abs(e.clientX - drag.start.x) + Math.abs(e.clientY - drag.start.y) >= 3;   // a plain click changes nothing
      const r = moved ? compute(e) : null;
      if (r) {
        const changed = Object.keys(r.rects).some((id) => { const z = doc.zones.find((q) => q.id === id); return z && (z.x !== r.rects[id].x || z.y !== r.rects[id].y || z.w !== r.rects[id].w || z.h !== r.rects[id].h); });
        if (changed) onChange({ ...doc, zones: doc.zones.map((z) => (r.rects[z.id] ? { ...z, ...r.rects[z.id] } : z)) });
      }
      setDrag(null); setGhost(null); setGuides([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, compute, doc, onChange]);

  // Keyboard: arrows nudge the selection (shift = one grid step).
  const onKeyDown = (e) => {
    if (!selectedIds.length) return;
    const step = e.shiftKey ? 8 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onChange({ ...doc, zones: doc.zones.map((z) => (isSel(z.id) && !z.locked ? { ...z, ...dragRect(z, d[0], d[1], canvas, { free: true }) } : z)) });
  };
  // Palette drop
  const toCanvas = (e) => { const b = ref.current.getBoundingClientRect(); return { x: (e.clientX - b.left) / scale, y: (e.clientY - b.top) / scale }; };
  const onDrop = (e) => {
    e.preventDefault(); setOver(false);
    const type = e.dataTransfer && e.dataTransfer.getData('text/zone-type');
    if (type && onDropType) { const p = toCanvas(e); onDropType(type, { x: snap(p.x), y: snap(p.y) }); }
  };

  const px = (v) => v * scale;
  return (
    <div className="canvas-wrap">
      <div ref={ref} className={'canvas' + (over ? ' drop' : '')} tabIndex={0} onKeyDown={onKeyDown} role="application" aria-label="Layout canvas"
        style={{ width, height, background: canvas.background || '#0b1a2a', backgroundImage: canvas.backgroundImage ? `url(${canvas.backgroundImage})` : undefined, backgroundSize: 'cover' }}
        onPointerDown={() => onSelect([])}
        onDragOver={(e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('text/zone-type')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!over) setOver(true); } }}
        onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <div className="grid" style={{ backgroundSize: `${px(8 * 5)}px ${px(8 * 5)}px` }} />
        {doc.zones.map((z) => {
          const sel = isSel(z.id);
          const r = ghost && ghost[z.id] ? ghost[z.id] : z;
          const dim = !inScreen(z);
          const errs = errorsByZone[z.id];
          return (
            <div key={z.id} className={`czone t-${z.type}${sel ? ' sel' : ''}${dim ? ' dim' : ''}${inherited(z) ? ' inherited' : ''}${z.locked ? ' locked' : ''}${errs ? ' err' : ''}${z.action ? ' has-action' : ''}`}
              style={{ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h),
                fontSize: Math.max(9, ((z.style && z.style.fontSize) || 28) * scale), color: (z.style && z.style.color) || '#fff',
                fontFamily: z.style && z.style.fontFamily ? `"${z.style.fontFamily}", sans-serif` : undefined,
                fontStyle: (z.style && z.style.fontStyle) || undefined, opacity: dim ? undefined : (z.style && z.style.opacity != null ? z.style.opacity : undefined),
                background: z.type === 'video' ? undefined : (z.style && z.style.background) || undefined, textAlign: (z.style && z.style.align) || 'left',
                borderRadius: z.style && z.style.borderRadius ? px(z.style.borderRadius) : undefined }}
              onPointerDown={(e) => onPointerDown(e, z, 'move')} data-zone={z.id} data-selected={sel ? '1' : '0'} title={`${z.id} (${z.type}) ${z.x},${z.y} ${z.w}×${z.h}${z.locked ? ' · locked' : ''}`}>
              <div className="czone-label"><span className="czone-id">{z.id}</span> {zoneLabel(z)}{z.locked ? ' 🔒' : ''}{inherited(z) ? ' · from home' : ''}{z.action ? ' ⚡' : ''}</div>
              {errs && <div className="czone-err" title={errs.join('\n')} aria-label={`errors on ${z.id}`}>!</div>}
              {z.type === 'video' && <div className="tvglyph">▶ live TV</div>}
              {z.type === 'channel_list' && <div className="chglyph">{[5, 7, 9, 12].map((n) => <div key={n} className={n === 7 ? 'cur' : ''} style={n === 7 && z.style && z.style.highlight ? { background: z.style.highlight, color: '#1a1a1a' } : undefined}>{n} Channel {n}</div>)}</div>}
              {z.type === 'menu' && <div className={'chglyph' + (z.layout === 'row' ? ' row' : '')}>{(z.items || []).map((it, i) => <div key={i}>{it.label}</div>)}</div>}
              {z.type === 'app_launcher' && <div className="chglyph row">{(z.apps || []).map((a, i) => <div key={i}>{a.label}</div>)}</div>}
              {z.type === 'apps' && <div className="chglyph row tiles">{['Netflix', 'YouTube', 'Prime', '…'].map((n) => <div key={n} className="tile" style={{ width: px((z.style && z.style.tileSize) || 200), height: px(((z.style && z.style.tileSize) || 200) * 0.75) }}>{n}</div>)}</div>}
              {z.type === 'text' && <div className="ctext" style={{ fontWeight: (z.style && z.style.fontWeight) || 'normal' }}>{z.text}</div>}
              {z.type === 'clock' && <div className="ctext">{z.format === 'HH:mm:ss' ? '20:15:30' : z.format && /a/.test(z.format) ? '08:15 PM' : '20:15'}</div>}
              {z.type === 'image' && (z.src && !/\{\{/.test(z.src) ? <img src={z.src} alt="" draggable={false} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <div className="tvglyph">{z.src ? 'logo' : 'image'}</div>)}
              {z.type === 'weather' && <div className="ctext">☀ 24°</div>}
              {z.type === 'html' && <div className="ctext muted">HTML</div>}
              {z.type === 'button' && <div className="tvglyph" style={{ fontSize: '1em' }}>{z.label || 'Button'}</div>}
              {z.type === 'banner' && <div className="ctext">5  News   20:15</div>}
              {z.type === 'digits' && <div className="ctext" style={{ textAlign: 'right' }}>12</div>}
              {z.type === 'popup' && <div className="ctext" style={{ textAlign: 'center' }}>Your taxi is waiting at reception</div>}
              {sel && selectedIds.length === 1 && !z.locked && HANDLES.map((h) => <div key={h} className={`handle h-${h}`} onPointerDown={(e) => onPointerDown(e, z, h)} />)}
            </div>
          );
        })}
        {guides.map((g, i) => <div key={i} className={'guide guide-' + g.axis} style={g.axis === 'x' ? { left: px(g.pos) } : { top: px(g.pos) }} />)}
        {ghost && drag && ghost[drag.primary] && <div className="coords">{Math.round(ghost[drag.primary].x)}, {Math.round(ghost[drag.primary].y)} · {Math.round(ghost[drag.primary].w)} × {Math.round(ghost[drag.primary].h)}</div>}
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>Drag to move (8 px grid + guides; Alt = free), handles to resize (Shift keeps aspect). Shift-click selects several. Arrows nudge, Shift+arrows by 8. Ctrl-D duplicates, Delete removes. Dimmed zones are not on this page; “from home” = global zone inherited from the home page.</div>
    </div>
  );
}
