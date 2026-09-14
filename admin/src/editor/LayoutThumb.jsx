import React from 'react';
// Tiny read-only preview of a layout's zones for lists.
export default function LayoutThumb({ doc, width = 160 }) {
  const c = (doc && doc.canvas) || { w: 1920, h: 1080 };
  const k = width / c.w;
  const home = doc && doc.screens && doc.screens[0];
  return (
    <div className="thumb" style={{ width, background: c.background || '#0b1a2a' }} aria-hidden>
      {((doc && doc.zones) || []).filter((z) => !z.hidden && (!home || home.zones.includes(z.id))).map((z) => (
        <div key={z.id} className={`t-${z.type}`} style={{ left: z.x * k, top: z.y * k, width: z.w * k, height: z.h * k, background: z.type === 'video' ? undefined : (z.style && z.style.background) || 'rgba(255,255,255,.08)' }} />))}
    </div>
  );
}
