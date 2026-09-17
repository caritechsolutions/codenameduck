// Zone drawing shared by the TV renderer (tv-app/src/main.js) and the admin's in-editor
// preview (admin/src/editor/LayoutPreview.jsx). Plain DOM, no framework, ES2015-safe (the
// tv-app bundle targets old Chromium). Styling lives in ./zones.css, which both load.
//
// A drawer gets (element, zone, ctx, env):
//   ctx  — text variables: hotel, room, guest, guest_first, checkout_date, time, date, logo…
//   env  — live data: lineup[], currentIndex, focus {zone,index}, weather, units,
//          videoRect(zone) → {x,y,w,h} (renderer: fullscreen expands it), preview (bool)

export var VARIABLES = ['hotel', 'room', 'guest', 'guest_first', 'checkout_date', 'time', 'date'];
export var PLACEMENT_TYPES = ['banner', 'digits', 'popup'];

export function substitute(text, ctx) {
  ctx = ctx || {};
  return String(text == null ? '' : text).replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, k) { return ctx[k] == null ? '' : ctx[k]; });
}
export function hasLiveVars(text) { return /\{\{\s*(time|date)\s*\}\}/.test(String(text == null ? '' : text)); }

function pad2(n) { return (n < 10 ? '0' : '') + n; }
export function formatClock(fmt, d) {
  var h24 = d.getHours(), h12 = h24 % 12 || 12;
  return (fmt || 'HH:mm')
    .replace('HH', pad2(h24)).replace('hh', pad2(h12)).replace('mm', pad2(d.getMinutes()))
    .replace('ss', pad2(d.getSeconds())).replace('a', h24 < 12 ? 'AM' : 'PM')
    .replace('DD', pad2(d.getDate())).replace('MM', pad2(d.getMonth() + 1)).replace('YYYY', d.getFullYear());
}
// ctx + the clock-driven variables for "now".
export function liveContext(ctx, now, dateFormat) {
  var d = now || new Date();
  var out = {};
  for (var k in (ctx || {})) out[k] = ctx[k];
  out.time = formatClock('HH:mm', d);
  out.date = formatClock(dateFormat || 'DD/MM/YYYY', d);
  return out;
}

