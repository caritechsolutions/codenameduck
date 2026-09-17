import React from 'react';
import { upgradeLayout, pageZoneIds, homePageId } from '../../../shared/layout-model.js';
// Tiny read-only preview of a layout's home page for lists.
export default function LayoutThumb({ doc, width = 160 }) {
  const c = (doc && doc.canvas) || { w: 1920, h: 1080 };
  const k = width / c.w;
  const d = doc ? upgradeLayout(doc) : null;
  const ids = d ? new Set(pageZoneIds(d, homePageId(d))) : new Set();
  return (
    <div className="thumb" style={{ width, background: c.background || '#0b1a2a' }} aria-hidden>
      {((d && d.zones) || []).filter((z) => ids.has(z.id)).map((z) => (
        <div key={z.id} className={`t-${z.type}`} style={{ left: z.x * k, top: z.y * k, width: z.w * k, height: z.h * k, background: z.type === 'video' ? undefined : (z.style && z.style.background) || 'rgba(255,255,255,.08)' }} />))}
    </div>
  );
}
