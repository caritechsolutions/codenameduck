import React, { useEffect, useRef, useState } from 'react';
import '../../../shared/zones.css';
import * as draw from '../../../shared/zone-draw.js';
import { isFocusable } from '../../../shared/layout-model.js';

// In-editor preview drawn by the renderer's own zone code (shared/zone-draw.js) with fake
// channel/weather/guest data. What you see here is what the set draws, minus the live picture.
export const FAKE_LINEUP = [
  { id: 1, number: 1, name: 'BBC One' }, { id: 2, number: 2, name: 'BBC Two' }, { id: 3, number: 3, name: 'ITV' }, { id: 4, number: 4, name: 'Channel 4' },
  { id: 5, number: 5, name: 'Sky News' }, { id: 6, number: 6, name: 'CNN' }, { id: 7, number: 7, name: 'Eurosport' }, { id: 8, number: 8, name: 'Hotel channel' },
];
export const FAKE_WEATHER = { ok: true, icon: '⛅', temp_c: 21, temp_f: 70, text: 'Partly cloudy', wind_kmh: 12 };
export const FAKE_APPS = [{ id: 'netflix', name: 'Netflix', icon: null }, { id: 'youtube.leanback.v4', name: 'YouTube', icon: null }, { id: 'amazon', name: 'Prime Video', icon: null }];
export function fakeContext(tenant) {
  return { hotel: (tenant && tenant.display_name) || 'Hotel', room: '214', guest: 'Ms Jane Example', guest_first: 'Jane', checkout_date: '24/09/2026',
    serial: 'PREVIEW', logo: (tenant && tenant.settings && tenant.settings.logo_url) || '', units: 'metric' };
}

export default function LayoutPreview({ doc, pageId, width = 960, tenant, apps = null, fullscreen = false }) {
  const canvas = doc.canvas || { w: 1920, h: 1080 };
  const scale = width / canvas.w;
  const stageRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const firstFocus = draw.visibleZones(doc, pageId, { fullscreen }).find((z) => isFocusable(z));
  const focusKey = firstFocus && firstFocus.id;
  useEffect(() => {
    const stage = stageRef.current; if (!stage) return;
    const ctx = { ...draw.liveContext(fakeContext(tenant), now), __preview: true, __now: now };
    const env = { lineup: FAKE_LINEUP, currentIndex: 1, focus: firstFocus ? { zone: firstFocus.id, index: 0 } : {}, weather: FAKE_WEATHER, units: 'metric', preview: true,
      apps: apps && apps.length ? apps : FAKE_APPS,
      videoRect: (z) => (fullscreen ? { x: 0, y: 0, w: canvas.w, h: canvas.h } : { x: z.x, y: z.y, w: z.w, h: z.h }) };
    draw.renderStage(stage, doc, ctx, env, pageId, { fullscreen });
  }, [doc, pageId, fullscreen, tenant, apps, focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (stageRef.current) draw.tick(stageRef.current, doc, fakeContext(tenant), now); }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="tvpreview" style={{ width, height: canvas.h * scale }} data-testid="tvpreview">
      <div ref={stageRef} className="tvstage" style={{ width: canvas.w, height: canvas.h, transform: `scale(${scale})` }} />
    </div>
  );
}
