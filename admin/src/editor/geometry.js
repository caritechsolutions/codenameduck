// Pure helpers for the canvas layout editor. Canvas units are layout pixels (1920x1080).
import SHARED_ZONE_TYPES from '../../../shared/zone-types.json';
import FONTS_JSON from '../../../shared/fonts.json';
import { VARIABLES as SHARED_VARIABLES } from '../../../shared/zone-draw.js';
import { upgradeLayout, actionOf, actionFlat, pageZoneIds, homePageId, pageById, GLOBAL_TYPES, ACTION_TYPES } from '../../../shared/layout-model.js';
export { upgradeLayout, actionOf, actionFlat, pageZoneIds, homePageId, pageById, GLOBAL_TYPES };

export const GRID = 8;
export const MIN_SIZE = 40;
export const GUIDE_THRESHOLD = 6;     // canvas px within which an edge snaps to a guide
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const ZONE_TYPES = SHARED_ZONE_TYPES;   // shared/zone-types.json
export const PLACEMENT_TYPES = ['banner', 'digits', 'popup'];   // position/style of the renderer's OSD elements
export const ACTIONS = ACTION_TYPES;   // none, goto_page, back, fullscreen_tv, tune, launch_app, toggle
export const BUILTIN_ACTIONS = [
  { value: 'back', label: 'Back (previous page)' },
  { value: 'fullscreen_tv', label: 'Full-screen TV (toggle)' },
  { value: 'tune', label: 'Tune to channel…' },
  { value: 'launch_app', label: 'Launch app…' },
  { value: 'toggle', label: 'Show / hide a zone…' },
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
  { group: 'Menu & buttons', items: [['button', 'Button'], ['menu', 'Menu'], ['apps', 'Apps (tiles)'], ['app_launcher', 'App launcher (fixed ids)']] },
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
    case 'html': return 'html';
    case 'button': return (z.label || 'button');
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
    case 'button': z = { ...base, w: 360, h: 90, label: 'Button', action: { type: 'fullscreen_tv' }, style: { fontSize: 32, color: '#ffffff', background: 'rgba(255,255,255,0.14)', borderRadius: 14 }, focusStyle: { background: '#ffd166', color: '#1a1a1a' } }; break;
    case 'html': z = { ...base, w: 1200, h: 700, html: '<h1>Hotel information</h1><p>Breakfast 7–10 in the lobby.</p>', style: { fontSize: 32, color: '#ffffff', background: 'rgba(0,0,0,0.85)', padding: 40 } }; break;
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
  const fixAction = (a) => (a && a.type === 'toggle' && a.zone === id ? { ...a, zone: newId } : a);
  return { ...doc,
    zones: doc.zones.map((z) => ({ ...z, id: z.id === id ? newId : z.id, action: z.action ? fixAction(z.action) : z.action, items: z.items ? z.items.map((it) => (it.zone === id ? { ...it, zone: newId } : it)) : z.items })),
    pages: pagesOf(doc).map((p) => ({ ...p, zones: p.zones.map((zid) => (zid === id ? newId : zid)) })) };
}
export function removeZone(doc, idOrIds) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  return { ...doc, zones: doc.zones.filter((z) => !ids.includes(z.id)), pages: pagesOf(doc).map((p) => ({ ...p, zones: p.zones.filter((zid) => !ids.includes(zid)) })) };
}
export function addZone(doc, type, pageId, at) {
  const z = newZone(doc, type, at);
  const placement = PLACEMENT_TYPES.includes(type);   // overlays are global, not per page
  const pages = pagesOf(doc).map((p) => (p.id === pageId && !placement ? { ...p, zones: [...p.zones, z.id] } : p));
  return { doc: { ...doc, zones: [...doc.zones, z], pages }, zone: z };
}
export function duplicateZone(doc, idOrIds, pageId) {
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  let out = doc; const zones = [];
  for (const id of ids) {
    const src = out.zones.find((z) => z.id === id);
    if (!src) continue;
    const copy = { ...JSON.parse(JSON.stringify(src)), id: nextZoneId(out, src.type), x: src.x + GRID * 2, y: src.y + GRID * 2, locked: undefined };
    const pages = pagesOf(out).map((p) => (p.id === pageId && !PLACEMENT_TYPES.includes(src.type) ? { ...p, zones: [...p.zones, copy.id] } : p));
    out = { ...out, zones: [...out.zones, copy], pages };
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

// ---- pages
export const pagesOf = (doc) => (doc && Array.isArray(doc.pages) ? doc.pages : []);
export function isOnPage(doc, pageId, zoneId) {   // explicitly listed (not inherited)
  const p = pageById(doc, pageId);
  return !!p && p.zones.includes(zoneId);
}
export function isInheritedOnPage(doc, pageId, zoneId) {
  return !isOnPage(doc, pageId, zoneId) && pageZoneIds(doc, pageId).includes(zoneId);
}
export function toggleZoneInPage(doc, pageId, zoneId) {
  return { ...doc, pages: pagesOf(doc).map((p) => {
    if (p.id !== pageId) return p;
    return p.zones.includes(zoneId) ? { ...p, zones: p.zones.filter((z) => z !== zoneId) } : { ...p, zones: [...p.zones, zoneId] };
  }) };
}
export function pageSlug(name, doc) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
  const ids = new Set(pagesOf(doc).map((p) => p.id));
  if (!ids.has(base)) return base;
  let i = 2; while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
export function addPage(doc, name) {
  const n = String(name || '').trim() || 'New page';
  const page = { id: pageSlug(n, doc), name: n, zones: [], inherit: true };
  return { doc: { ...doc, pages: [...pagesOf(doc), page] }, page };
}
export function renamePage(doc, id, name) {
  const n = String(name || '').trim();
  if (!n) return doc;
  return { ...doc, pages: pagesOf(doc).map((p) => (p.id === id ? { ...p, name: n } : p)) };
}
export function setPageInherit(doc, id, inherit) {
  return { ...doc, pages: pagesOf(doc).map((p) => (p.id === id ? { ...p, inherit: !!inherit } : p)) };
}
export function setHomePage(doc, id) {
  if (!pageById(doc, id)) return doc;
  return { ...doc, home: id };
}
export function movePage(doc, id, toIndex) {
  const pages = pagesOf(doc).slice();
  const i = pages.findIndex((p) => p.id === id);
  if (i < 0 || toIndex < 0 || toIndex >= pages.length || toIndex === i) return doc;
  const [p] = pages.splice(i, 1); pages.splice(toIndex, 0, p);
  return { ...doc, pages };
}
// Deleting a page removes the zones only it used (global zones stay: they belong to home).
export function removePage(doc, id) {
  const pages = pagesOf(doc);
  if (pages.length < 2 || id === homePageId(doc)) return doc;
  const page = pageById(doc, id);
  const rest = pages.filter((p) => p.id !== id);
  const usedElsewhere = new Set(rest.flatMap((p) => p.zones));
  const orphan = new Set(((page && page.zones) || []).filter((zid) => !usedElsewhere.has(zid) && !GLOBAL_TYPES.includes((doc.zones.find((z) => z.id === zid) || {}).type)));
  const zones = doc.zones.filter((z) => !orphan.has(z.id)).map((z) => (z.action && z.action.type === 'goto_page' && z.action.page === id ? { ...z, action: undefined } : z));
  return { ...doc, pages: rest, zones, home: doc.home === id ? rest[0].id : doc.home };
}
// Duplicate: global zones stay shared, everything else is deep-copied with new ids.
export function duplicatePage(doc, id) {
  const page = pageById(doc, id);
  if (!page) return { doc };
  let out = doc;
  const copyIds = [];
  for (const zid of page.zones) {
    const z = out.zones.find((x) => x.id === zid);
    if (!z) continue;
    if (GLOBAL_TYPES.includes(z.type)) { copyIds.push(zid); continue; }
    const copy = { ...JSON.parse(JSON.stringify(z)), id: nextZoneId(out, z.type) };
    out = { ...out, zones: [...out.zones, copy] };
    copyIds.push(copy.id);
  }
  const np = { id: pageSlug(page.name + ' copy', out), name: page.name + ' copy', zones: copyIds, inherit: page.inherit !== false };
  const pages = pagesOf(out).slice(); pages.splice(pages.findIndex((p) => p.id === id) + 1, 0, np);
  return { doc: { ...out, pages }, page: np };
}
export function ensurePages(doc) { return upgradeLayout(doc); }

// Validation messages → { zoneId: [messages] } for inline badges (messages mention zone "id").
export function errorsByZone(errors) {
  const out = {};
  for (const e of errors || []) { const m = /zone "([^"]+)"/.exec(e); if (m) (out[m[1]] = out[m[1]] || []).push(e); }
  return out;
}

// Action ↔ picker value ("goto_page:info", "fullscreen_tv", "" = none). Works for a zone's
// nested action object and for a flat menu item.
export function actionValue(x) {
  const a = actionOf(x);
  if (!a) return '';
  if (a.type === 'goto_page') return `goto_page:${a.page || ''}`;
  return a.type;
}
export function parseActionValue(v, prev) {
  if (!v) return null;
  const [type, arg] = v.split(':');
  const p = actionOf(prev) || {};
  if (type === 'goto_page') return { type, page: arg || '' };
  if (type === 'tune') return { type, number: p.type === 'tune' ? p.number : null };
  if (type === 'launch_app') return { type, app_id: p.type === 'launch_app' ? p.app_id : '' };
  if (type === 'toggle') return { type, zone: p.type === 'toggle' ? p.zone : '' };
  return { type };
}
// Choices for the action picker: this layout's pages, then built-ins.
export function actionChoices(doc, apps = []) {
  const pages = pagesOf(doc).map((p) => ({ value: `goto_page:${p.id}`, label: `Go to page “${p.name || p.id}”` }));
  const appItems = apps.map((a) => ({ value: `launch_app:${a.id}`, label: `Launch ${a.name || a.id}` }));
  return { pages, apps: appItems, builtins: BUILTIN_ACTIONS };
}
