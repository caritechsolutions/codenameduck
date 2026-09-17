// Pure helpers for the canvas layout editor. Canvas units are layout pixels (1920x1080).
import SHARED_ZONE_TYPES from '../../../shared/zone-types.json';
import FONTS_JSON from '../../../shared/fonts.json';
import { VARIABLES as SHARED_VARIABLES } from '../../../shared/zone-draw.js';

export const GRID = 8;
export const MIN_SIZE = 40;
export const GUIDE_THRESHOLD = 6;     // canvas px within which an edge snaps to a guide
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const ZONE_TYPES = SHARED_ZONE_TYPES;   // shared/zone-types.json
export const PLACEMENT_TYPES = ['banner', 'digits', 'popup'];   // position/style of the renderer's OSD elements
export const ACTIONS = ['toggle_menu', 'fullscreen_tv', 'home', 'show_page', 'show_screen', 'close_page', 'launch_app', 'tune', 'reload'];
export const BUILTIN_ACTIONS = [
  { value: 'fullscreen_tv', label: 'Watch TV (full screen)' },
  { value: 'toggle_menu', label: 'Toggle home / full screen' },
  { value: 'home', label: 'Go to home screen' },
  { value: 'close_page', label: 'Close page / go back' },
  { value: 'tune', label: 'Tune to channel…' },
  { value: 'launch_app', label: 'Launch app…' },
  { value: 'reload', label: 'Reload the TV app' },
];
export const KEY_NAMES = ['PORTAL', 'GUIDE', 'BACK', 'EXIT', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'MENU', 'INFO'];
export const VARIABLES = SHARED_VARIABLES;
export const FONTS = FONTS_JSON;
export const SHADOW_OPTIONS = [['', 'none'], ['soft', 'soft'], ['strong', 'strong'], ['outline', 'outline']];
// Palette groups (docs/PHASE3.md B2)
export const PALETTE = [
  { group: 'Video', items: [['video', 'Live TV']] },
  { group: 'Text', items: [['text', 'Text']] },
  { group: 'Image', items: [['image', 'Image']] },
  { group: 'Channel list', items: [['channel_list', 'Channel list']] },
  { group: 'Menu', items: [['menu', 'Menu'], ['apps', 'Apps (tiles)'], ['app_launcher', 'App launcher (fixed ids)']] },
  { group: 'Clock', items: [['clock', 'Clock']] },
  { group: 'Weather', items: [['weather', 'Weather']] },
  { group: 'OSD placement', items: [['banner', 'INFO banner'], ['digits', 'Channel digits'], ['popup', 'Message popup']] },
  { group: 'HTML', items: [['html', 'HTML page']] },
];
export const TYPE_LABELS = Object.fromEntries(PALETTE.flatMap((g) => g.items));

export const snap = (v, grid = GRID) => Math.round(v / grid) * grid;

export function clampRect(r, canvas) {
  const w = Math.max(MIN_SIZE, Math.min(r.w, canvas.w));
  const h = Math.max(MIN_SIZE, Math.min(r.h, canvas.h));
  const x = Math.max(0, Math.min(r.x, canvas.w - w));
  const y = Math.max(0, Math.min(r.y, canvas.h - h));
  return { x, y, w, h };
}

// Move by (dx, dy) canvas px; snaps the top-left corner unless free.
export function dragRect(r, dx, dy, canvas, { free = false } = {}) {
  let x = r.x + dx, y = r.y + dy;
  if (!free) { x = snap(x); y = snap(y); }
  return clampRect({ ...r, x, y }, canvas);
}

// Resize from a handle by (dx, dy). Keeps the opposite edge fixed; snaps the moving edges.
export function resizeRect(r, handle, dx, dy, canvas, { free = false, aspect = null } = {}) {
  let { x, y, w, h } = r;
  const right = x + w, bottom = y + h;
  if (handle.includes('e')) w = Math.max(MIN_SIZE, w + dx);
  if (handle.includes('s')) h = Math.max(MIN_SIZE, h + dy);
  if (handle.includes('w')) { x = Math.min(x + dx, right - MIN_SIZE); w = right - x; }
  if (handle.includes('n')) { y = Math.min(y + dy, bottom - MIN_SIZE); h = bottom - y; }
  if (!free) {
    const nx = handle.includes('w') ? snap(x) : x;
    const ny = handle.includes('n') ? snap(y) : y;
    if (handle.includes('w')) { w = right - nx; x = nx; }
    if (handle.includes('n')) { h = bottom - ny; y = ny; }
    if (handle.includes('e')) w = snap(w);
    if (handle.includes('s')) h = snap(h);
    w = Math.max(MIN_SIZE, w); h = Math.max(MIN_SIZE, h);
  }
  if (aspect) {
    if (handle === 'n' || handle === 's') w = Math.round(h * aspect); else h = Math.round(w / aspect);
    if (handle.includes('w')) x = right - w;
    if (handle.includes('n')) y = bottom - h;
  }
  return clampRect({ x, y, w, h }, canvas);
}

