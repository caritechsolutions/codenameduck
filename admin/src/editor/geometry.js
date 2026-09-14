// Pure helpers for the canvas layout editor. Canvas units are layout pixels (1920x1080).
export const GRID = 10;
export const MIN_SIZE = 40;
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const ZONE_TYPES = ['video', 'text', 'image', 'channel_list', 'clock', 'menu', 'html', 'weather', 'app_launcher'];
export const ACTIONS = ['toggle_menu', 'fullscreen_tv', 'home', 'show_page', 'close_page', 'launch_app', 'tune', 'reload'];
export const KEY_NAMES = ['PORTAL', 'GUIDE', 'BACK', 'EXIT', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'MENU', 'INFO'];

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
    if (handle.includes('e')) w = snap(right - x + (w - (right - x))) ; // no-op guard, snapped below
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

export function zoneLabel(z) {
  switch (z.type) {
    case 'text': return (z.text || '').slice(0, 40) || 'text';
    case 'image': return (z.src || '').split('/').pop() || 'image';
    case 'clock': return z.format || 'HH:mm';
    case 'video': return 'LIVE TV';
    case 'channel_list': return 'channel list';
    case 'menu': return `menu (${(z.items || []).length})`;
    case 'app_launcher': return `apps (${(z.apps || []).length})`;
    case 'weather': return 'weather';
    case 'html': return 'html page';
    default: return z.type;
  }
}

export function nextZoneId(doc, type) {
  const ids = new Set((doc.zones || []).map((z) => z.id));
  const base = type === 'channel_list' ? 'chlist' : type === 'app_launcher' ? 'apps' : type;
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}${i}`)) i++;
  return `${base}${i}`;
}

export function newZone(doc, type) {
  const id = nextZoneId(doc, type);
  const c = doc.canvas || { w: 1920, h: 1080 };
  const base = { id, type, x: snap(c.w * 0.1), y: snap(c.h * 0.1) };
  switch (type) {
    case 'video': return { ...base, x: 640, y: 120, w: 1200, h: 675, source: 'lineup', startChannel: 'first' };
    case 'text': return { ...base, w: 800, h: 90, text: 'New text', style: { fontSize: 48, color: '#ffffff' } };
    case 'image': return { ...base, w: 320, h: 160, src: '/procentric/application/assets/logo.png', fit: 'contain' };
    case 'clock': return { ...base, w: 260, h: 70, format: 'HH:mm', style: { fontSize: 44, color: '#ffffff', align: 'right' } };
    case 'channel_list': return { ...base, w: 480, h: 560, style: { fontSize: 28, color: '#ffffff', background: 'rgba(0,0,0,0.35)', highlight: '#ffd166' } };
    case 'menu': return { ...base, w: 420, h: 300, items: [{ label: 'Live TV', action: 'fullscreen_tv' }, { label: 'Hotel info', action: 'show_page', page: 'info' }], style: { fontSize: 36, color: '#ffffff', highlight: '#ffd166' } };
    case 'html': return { ...base, w: 1200, h: 700, hidden: true, html: '<h1>Hotel information</h1><p>Breakfast 7–10 in the lobby.</p>', style: { fontSize: 32, color: '#ffffff', background: 'rgba(0,0,0,0.85)', padding: 40 } };
    case 'weather': return { ...base, w: 360, h: 120, units: 'metric', style: { fontSize: 36, color: '#ffffff' } };
    case 'app_launcher': return { ...base, w: 600, h: 200, apps: [{ label: 'Netflix', app_id: 'netflix' }, { label: 'YouTube', app_id: 'youtube.leanback.v4' }], style: { fontSize: 32, color: '#ffffff', highlight: '#ffd166' } };
    default: return { ...base, w: 300, h: 200 };
  }
}

// ---- immutable document edits
export function updateZone(doc, id, patch) {
  return { ...doc, zones: doc.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) };
}
export function renameZone(doc, id, newId) {
  if (!newId || newId === id || doc.zones.some((z) => z.id === newId)) return doc;
  return { ...doc,
    zones: doc.zones.map((z) => (z.id === id ? { ...z, id: newId } : z)),
    screens: (doc.screens || []).map((s) => ({ ...s, zones: s.zones.map((zid) => (zid === id ? newId : zid)) })) };
}
export function removeZone(doc, id) {
  return { ...doc, zones: doc.zones.filter((z) => z.id !== id), screens: (doc.screens || []).map((s) => ({ ...s, zones: s.zones.filter((zid) => zid !== id) })) };
}
export function addZone(doc, type, screenId) {
  const z = newZone(doc, type);
  const screens = (doc.screens || []).map((s) => (s.id === screenId && !z.hidden ? { ...s, zones: [...s.zones, z.id] } : s));
  return { doc: { ...doc, zones: [...doc.zones, z], screens }, zone: z };
}
export function duplicateZone(doc, id, screenId) {
  const src = doc.zones.find((z) => z.id === id);
  if (!src) return { doc };
  const copy = { ...JSON.parse(JSON.stringify(src)), id: nextZoneId(doc, src.type), x: src.x + GRID * 2, y: src.y + GRID * 2 };
  const screens = (doc.screens || []).map((s) => (s.id === screenId ? { ...s, zones: [...s.zones, copy.id] } : s));
  return { doc: { ...doc, zones: [...doc.zones, copy], screens }, zone: copy };
}
export function moveZoneOrder(doc, id, dir) { // dir: -1 back, +1 front
  const i = doc.zones.findIndex((z) => z.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.zones.length) return doc;
  const zones = doc.zones.slice(); const [z] = zones.splice(i, 1); zones.splice(j, 0, z);
  return { ...doc, zones };
}
export function toggleZoneInScreen(doc, screenId, zoneId) {
  return { ...doc, screens: (doc.screens || []).map((s) => {
    if (s.id !== screenId) return s;
    return s.zones.includes(zoneId) ? { ...s, zones: s.zones.filter((z) => z !== zoneId) } : { ...s, zones: [...s.zones, zoneId] };
  }) };
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