// CSS font-family value from a picker value ("Open Sans" → "Open Sans", sans-serif).
export function fontFamilyCss(f) {
  if (!f) return '';
  if (/["',]/.test(f)) return f;
  return '"' + f + '", "LG Display", "LG Smart UI", Helvetica, Arial, sans-serif';
}
export var SHADOWS = { none: '', soft: '0 2px 8px rgba(0,0,0,0.55)', strong: '0 3px 14px rgba(0,0,0,0.9)', outline: '0 0 4px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)' };

export function applyStyle(el, st) {
  st = st || {};
  if (st.fontSize) el.style.fontSize = st.fontSize + 'px';
  if (st.color) el.style.color = st.color;
  if (st.background) el.style.background = st.background;
  if (st.fontWeight) el.style.fontWeight = st.fontWeight;
  if (st.fontStyle) el.style.fontStyle = st.fontStyle;
  if (st.fontFamily) el.style.fontFamily = fontFamilyCss(st.fontFamily);
  if (st.align) el.style.textAlign = st.align;
  if (st.valign) el.style.justifyContent = st.valign === 'middle' ? 'center' : st.valign === 'bottom' ? 'flex-end' : 'flex-start';
  if (st.padding != null) el.style.padding = st.padding + 'px';
  if (st.borderRadius != null) el.style.borderRadius = st.borderRadius + 'px';
  if (st.letterSpacing != null) el.style.letterSpacing = st.letterSpacing + 'px';
  if (st.opacity != null) el.style.opacity = st.opacity;
  if (st.lineHeight != null) el.style.lineHeight = st.lineHeight;
  if (st.border) el.style.border = st.border;
  if (st.shadow) { var s = SHADOWS[st.shadow] !== undefined ? SHADOWS[st.shadow] : st.shadow; if (s) el.style.textShadow = s; }
  if (st.boxShadow) el.style.boxShadow = st.boxShadow;
}

export function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }

// ---------------------------------------------------------------- per-type drawers
export function drawText(e, z, ctx) {
  e.textContent = substitute(z.text, ctx);
  if (hasLiveVars(z.text)) e.setAttribute('data-live-text', '1');
  if (z.style && z.style.valign) e.classList.add('zone-flex');
}
export function drawImage(e, z, ctx) {
  var src = substitute(z.src || '', ctx);
  if (!src) { if (ctx && ctx.__preview) e.appendChild(el('div', 'zone-placeholder', 'image')); return; }
  var img = document.createElement('img'); img.src = src; img.alt = ''; if (z.fit) img.style.objectFit = z.fit; e.appendChild(img);
}
export function drawClock(e, z, ctx) {
  e.setAttribute('data-clock', z.format || 'HH:mm');
  e.textContent = formatClock(z.format, (ctx && ctx.__now) || new Date());
}
export function drawVideo(e, z, ctx, env) {
  var r = env && env.videoRect ? env.videoRect(z) : { x: z.x, y: z.y, w: z.w, h: z.h };
  e.style.left = r.x + 'px'; e.style.top = r.y + 'px'; e.style.width = r.w + 'px'; e.style.height = r.h + 'px';
  e.style.background = 'transparent';
  e.setAttribute('data-video', '1');
  if (env && env.preview) e.appendChild(el('div', 'zone-video-placeholder', 'LIVE TV'));
}
function drawHiddenPlacement(e) { e.style.display = 'none'; }   // banner/digits/popup only place the OSD
export function drawChannelList(e, z, ctx, env) {
  e.setAttribute('data-chlist', '1');
  clear(e);
  var st = z.style || {};
  var lineup = (env && env.lineup) || [];
  var list = el('div', 'chlist');
  var rowH = (st.fontSize || 28) * 1.6;
  var visible = Math.max(1, Math.floor(z.h / rowH));
  var cur = env && env.currentIndex != null ? env.currentIndex : -1;
  var start = Math.max(0, Math.min(cur - Math.floor(visible / 2), lineup.length - visible));
  lineup.slice(start, start + visible).forEach(function (ch, i) {
    var row = el('div', 'chrow' + (start + i === cur ? ' current' : ''));
    row.style.height = rowH + 'px'; row.style.lineHeight = rowH + 'px';
    if (start + i === cur && st.highlight) { row.style.background = st.highlight; row.style.color = st.highlightText || '#1a1a1a'; }
    row.appendChild(el('span', 'chnum', String(ch.number)));
    if (ch.logo_url) { var img = document.createElement('img'); img.src = ch.logo_url; img.alt = ''; img.className = 'chlogo'; row.appendChild(img); }
    row.appendChild(el('span', 'chname', ch.name));
    list.appendChild(row);
  });
  if (!lineup.length) list.appendChild(el('div', 'chrow muted', 'No channels assigned'));
  e.appendChild(list);
}
export function menuItemsOf(z) {
  return z.type === 'app_launcher' ? (z.apps || []).map(function (a) { return { label: a.label, action: 'launch_app', app_id: a.app_id }; }) : (z.items || []);
}
export function drawMenu(e, z, ctx, env) {
  e.setAttribute('data-menu', '1');
  clear(e);
  var items = menuItemsOf(z);
  var focus = (env && env.focus) || {};
  var focused = focus.zone === z.id ? focus.index : -1;
  if (z.layout === 'row') e.classList.add('menu-row');
  items.forEach(function (it, i) {
    var row = el('div', 'menuitem' + (i === focused ? ' focused' : ''), substitute(it.label || it.action, ctx));
    if (i === focused && z.style && z.style.highlight) { row.style.background = z.style.highlight; row.style.color = z.style.highlightText || '#1a1a1a'; }
    e.appendChild(row);
  });
  if (!items.length && env && env.preview) e.appendChild(el('div', 'zone-placeholder', 'menu (no items)'));
}
export function drawHtml(e, z, ctx) { e.innerHTML = substitute(z.html || '', ctx); }
export function drawWeather(e, z, ctx, env) {
  e.setAttribute('data-weather', '1');
  clear(e);
  var w = env && env.weather;
  var st = z.style || {};
  if (!w || !w.ok) { e.appendChild(el('span', 'wx-na', w && w.reason ? '' : '…')); return; }
  var imperial = (z.units || (env && env.units)) === 'imperial';
  var wrap = el('div', 'wx');
  wrap.appendChild(el('span', 'wx-icon', w.icon || ''));
  wrap.appendChild(el('span', 'wx-temp', (imperial ? w.temp_f + '°F' : w.temp_c + '°C')));
  if (z.showText !== false) wrap.appendChild(el('span', 'wx-text', w.text || ''));
  if (st.align === 'right') wrap.style.justifyContent = 'flex-end';
  if (st.align === 'center') wrap.style.justifyContent = 'center';
  e.appendChild(wrap);
}

// Enabled apps (server: enabled per group) as remote-navigable tiles. env.apps = [{id,name,icon}];
// focus like a menu (env.focus.zone === z.id). Tiles without an icon show the name's initial.
export function appItemsOf(z, env) {
  return ((env && env.apps) || []).map(function (a) { return { label: a.name || a.id, action: 'launch_app', app_id: a.id, icon: a.icon || null }; });
}
export function drawApps(e, z, ctx, env) {
  e.setAttribute('data-menu', '1');
  e.setAttribute('data-apps', '1');
  clear(e);
  var items = appItemsOf(z, env);
  var st = z.style || {};
  var focus = (env && env.focus) || {};
  var focused = focus.zone === z.id ? focus.index : -1;
  e.classList.add(z.layout === 'grid' ? 'apps-grid' : 'apps-row');
  var tile = st.tileSize || (z.layout === 'grid' ? 220 : 200);
  items.forEach(function (it, i) {
    var t = el('div', 'apptile' + (i === focused ? ' focused' : ''));
    t.style.width = tile + 'px'; t.style.height = Math.round(tile * 0.75) + 'px';
    if (i === focused && st.highlight) { t.style.boxShadow = '0 0 0 6px ' + st.highlight; }
    var ic = el('div', 'appicon');
    if (it.icon) { var img = document.createElement('img'); img.src = substitute(it.icon, ctx); img.alt = ''; ic.appendChild(img); }
    else ic.appendChild(el('span', 'appinitial', String(it.label || '?').charAt(0).toUpperCase()));
    t.appendChild(ic);
    t.appendChild(el('div', 'appname', it.label));
    e.appendChild(t);
  });
  if (!items.length) e.appendChild(el('div', 'zone-placeholder', env && env.preview ? 'apps (enable some for the group)' : ''));
}

export var DRAWERS = {
  text: drawText,
  image: drawImage,
  clock: drawClock,
  video: drawVideo,
  banner: drawHiddenPlacement,
  digits: drawHiddenPlacement,
  popup: drawHiddenPlacement,
  channel_list: drawChannelList,
  menu: drawMenu,
  html: drawHtml,
  weather: drawWeather,
  app_launcher: drawMenu,
  apps: drawApps
};

// The zones a screen shows, in stacking order. openPage = id of a hidden zone opened by a
// menu action (drawn on top of the screen).
export function visibleZones(layout, screenId, openPage) {
  layout = layout || {};
  var screens = layout.screens || [];
  var scr = null;
  for (var i = 0; i < screens.length; i++) if (screens[i].id === screenId) scr = screens[i];
  if (!scr && screens.length) scr = screens[0];
  var vis = null;
  if (scr) { vis = {}; (scr.zones || []).forEach(function (id) { vis[id] = true; }); }
  return (layout.zones || []).filter(function (z) {
    if (PLACEMENT_TYPES.indexOf(z.type) >= 0) return false;
    if (z.hidden && openPage !== z.id) return false;
    if (vis && !vis[z.id] && openPage !== z.id) return false;
    return true;
  });
}

// One positioned, styled, drawn .zone element (or null for an unknown type).
export function zoneElement(z, ctx, env) {
  var fn = DRAWERS[z.type];
  if (!fn) return null;
  var e = el('div', 'zone zone-' + z.type);
  e.id = 'zone-' + z.id;
  e.setAttribute('data-zone-id', z.id);
  e.style.left = (z.x || 0) + 'px'; e.style.top = (z.y || 0) + 'px';
  e.style.width = (z.w || 0) + 'px'; e.style.height = (z.h || 0) + 'px';
  applyStyle(e, z.style);
  fn(e, z, ctx, env);
  return e;
}

// Draw a whole screen into `stage` (removes previous .zone children). Returns the zone types
// it could not draw.
export function renderStage(stage, layout, ctx, env, screenId, openPage) {
  layout = layout || {};
  var canvas = layout.canvas || {};
  stage.style.background = canvas.background || '#000';
  stage.style.backgroundImage = canvas.backgroundImage ? 'url(' + canvas.backgroundImage + ')' : 'none';
  Array.prototype.slice.call(stage.querySelectorAll('.zone')).forEach(function (n) { stage.removeChild(n); });
  var skipped = [];
  visibleZones(layout, screenId, openPage).forEach(function (z) {
    var e = zoneElement(z, ctx, env);
    if (!e) { skipped.push(z.type); return; }
    stage.appendChild(e);
  });
  return skipped;
}

// Refresh clocks and {{time}}/{{date}} texts without a full redraw.
export function tick(stage, layout, ctx, now) {
  var d = now || new Date();
  var clocks = stage.querySelectorAll('[data-clock]');
  for (var i = 0; i < clocks.length; i++) clocks[i].textContent = formatClock(clocks[i].getAttribute('data-clock'), d);
  var live = stage.querySelectorAll('[data-live-text]');
  if (!live.length) return;
  var lctx = liveContext(ctx, d);
  for (var j = 0; j < live.length; j++) {
    var id = live[j].getAttribute('data-zone-id');
    var z = ((layout && layout.zones) || []).filter(function (x) { return x.id === id; })[0];
    if (z) live[j].textContent = substitute(z.text, lctx);
  }
}