// Smart guides: snap the rect's left/centre/right (and top/middle/bottom) to the same lines of
// other zones and of the canvas when within `threshold`. Returns the moved rect and the guide
// lines to draw ({axis:'x'|'y', pos}).
export function guideSnap(rect, others, canvas, threshold = GUIDE_THRESHOLD) {
  // edges match edges, centres match centres (a centre never snaps to someone's edge)
  const xe = [0, canvas.w], xc = [canvas.w / 2], ye = [0, canvas.h], yc = [canvas.h / 2];
  for (const o of others) { xe.push(o.x, o.x + o.w); xc.push(o.x + o.w / 2); ye.push(o.y, o.y + o.h); yc.push(o.y + o.h / 2); }
  const best = (pairs) => {
    let hit = null;
    for (const [cands, v] of pairs) for (const c of cands) { const d = c - v; if (Math.abs(d) <= threshold && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, pos: c }; }
    return hit;
  };
  const hx = best([[xe, rect.x], [xc, rect.x + rect.w / 2], [xe, rect.x + rect.w]]);
  const hy = best([[ye, rect.y], [yc, rect.y + rect.h / 2], [ye, rect.y + rect.h]]);
  const out = { ...rect };
  const guides = [];
  if (hx) { out.x = rect.x + hx.d; guides.push({ axis: 'x', pos: hx.pos }); }
  if (hy) { out.y = rect.y + hy.d; guides.push({ axis: 'y', pos: hy.pos }); }
  return { rect: clampRect(out, canvas), guides };
}

