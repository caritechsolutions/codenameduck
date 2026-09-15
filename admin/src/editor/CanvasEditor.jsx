import React, { useEffect, useRef, useState, useCallback } from 'react';
import { HANDLES, PLACEMENT_TYPES, dragRect, resizeRect, zoneLabel } from './geometry.js';

// 16:9 canvas that draws the layout's zones as boxes you can select, drag and resize.
// Coordinates are converted between screen pixels and canvas pixels via `scale`.
export default function CanvasEditor({ doc, onChange, selectedId, onSelect, screenId, width = 960 }) {
  const canvas = doc.canvas || { w: 1920, h: 1080 };
  const scale = width / canvas.w;
  const height = canvas.h * scale;
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);       // { id, mode: 'move'|handle, start:{x,y}, rect, shift }
  const [ghost, setGhost] = useState(null);      // live rect during drag
  const screen = (doc.screens || []).find((s) => s.id === screenId);
  const inScreen = (z) => !screen || PLACEMENT_TYPES.includes(z.type) || screen.zones.includes(z.id);

  const onPointerDown = (e, z, mode) => {
    e.preventDefault(); e.stopPropagation();
    onSelect(z.id);
    if (!Number.isFinite(e.clientX)) return;
    ref.current.setPointerCapture && ref.current.setPointerCapture(e.pointerId);
    setDrag({ id: z.id, mode, start: { x: e.clientX, y: e.clientY }, rect: { x: z.x, y: z.y, w: z.w, h: z.h }, shift: e.shiftKey, alt: e.altKey });
    setGhost({ x: z.x, y: z.y, w: z.w, h: z.h });
  };
  const compute = useCallback((e) => {
    if (!drag) return null;
    const dx = (e.clientX - drag.start.x) / scale, dy = (e.clientY - drag.start.y) / scale;
    const opts = { free: e.altKey || drag.alt };
    if (drag.mode === 'move') return dragRect(drag.rect, dx, dy, canvas, opts);
    const z = doc.zones.find((x) => x.id === drag.id);
    const aspect = e.shiftKey || drag.shift ? drag.rect.w / drag.rect.h : (z && z.type === 'video' && !(e.altKey || drag.alt) ? 16 / 9 : null);
    return resizeRect(drag.rect, drag.mode, dx, dy, canvas, { ...opts, aspect });
  }, [drag, scale, canvas, doc.zones]);

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => { const r = compute(e); if (r) setGhost(r); };
    const up = (e) => {
      const r = compute(e);
      if (r) onChange({ ...doc, zones: doc.zones.map((z) => (z.id === drag.id ? { ...z, ...r } : z)) });
      setDrag(null); setGhost(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, compute, doc, onChange]);

  // Keyboard: arrows nudge (shift = 10px), Delete handled by parent via onKeyDown prop-less approach
  const onKeyDown = (e) => {
    if (!selectedId) return;
    const z = doc.zones.find((x) => x.id === selectedId);
    if (!z) return;
    const step = e.shiftKey ? 10 : 1;
    let r = null;
    if (e.key === 'ArrowLeft') r = dragRect(z, -step, 0, canvas, { free: true });
    if (e.key === 'ArrowRight') r = dragRect(z, step, 0, canvas, { free: true });
    if (e.key === 'ArrowUp') r = dragRect(z, 0, -step, canvas, { free: true });
    if (e.key === 'ArrowDown') r = dragRect(z, 0, step, canvas, { free: true });
    if (r) { e.preventDefault(); onChange({ ...doc, zones: doc.zones.map((x) => (x.id === selectedId ? { ...x, ...r } : x)) }); }
  };

  const px = (v) => v * scale;
  return (
    <div className="canvas-wrap">
      <div ref={ref} className="canvas" tabIndex={0} onKeyDown={onKeyDown} role="application" aria-label="Layout canvas"
        style={{ width, height, background: canvas.background || '#0b1a2a', backgroundImage: canvas.backgroundImage ? `url(${canvas.backgroundImage})` : undefined, backgroundSize: 'cover' }}
        onPointerDown={() => onSelect(null)}>
        <div className="grid" />
        {doc.zones.map((z) => {
          const sel = z.id === selectedId;
          const r = sel && ghost ? ghost : z;
          const dim = !inScreen(z);
          return (
            <div key={z.id} className={`czone t-${z.type}${sel ? ' sel' : ''}${dim ? ' dim' : ''}${z.hidden ? ' hidden-zone' : ''}`}
              style={{ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h),
                fontSize: Math.max(9, ((z.style && z.style.fontSize) || 28) * scale), color: (z.style && z.style.color) || '#fff',
                background: z.type === 'video' ? undefined : (z.style && z.style.background) || undefined, textAlign: (z.style && z.style.align) || 'left' }}
              onPointerDown={(e) => onPointerDown(e, z, 'move')} data-zone={z.id} title={`${z.id} (${z.type}) ${z.x},${z.y} ${z.w}×${z.h}`}>
              <div className="czone-label"><span className="czone-id">{z.id}</span> {zoneLabel(z)}</div>
              {z.type === 'video' && <div className="tvglyph">▶ live TV</div>}
              {z.type === 'channel_list' && <div className="chglyph">{[5, 7, 9, 12].map((n) => <div key={n} className={n === 7 ? 'cur' : ''} style={n === 7 && z.style && z.style.highlight ? { background: z.style.highlight, color: '#1a1a1a' } : undefined}>{n} Channel {n}</div>)}</div>}
              {z.type === 'menu' && <div className="chglyph">{(z.items || []).map((it, i) => <div key={i}>{it.label}</div>)}</div>}
              {z.type === 'app_launcher' && <div className="chglyph row">{(z.apps || []).map((a, i) => <div key={i}>{a.label}</div>)}</div>}
              {z.type === 'text' && <div className="ctext" style={{ fontWeight: (z.style && z.style.fontWeight) || 'normal' }}>{z.text}</div>}
              {z.type === 'clock' && <div className="ctext">{z.format === 'HH:mm:ss' ? '20:15:30' : z.format && /a/.test(z.format) ? '08:15 PM' : '20:15'}</div>}
              {z.type === 'image' && (z.src ? <img src={z.src} alt="" draggable={false} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null)}
              {z.type === 'weather' && <div className="ctext">☀ 24°</div>}
              {z.type === 'banner' && <div className="ctext">5  News   20:15</div>}
              {z.type === 'digits' && <div className="ctext" style={{ textAlign: 'right' }}>12</div>}
              {z.type === 'popup' && <div className="ctext" style={{ textAlign: 'center' }}>Your taxi is waiting at reception</div>}
              {sel && HANDLES.map((h) => <div key={h} className={`handle h-${h}`} onPointerDown={(e) => onPointerDown(e, z, h)} />)}
            </div>
          );
        })}
        {ghost && drag && <div className="coords">{Math.round(ghost.x)}, {Math.round(ghost.y)} · {Math.round(ghost.w)} × {Math.round(ghost.h)}</div>}
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>Drag to move, handles to resize (snap to {10}px; hold Alt for free, Shift keeps aspect). Arrow keys nudge the selection. Dimmed zones are not on this screen.</div>
    </div>
  );
}
