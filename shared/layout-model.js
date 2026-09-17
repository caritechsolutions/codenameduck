// Layout document model v2 (Phase 3 B2b): pages instead of screens, element actions, focus
// ring. Shared by the server validator (loaded through server/src/esm.js), the renderer and the
// admin editor. No imports, ES2015-safe, pure functions only.
//
// v2 shape:
//   { schema: 2, canvas, zones: [...], pages: [{id, name, zones: [ids], inherit}], home: 'home',
//     keys: {PORTAL: {type:'fullscreen_tv'}}, focus: {color, width, radius}, back_on_home: 'none'|'fullscreen_tv' }
// A zone of type text/image/button may carry action: {type, page|number|app_id|zone}; menu items
// carry the same fields flat ({label, action: 'goto_page', page: 'info'}).
// Global zone types placed on the home page also show on pages with inherit !== false.

export var GLOBAL_TYPES = ['video', 'channel_list', 'banner', 'digits', 'popup', 'clock'];
export var PLACEMENT_TYPES = ['banner', 'digits', 'popup'];
export var ACTION_TYPES = ['none', 'goto_page', 'back', 'fullscreen_tv', 'tune', 'launch_app', 'toggle'];
export var LEGACY_ACTION_TYPES = ['reload'];           // still accepted (keys / admin commands)
export var ACTION_ZONE_TYPES = ['text', 'image', 'button'];   // focusable when they carry an action
export var NAV_ZONE_TYPES = ['menu', 'app_launcher', 'apps'];  // item-level focus
export var DEFAULT_FOCUS = { color: '#ffd166', width: 6, radius: 12 };

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function titleCase(s) { return String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

// Normalise any action spelling (v1 string, flat menu item, nested object) to
// {type, page?, number?, app_id?, zone?} or null for "none".
export function actionOf(x, homeId) {
  if (!x) return null;
  var type, arg = {};
  if (typeof x === 'string') type = x;
  else if (typeof x === 'object') {
    type = x.type || x.action;
    arg = x;
  }
  if (!type || type === 'none') return null;
  switch (type) {
    case 'show_page': return arg.page ? { type: 'goto_page', page: String(arg.page) } : null;
    case 'show_screen': return arg.screen ? { type: 'goto_page', page: String(arg.screen) } : null;
    case 'close_page': return { type: 'back' };
    case 'home': return { type: 'goto_page', page: homeId || 'home' };
    case 'toggle_menu': return { type: 'fullscreen_tv' };
    case 'goto_page': return { type: 'goto_page', page: arg.page != null ? String(arg.page) : '' };
    case 'back': case 'fullscreen_tv': case 'reload': return { type: type };
    case 'tune': return { type: 'tune', number: arg.number != null && arg.number !== '' ? Number(arg.number) : null };
    case 'launch_app': return { type: 'launch_app', app_id: arg.app_id || arg.id || '' };
    case 'toggle': return { type: 'toggle', zone: arg.zone || '' };
    default: return { type: String(type) };
  }
}
// Flat fields for a menu item: {action, page, number, app_id, zone}.
export function actionFlat(a) {
  var out = { action: undefined, page: undefined, number: undefined, app_id: undefined, zone: undefined, screen: undefined };
  if (!a) return out;
  out.action = a.type;
  if (a.type === 'goto_page') out.page = a.page;
  if (a.type === 'tune') out.number = a.number;
  if (a.type === 'launch_app') out.app_id = a.app_id;
  if (a.type === 'toggle') out.zone = a.zone;
  return out;
}
export function describeAction(a, layout) {
  a = actionOf(a);
  if (!a) return 'none';
  if (a.type === 'goto_page') { var p = pageById(layout, a.page); return 'go to page ' + (p ? '“' + (p.name || p.id) + '”' : a.page); }
  if (a.type === 'tune') return 'tune to channel ' + a.number;
  if (a.type === 'launch_app') return 'launch ' + a.app_id;
  if (a.type === 'toggle') return 'toggle zone ' + a.zone;
  if (a.type === 'back') return 'back';
  if (a.type === 'fullscreen_tv') return 'full-screen TV';
  return a.type;
}

export function pagesOf(layout) { return (layout && Array.isArray(layout.pages)) ? layout.pages : []; }
export function homePageId(layout) {
  var pages = pagesOf(layout);
  if (!pages.length) return null;
  if (layout.home && pages.some(function (p) { return p.id === layout.home; })) return layout.home;
  return pages[0].id;
}
export function pageById(layout, id) {
  var pages = pagesOf(layout);
  for (var i = 0; i < pages.length; i++) if (pages[i].id === id) return pages[i];
  return null;
}
// Zone ids a page shows: its own plus the home page's global zones when it inherits.
export function pageZoneIds(layout, pageId) {
  var page = pageById(layout, pageId) || pageById(layout, homePageId(layout));
  if (!page) return [];
  var ids = (page.zones || []).slice();
  var home = homePageId(layout);
  if (page.id !== home && page.inherit !== false) {
    var hp = pageById(layout, home);
    var byId = {}; (layout.zones || []).forEach(function (z) { byId[z.id] = z; });
    ((hp && hp.zones) || []).forEach(function (id) { var z = byId[id]; if (z && GLOBAL_TYPES.indexOf(z.type) >= 0 && ids.indexOf(id) < 0) ids.push(id); });
  }
  return ids;
}
// The zones to draw on a page, in stacking order. opts: {toggled: {id: bool}, fullscreen: bool}.
export function visibleZoneList(layout, pageId, opts) {
  layout = layout || {};
  opts = opts || {};
  var zones = layout.zones || [];
  if (opts.fullscreen) return zones.filter(function (z) { return z.type === 'video'; });
  var ids = pageZoneIds(layout, pageId);
  var on = {}; ids.forEach(function (id) { on[id] = true; });
  return zones.filter(function (z) {
    if (PLACEMENT_TYPES.indexOf(z.type) >= 0) return false;
    var shown = !!on[z.id];
    if (opts.toggled && opts.toggled[z.id]) shown = !shown;
    return shown;
  });
}
export function isFocusable(z) {
  if (!z) return false;
  if (NAV_ZONE_TYPES.indexOf(z.type) >= 0) return true;
  return ACTION_ZONE_TYPES.indexOf(z.type) >= 0 && !!actionOf(z.action);
}

// Spatial navigation: from rects[from] pick the nearest rect in `dir` ('left'|'right'|'up'|
// 'down'); -1 when nothing lies that way. from = -1 → the top-left-most rect.
export function spatialNext(rects, from, dir) {
  if (!rects || !rects.length) return -1;
  if (from < 0 || from >= rects.length) {
    var best0 = -1, s0 = Infinity;
    rects.forEach(function (r, i) { var s = r.y * 4 + r.x; if (s < s0) { s0 = s; best0 = i; } });
    return best0;
  }
  var f = rects[from];
  var fcx = f.x + f.w / 2, fcy = f.y + f.h / 2;
  var best = -1, bestScore = Infinity;
  rects.forEach(function (r, i) {
    if (i === from) return;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var primary, ortho, overlap;
    if (dir === 'right') { primary = r.x - (f.x + f.w); if (cx <= fcx) return; ortho = Math.abs(cy - fcy); overlap = Math.min(f.y + f.h, r.y + r.h) - Math.max(f.y, r.y); }
    else if (dir === 'left') { primary = f.x - (r.x + r.w); if (cx >= fcx) return; ortho = Math.abs(cy - fcy); overlap = Math.min(f.y + f.h, r.y + r.h) - Math.max(f.y, r.y); }
    else if (dir === 'down') { primary = r.y - (f.y + f.h); if (cy <= fcy) return; ortho = Math.abs(cx - fcx); overlap = Math.min(f.x + f.w, r.x + r.w) - Math.max(f.x, r.x); }
    else { primary = f.y - (r.y + r.h); if (cy >= fcy) return; ortho = Math.abs(cx - fcx); overlap = Math.min(f.x + f.w, r.x + r.w) - Math.max(f.x, r.x); }
    if (primary < 0) primary = 0;
    // overlapping candidates (same row / column) win; otherwise weight the sideways offset
    var score = primary + (overlap > 0 ? ortho * 0.3 : ortho * 2.5 + 400);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

// ---------------------------------------------------------------- v1 → v2 upgrade
export function isV2(doc) { return !!(doc && doc.schema === 2 && Array.isArray(doc.pages)); }

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'page'; }

// Convert a v1 layout (screens, hidden pages, legacy action names) to v2. v2 input is
// normalised (home, focus, keys) and returned as a copy. Never throws on junk: unknown pieces
// are dropped, the validator reports what is left.
export function upgradeLayout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  var doc = clone(input);
  var zones = Array.isArray(doc.zones) ? doc.zones.filter(function (z) { return z && typeof z === 'object'; }) : [];
  var homeId;
  if (isV2(doc)) {
    doc.pages = doc.pages.filter(function (p) { return p && typeof p === 'object' && typeof p.id === 'string'; })
      .map(function (p) { return { id: p.id, name: typeof p.name === 'string' && p.name.trim() ? p.name : titleCase(p.id), zones: Array.isArray(p.zones) ? p.zones.filter(function (x) { return typeof x === 'string'; }) : [], inherit: p.inherit !== false }; });
    if (!doc.pages.length) doc.pages = [{ id: 'home', name: 'Home', zones: zones.map(function (z) { return z.id; }), inherit: true }];
    homeId = homePageId(doc);
  } else {
    var screens = Array.isArray(doc.screens) && doc.screens.length ? doc.screens.filter(function (s) { return s && typeof s === 'object'; }) : [{ id: 'home', zones: zones.filter(function (z) { return !z.hidden; }).map(function (z) { return z.id; }) }];
    var pages = [];
    screens.forEach(function (s, i) {
      var id = typeof s.id === 'string' && s.id ? s.id : 'screen' + (i + 1);
      if (id === 'fullscreen' && i > 0) return;   // full-screen TV is an action now
      if (pages.some(function (p) { return p.id === id; })) return;
      pages.push({ id: id, name: id === 'home' || i === 0 ? 'Home' : titleCase(id), zones: Array.isArray(s.zones) ? s.zones.filter(function (x) { return typeof x === 'string'; }) : [], inherit: false });
    });
    // hidden zones were pages opened over the screen: one page each, inheriting the home globals
    zones.forEach(function (z) { if (z.hidden && !pages.some(function (p) { return p.id === z.id; })) pages.push({ id: z.id, name: titleCase(z.id), zones: [z.id], inherit: true }); });
    doc.pages = pages;
    homeId = pages[0].id;
    doc.home = homeId;
    delete doc.screens;
  }
  if (!doc.home || !pageById(doc, doc.home)) doc.home = homeId || doc.pages[0].id;
  homeId = doc.home;
  doc.zones = zones.map(function (z) {
    var c = clone(z);
    delete c.hidden;
    if (c.action !== undefined) { var a = actionOf(c.action, homeId); if (a) c.action = a; else delete c.action; }
    if (Array.isArray(c.items)) c.items = c.items.map(function (it) { var a = actionOf(it, homeId); var flat = actionFlat(a); var out = { label: it && it.label }; for (var k in flat) if (flat[k] !== undefined) out[k] = flat[k]; if (it && it.params) out.params = it.params; return out; });
    return c;
  });
  var keys = {};
  if (doc.keys && typeof doc.keys === 'object') for (var k in doc.keys) { var ka = actionOf(doc.keys[k], homeId); if (ka) keys[k] = ka; }
  doc.keys = keys;
  var f = doc.focus && typeof doc.focus === 'object' ? doc.focus : {};
  doc.focus = { color: typeof f.color === 'string' && f.color ? f.color : DEFAULT_FOCUS.color, width: Number.isFinite(Number(f.width)) && f.width !== '' && f.width != null ? Number(f.width) : DEFAULT_FOCUS.width, radius: Number.isFinite(Number(f.radius)) && f.radius !== '' && f.radius != null ? Number(f.radius) : DEFAULT_FOCUS.radius };
  doc.back_on_home = doc.back_on_home === 'fullscreen_tv' ? 'fullscreen_tv' : 'none';
  doc.schema = 2;
  return doc;
}

// Page-level validation shared by server and admin. Returns error strings (zone messages use
// the `zone "id": …` form so the editor can pin them to the zone).
export function validatePages(doc) {
  var errors = [];
  var zoneIds = {}; (doc.zones || []).forEach(function (z) { if (z && z.id) zoneIds[z.id] = z; });
  var pages = pagesOf(doc);
  if (!pages.length) { errors.push('layout needs at least one page'); return errors; }
  var seen = {};
  pages.forEach(function (p, i) {
    if (!p.id || typeof p.id !== 'string') errors.push('page ' + (i + 1) + ' needs an id');
    else if (seen[p.id]) errors.push('duplicate page id "' + p.id + '"'); else seen[p.id] = true;
    (p.zones || []).forEach(function (zid) { if (!zoneIds[zid]) errors.push('page "' + p.id + '" references unknown zone "' + zid + '"'); });
  });
  if (doc.home && !seen[doc.home]) errors.push('home page "' + doc.home + '" does not exist');
  var checkAction = function (a, where) {
    a = actionOf(a);
    if (!a) return;
    if (ACTION_TYPES.indexOf(a.type) < 0 && LEGACY_ACTION_TYPES.indexOf(a.type) < 0) { errors.push(where + ': unknown action "' + a.type + '"'); return; }
    if (a.type === 'goto_page' && !seen[a.page]) errors.push(where + ': action targets unknown page "' + a.page + '"');
    if (a.type === 'toggle' && !zoneIds[a.zone]) errors.push(where + ': action toggles unknown zone "' + a.zone + '"');
    if (a.type === 'tune' && !(a.number > 0)) errors.push(where + ': tune needs a channel number');
    if (a.type === 'launch_app' && !a.app_id) errors.push(where + ': launch_app needs an app id');
  };
  (doc.zones || []).forEach(function (z) {
    if (!z) return;
    if (z.action) checkAction(z.action, 'zone "' + z.id + '"');
    (z.items || []).forEach(function (it, i) { checkAction(it, 'zone "' + z.id + '" item ' + (i + 1)); });
  });
  for (var k in (doc.keys || {})) checkAction(doc.keys[k], 'key ' + k);
  if (doc.back_on_home && doc.back_on_home !== 'none' && doc.back_on_home !== 'fullscreen_tv') errors.push('back_on_home must be none or fullscreen_tv');
  return errors;
}