export function selectionBounds(zones) {
  if (!zones.length) return null;
  const x1 = Math.min(...zones.map((z) => z.x)), y1 = Math.min(...zones.map((z) => z.y));
  const x2 = Math.max(...zones.map((z) => z.x + z.w)), y2 = Math.max(...zones.map((z) => z.y + z.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
// Align the selected zones: to each other when 2+, to the canvas when 1.
export function alignZones(doc, ids, how) {
  const canvas = doc.canvas || { w: 1920, h: 1080 };
  const sel = doc.zones.filter((z) => ids.includes(z.id) && !z.locked);
  if (!sel.length) return doc;
  const b = sel.length > 1 ? selectionBounds(sel) : { x: 0, y: 0, w: canvas.w, h: canvas.h };
  const moved = {};
  for (const z of sel) {
    const r = { x: z.x, y: z.y };
    if (how === 'left') r.x = b.x;
    if (how === 'center') r.x = Math.round(b.x + b.w / 2 - z.w / 2);
    if (how === 'right') r.x = b.x + b.w - z.w;
    if (how === 'top') r.y = b.y;
    if (how === 'middle') r.y = Math.round(b.y + b.h / 2 - z.h / 2);
    if (how === 'bottom') r.y = b.y + b.h - z.h;
    moved[z.id] = clampRect({ ...z, ...r }, canvas);
  }
  return { ...doc, zones: doc.zones.map((z) => (moved[z.id] ? { ...z, ...moved[z.id] } : z)) };
}
// Equal gaps between 3+ zones along an axis (first and last stay put).
export function distributeZones(doc, ids, axis) {
  const sel = doc.zones.filter((z) => ids.includes(z.id) && !z.locked);
  if (sel.length < 3) return doc;
  const k = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
  const sorted = sel.slice().sort((a, b) => a[k[0]] - b[k[0]]);
  const first = sorted[0], last = sorted[sorted.length - 1];
  const total = (last[k[0]] + last[k[1]]) - first[k[0]];
  const sizes = sorted.reduce((a, z) => a + z[k[1]], 0);
  const gap = (total - sizes) / (sorted.length - 1);
  const moved = {};
  let cur = first[k[0]];
  for (const z of sorted) { moved[z.id] = Math.round(cur); cur += z[k[1]] + gap; }
  return { ...doc, zones: doc.zones.map((z) => (moved[z.id] != null ? { ...z, [k[0]]: moved[z.id] } : z)) };
}

export function zoneLabel(z) {
  switch (z.type) {
    case 'text': return (z.text || '').split('\n')[0].slice(0, 40) || 'text';
    case 'image': return z.src === '{{logo}}' ? 'hotel logo' : (z.src || '').split('/').pop() || 'image (pick one)';
    case 'clock': return z.format || 'HH:mm';
    case 'video': return 'LIVE TV';
    case 'channel_list': return 'channel list';
    case 'menu': return `menu (${(z.items || []).length})`;
    case 'app_launcher': return `app launcher (${(z.apps || []).length})`;
    case 'apps': return `apps enabled for the group${z.layout === 'grid' ? ' · grid' : ''}`;
    case 'weather': return 'weather';
    case 'html': return 'html page';
    case 'banner': return 'INFO banner position';
    case 'digits': return 'digit OSD position';
    case 'popup': return 'message popup position';
    default: return z.type;
  }
}

export function nextZoneId(doc, type) {
  const ids = new Set((doc.zones || []).map((z) => z.id));
  const base = type === 'channel_list' ? 'chlist' : type === 'app_launcher' ? 'launcher' : type;
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function newZone(doc, type, at) {
  const id = nextZoneId(doc, type);
  const c = doc.canvas || { w: 1920, h: 1080 };
  const base = { id, type, x: snap(c.w * 0.1), y: snap(c.h * 0.1) };
  let z;
  switch (type) {
    case 'video': z = { ...base, x: 640, y: 120, w: 1200, h: 675, source: 'lineup', startChannel: 'first' }; break;
    case 'text': z = { ...base, w: 800, h: 90, text: 'New text', style: { fontSize: 48, color: '#ffffff' } }; break;
    case 'image': z = { ...base, w: 320, h: 160, src: '', fit: 'contain' }; break;
    case 'clock': z = { ...base, w: 260, h: 70, format: 'HH:mm', style: { fontSize: 44, color: '#ffffff', align: 'right' } }; break;
    case 'channel_list': z = { ...base, w: 480, h: 560, style: { fontSize: 28, color: '#ffffff', background: 'rgba(0,0,0,0.35)', highlight: '#ffd166' } }; break;
    case 'menu': z = { ...base, w: 420, h: 300, items: [{ label: 'Watch TV', action: 'fullscreen_tv' }, { label: 'Hotel info', action: 'show_page', page: 'info' }], style: { fontSize: 36, color: '#ffffff', highlight: '#ffd166' } }; break;
    case 'html': z = { ...base, w: 1200, h: 700, hidden: true, html: '<h1>Hotel information</h1><p>Breakfast 7–10 in the lobby.</p>', style: { fontSize: 32, color: '#ffffff', background: 'rgba(0,0,0,0.85)', padding: 40 } }; break;
    case 'weather': z = { ...base, w: 360, h: 120, units: 'metric', style: { fontSize: 36, color: '#ffffff' } }; break;
    case 'apps': z = { ...base, x: 80, y: 760, w: 1760, h: 220, layout: 'row', style: { fontSize: 30, color: '#ffffff', highlight: '#ffd166', tileSize: 200 } }; break;
    case 'app_launcher': z = { ...base, w: 600, h: 200, apps: [{ label: 'Netflix', app_id: 'netflix' }, { label: 'YouTube', app_id: 'youtube.leanback.v4' }], style: { fontSize: 32, color: '#ffffff', highlight: '#ffd166' } }; break;
    case 'banner': z = { ...base, x: 80, y: 880, w: 1200, h: 80, style: { fontSize: 48, color: '#ffffff', background: 'rgba(0,0,0,0.65)', borderRadius: 14 } }; break;
    case 'digits': z = { ...base, x: 1560, y: 60, w: 280, h: 110, style: { fontSize: 72, color: '#ffffff', background: 'rgba(0,0,0,0.65)', borderRadius: 14, align: 'right' } }; break;
    case 'popup': z = { ...base, x: 210, y: 150, w: 1500, h: 200, style: { fontSize: 46, color: '#ffffff', background: 'rgba(10,20,40,0.94)', borderRadius: 20, align: 'center' } }; break;
    default: z = { ...base, w: 300, h: 200 };
  }
  if (at && !PLACEMENT_TYPES.includes(type)) Object.assign(z, clampRect({ ...z, x: snap(at.x - z.w / 2), y: snap(at.y - z.h / 2) }, c));
  return z;
}

// ---- immutable document edits
export function updateZone(doc, id, patch) {
  return { ...doc, zones: doc.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) };
}
export function updateZones(doc, ids, fn) {
  return { ...doc, zones: doc.zones.map((z) => (ids.includes(z.id) ? { ...z, ...fn(z) } : z)) };
}
export function renameZone(doc, id, newId) {
  if (!newId || newId === id || doc.zones.some((z) => z.id === newId)) return doc;
  return { ...doc,
    zones: doc.zones.map((z) => (z.id === id ? { ...z, id: newId } : z)),
    screens: (doc.screens || []).map((s) => ({ ...s, zones: s.zones.map((zid) => (zid === id ? newId : zid)) })) };
}
export function removeZone(doc, idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  return { ...doc, zones: doc.zones.filter((z) => !ids.includes(z.id)), screens: (doc.screens || []).map((s) => ({ ...s, zones: s.zones.filter((zid) => !ids.includes(zid)) })) };
}
export function addZone(doc, type, screenId, at) {
  const z = newZone(doc, type, at);
  const placement = PLACEMENT_TYPES.includes(type);   // overlays are global, not per screen
  const screens = (doc.screens || []).map((s) => (s.id === screenId && !z.hidden && !placement ? { ...s, zones: [...s.zones, z.id] } : s));
  return { doc: { ...doc, zones: [...doc.zones, z], screens }, zone: z };
}
export function duplicateZone(doc, idOrIds, screenId) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  let out = doc; const zones = [];
  for (const id of ids) {
    const src = out.zones.find((z) => z.id === id);
    if (!src) continue;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: nextZoneId(out, src.type), x: src.x + GRID * 2, y: src.y + GRID * 2, locked: undefined };
    const screens = (out.screens || []).map((s) => (s.id === screenId && !PLACEMENT_TYPES.includes(src.type) && !src.hidden ? { ...s, zones: [...s.zones, copy.id] } : s));
    out = { ...out, zones: [...out.zones, copy], screens };
    zones.push(copy);
  }
  return { doc: out, zone: zones[0], zones };
}
export function moveZoneOrder(doc, id, dir) { // dir: -1 back, +1 front, 'front', 'back'
  const i = doc.zones.findIndex((z) => z.id === id);
  if (i < 0) return doc;
  const j = dir === 'front' ? doc.zones.length - 1 : dir === 'back' ? 0 : i + dir;
  if (j < 0 || j >= doc.zones.length || j === i) return doc;
  const zones = doc.zones.slice(); const [z] = zones.splice(i, 1); zones.splice(j, 0, z);
  return { ...doc, zones };
}
export function toggleZoneInScreen(doc, screenId, zoneId) {
  return { ...doc, screens: (doc.screens || []).map((s) => {
    if (s.id !== screenId) return s;
    return s.zones.includes(zoneId) ? { ...s, zones: s.zones.filter((z) => z !== zoneId) } : { ...s, zones: [...s.zones, zoneId] };
  }) };
}
export function isOnScreen(doc, screenId, zoneId) {
  const s = (doc.screens || []).find((x) => x.id === screenId);
  return !s || s.zones.includes(zoneId);
}
export function addScreen(doc, id) {
  if (!id || (doc.screens || []).some((s) => s.id === id)) return doc;
  return { ...doc, screens: [...(doc.screens || []), { id, zones: [] }] };
}
export function removeScreen(doc, id) {
  return { ...doc, screens: (doc.screens || []).filter((s) => s.id !== id) };
}
export function ensureScreens(doc) {
  if (doc.screens && doc.screens.length) return doc;
  return { ...doc, screens: [{ id: 'home', zones: doc.zones.filter((z) => !z.hidden).map((z) => z.id) }] };
}

// Validation messages → { zoneId: [messages] } for inline badges (messages mention zone "id").
export function errorsByZone(errors) {
  const out = {};
  for (const e of errors || []) { const m = /zone "([^"]+)"/.exec(e); if (m) (out[m[1]] = out[m[1]] || []).push(e); }
  return out;
}

// Menu item action ↔ picker value ("show_page:info", "show_screen:channels", "fullscreen_tv").
export function actionValue(it) {
  if (!it || !it.action) return '';
  if (it.action === 'show_page') return `show_page:${it.page || ''}`;
  if (it.action === 'show_screen') return `show_screen:${it.screen || ''}`;
  return it.action;
}
export function parseActionValue(v) {
  if (!v) return { action: undefined, page: undefined, screen: undefined };
  const [action, arg] = v.split(':');
  if (action === 'show_page') return { action, page: arg || undefined, screen: undefined };
  if (action === 'show_screen') return { action, screen: arg || undefined, page: undefined };
  return { action, page: undefined, screen: undefined };
}
// Choices for the action picker: pages (hidden zones), screens (except the current one) and built-ins.
export function actionChoices(doc, apps = []) {
  const pages = (doc.zones || []).filter((z) => z.hidden).map((z) => ({ value: `show_page:${z.id}`, label: `Open page “${z.id}”` }));
  const screens = (doc.screens || []).slice(1).map((s) => ({ value: `show_screen:${s.id}`, label: `Go to screen “${s.id}”` }));
  const appItems = apps.map((a) => ({ value: `launch_app:${a.id}`, label: `Launch ${a.name || a.id}` }));
  return { pages, screens, apps: appItems, builtins: BUILTIN_ACTIONS };
}
