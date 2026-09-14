// CoopCentric TV renderer.
// Boot: detect platform → read set properties → POST /api/tv/register on our own hostname →
// draw the layout → WebSocket for live pushes (poll fallback) → remote keys drive the lineup.
// Video placement, tuning, key claiming follow LG's sample apps via ./platform.js.
/* global __APP_VERSION__ */
import * as tv from './platform.js';
import { KEY, KEY_NAME } from './platform.js';

var APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
var PROPERTY_KEYS = ['serial_number', 'model_name', 'platform_version', 'firmware_version', 'webos_version', 'idpn', 'room_number'];
var REGISTER_RETRY_MS = [5000, 10000, 20000, 30000];
var CLAIMED_KEYS = ['CH_UP', 'CH_DOWN', 'NUM_0', 'NUM_1', 'NUM_2', 'NUM_3', 'NUM_4', 'NUM_5', 'NUM_6', 'NUM_7', 'NUM_8', 'NUM_9', 'PORTAL', 'GUIDE', 'INFO', 'BACK', 'LAST_CH'];
var BANNER_MS = 3500;
var DIGIT_TIMEOUT_MS = 2500;

var stage = document.getElementById('stage');
var statusEl = document.getElementById('status');
var overlayEl = document.getElementById('overlay');
var state = {
  api: null, props: {}, setId: null, token: null, context: {}, layout: null, layoutJson: null,
  screen: null, screenStack: [], lineup: [], channel: null, lastChannel: null, tuning: null, videoRect: null,
  osd: null, scale: 1, offset: { x: 0, y: 0 }, digits: '', digitTimer: null, focus: { zone: null, index: 0 },
  pollInterval: 60, pollTimer: null, clockTimer: null, ws: null, wsUrl: null, wsBackoff: 0, wsTimer: null, hbTimer: null,
  bootTime: Date.now(), volume: null, muted: null, powerMode: null, messages: [], bannerTimer: null, messageTimer: null
};

// ---------------------------------------------------------------- logging
function log(msg) {
  try { console.log('[coopcentric] ' + msg); } catch (e) {}
  window.__lastLog = msg;
  statusEl.textContent = (statusEl.textContent + '\n' + msg).split('\n').slice(-6).join('\n');
}
function showStatus(on) { statusEl.className = on ? 'show' : ''; }

// ---------------------------------------------------------------- HTTP
function request(method, url, body) {
  return new Promise(function (resolve, reject) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.timeout = 15000;
    xhr.setRequestHeader('Accept', 'application/json');
    if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error('HTTP ' + xhr.status + (data && data.error ? ' ' + data.error : '')));
    };
    xhr.onerror = function () { reject(new Error('network error')); };
    xhr.ontimeout = function () { reject(new Error('request timeout')); };
    xhr.send(body === undefined ? null : JSON.stringify(body));
  });
}
function authQs() { return '?set_id=' + encodeURIComponent(state.setId) + '&token=' + encodeURIComponent(state.token); }
function register() {
  var body = { api: state.api, app_version: APP_VERSION };
  PROPERTY_KEYS.forEach(function (k) { body[k] = state.props[k]; });
  return request('POST', '/api/tv/register', body);
}
function poll() { return request('GET', '/api/tv/poll' + authQs()); }

// ---------------------------------------------------------------- stage geometry
function fitStage(canvas) {
  var w = (canvas && canvas.w) || 1920, h = (canvas && canvas.h) || 1080;
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  var s = Math.min(window.innerWidth / w, window.innerHeight / h) || 1;
  state.scale = s;
  state.offset = { x: Math.floor((window.innerWidth - w * s) / 2), y: Math.floor((window.innerHeight - h * s) / 2) };
  stage.style.transform = 'scale(' + s + ')';
  stage.style.left = state.offset.x + 'px';
  stage.style.top = state.offset.y + 'px';
}
// Canvas rect → OSD pixels (display_resolution), which is what video/size/set wants.
function toOsdRect(z) {
  var osdW = (state.osd && state.osd.w) || window.innerWidth, osdH = (state.osd && state.osd.h) || window.innerHeight;
  var kx = osdW / window.innerWidth, ky = osdH / window.innerHeight;
  return { x: (state.offset.x + z.x * state.scale) * kx, y: (state.offset.y + z.y * state.scale) * ky, width: z.w * state.scale * kx, height: z.h * state.scale * ky };
}

// ---------------------------------------------------------------- rendering helpers
function substitute(text, ctx) {
  return String(text == null ? '' : text).replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, k) { return ctx[k] == null ? '' : ctx[k]; });
}
function applyStyle(el, st) {
  st = st || {};
  if (st.fontSize) el.style.fontSize = st.fontSize + 'px';
  if (st.color) el.style.color = st.color;
  if (st.background) el.style.background = st.background;
  if (st.fontWeight) el.style.fontWeight = st.fontWeight;
  if (st.fontFamily) el.style.fontFamily = st.fontFamily;
  if (st.align) el.style.textAlign = st.align;
  if (st.padding != null) el.style.padding = st.padding + 'px';
  if (st.borderRadius != null) el.style.borderRadius = st.borderRadius + 'px';
  if (st.letterSpacing != null) el.style.letterSpacing = st.letterSpacing + 'px';
  if (st.opacity != null) el.style.opacity = st.opacity;
  if (st.lineHeight != null) el.style.lineHeight = st.lineHeight;
  if (st.border) el.style.border = st.border;
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function formatClock(fmt, d) {
  var h24 = d.getHours(), h12 = h24 % 12 || 12;
  return (fmt || 'HH:mm')
    .replace('HH', pad2(h24)).replace('hh', pad2(h12)).replace('mm', pad2(d.getMinutes()))
    .replace('ss', pad2(d.getSeconds())).replace('a', h24 < 12 ? 'AM' : 'PM')
    .replace('DD', pad2(d.getDate())).replace('MM', pad2(d.getMonth() + 1)).replace('YYYY', d.getFullYear());
}
function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

var RENDERERS = {
  text: function (e, z, ctx) { e.textContent = substitute(z.text, ctx); },
  image: function (e, z) { var img = document.createElement('img'); img.src = z.src || ''; img.alt = ''; if (z.fit) img.style.objectFit = z.fit; e.appendChild(img); },
  clock: function (e, z) { e.setAttribute('data-clock', z.format || 'HH:mm'); e.textContent = formatClock(z.format, new Date()); },
  video: function (e, z) {
    // The TV video plane shows through this transparent "hole" (LG: background-image url('TV:')).
    e.style.backgroundImage = "url('TV:')";
    e.style.background = "url('TV:')";
    e.setAttribute('data-video', '1');
  },
  channel_list: function (e, z) { e.setAttribute('data-chlist', '1'); renderChannelList(e, z); },
  menu: function (e, z) { e.setAttribute('data-menu', '1'); renderMenu(e, z); },
  html: function (e, z) { e.innerHTML = z.html || ''; },
  weather: function (e, z) { e.textContent = ''; e.className += ' pending'; },      // step 5
  app_launcher: function (e, z) { renderMenu(e, { items: (z.apps || []).map(function (a) { return { label: a.label, action: 'launch_app', app_id: a.app_id }; }), style: z.style }); e.setAttribute('data-menu', '1'); }
};

function renderChannelList(e, z) {
  while (e.firstChild) e.removeChild(e.firstChild);
  var st = z.style || {};
  var list = el('div', 'chlist');
  var rowH = (st.fontSize || 28) * 1.6;
  var visible = Math.max(1, Math.floor(z.h / rowH));
  var cur = currentIndex();
  var start = Math.max(0, Math.min(cur - Math.floor(visible / 2), state.lineup.length - visible));
  state.lineup.slice(start, start + visible).forEach(function (ch, i) {
    var row = el('div', 'chrow' + (start + i === cur ? ' current' : ''));
    row.style.height = rowH + 'px'; row.style.lineHeight = rowH + 'px';
    if (start + i === cur && st.highlight) { row.style.background = st.highlight; row.style.color = st.highlightText || '#1a1a1a'; }
    row.appendChild(el('span', 'chnum', String(ch.number)));
    if (ch.logo_url) { var img = document.createElement('img'); img.src = ch.logo_url; img.alt = ''; img.className = 'chlogo'; row.appendChild(img); }
    row.appendChild(el('span', 'chname', ch.name));
    list.appendChild(row);
  });
  if (!state.lineup.length) list.appendChild(el('div', 'chrow muted', 'No channels assigned'));
  e.appendChild(list);
}
function renderMenu(e, z) {
  while (e.firstChild) e.removeChild(e.firstChild);
  var items = z.items || [];
  var focused = state.focus.zone === z.id ? state.focus.index : -1;
  items.forEach(function (it, i) {
    var row = el('div', 'menuitem' + (i === focused ? ' focused' : ''), it.label || it.action);
    if (i === focused && z.style && z.style.highlight) { row.style.background = z.style.highlight; row.style.color = z.style.highlightText || '#1a1a1a'; }
    e.appendChild(row);
  });
}
function tickClocks() {
  var els = stage.querySelectorAll('[data-clock]');
  var now = new Date();
  for (var i = 0; i < els.length; i++) els[i].textContent = formatClock(els[i].getAttribute('data-clock'), now);
}

function currentScreen() {
  var l = state.layout || {};
  var screens = l.screens || [];
  if (!screens.length) return null;
  for (var i = 0; i < screens.length; i++) if (screens[i].id === state.screen) return screens[i];
  return screens[0];
}
function visibleZoneIds() {
  var scr = currentScreen();
  if (!scr) return null;
  var m = {}; (scr.zones || []).forEach(function (id) { m[id] = true; });
  return m;
}

function render() {
  var layout = state.layout || {};
  var canvas = layout.canvas || {};
  fitStage(canvas);
  stage.style.background = canvas.background || '#000';
  stage.style.backgroundImage = canvas.backgroundImage ? 'url(' + canvas.backgroundImage + ')' : 'none';
  while (stage.firstChild) stage.removeChild(stage.firstChild);
  var visible = visibleZoneIds();
  var skipped = [];
  var videoZone = null;
  (layout.zones || []).forEach(function (z) {
    if (z.hidden && !(state.openPage === z.id)) return;
    if (visible && !visible[z.id] && state.openPage !== z.id) return;
    var fn = RENDERERS[z.type];
    if (!fn) { skipped.push(z.type); return; }
    var e = el('div', 'zone zone-' + z.type);
    e.id = 'zone-' + z.id;
    e.style.left = (z.x || 0) + 'px'; e.style.top = (z.y || 0) + 'px';
    e.style.width = (z.w || 0) + 'px'; e.style.height = (z.h || 0) + 'px';
    applyStyle(e, z.style);
    fn(e, z, state.context);
    stage.appendChild(e);
    if (z.type === 'video') videoZone = z;
  });
  if (skipped.length) log('zone types not supported: ' + skipped.join(', '));
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClocks, 1000);
  placeVideo(videoZone);
}

// Video: make sure the tuner shows what the layout wants, where it wants it.
function placeVideo(z) {
  if (!z) {
    if (state.videoRect) { state.videoRect = null; if (state.api) tv.stopVideo(); state.channel = null; }
    return;
  }
  var rect = toOsdRect(z);
  var key = JSON.stringify(rect);
  var moved = state.videoRect !== key;
  state.videoRect = key;
  if (!state.api) return;
  if (!state.channel) { tuneStart(z); return; }
  if (moved) tv.setVideoSize(rect).then(null, function (e) { log('video/size/set failed: ' + e.message); });
}
function tuneStart(z) {
  if (!state.lineup.length) { log('video zone but lineup is empty'); return; }
  var target = null;
  var want = z && z.startChannel;
  if (want === 'last' && state.lastChannel) target = findChannel(state.lastChannel);
  else if (typeof want === 'number' || /^\d+$/.test(String(want || ''))) target = findChannel(Number(want));
  if (!target) target = state.lineup[0];
  tuneTo(target);
}
function findChannel(number) {
  for (var i = 0; i < state.lineup.length; i++) if (state.lineup[i].number === Number(number)) return state.lineup[i];
  return null;
}
function currentIndex() {
  if (!state.channel) return -1;
  for (var i = 0; i < state.lineup.length; i++) if (state.lineup[i].id === state.channel.id) return i;
  return -1;
}
function tuneTo(ch) {
  if (!ch) return Promise.resolve(false);
  state.channel = ch;
  state.lastChannel = ch.number;
  try { localStorage.setItem('cc_last_channel', String(ch.number)); } catch (e) {}
  refreshChannelList();
  banner(ch.number + '  ' + ch.name);
  if (!state.api) return Promise.resolve(true);
  var token = state.tuning = {};
  return tv.tune(ch).then(function () {
    if (state.tuning !== token) return false;
    log('tuned ' + ch.number + ' ' + ch.name);
    var rect = state.videoRect ? JSON.parse(state.videoRect) : null;
    if (rect) tv.setVideoSize(rect).then(null, function (e) { log('video/size/set failed: ' + e.message); });
    sendEvent('channel', { number: ch.number, id: ch.id });
    if (state.ws && state.ws.readyState === 1) sendHeartbeat(state.ws);   // admin sees the new channel at once
    return true;
  }, function (e) {
    log('tune ' + ch.number + ' failed: ' + e.message);
    banner(ch.number + '  ' + ch.name + ' — no signal');
    sendEvent('tune_error', { number: ch.number, error: e.message });
    return false;
  });
}
function step(delta) {
  if (!state.lineup.length) return;
  var i = currentIndex();
  var n = i < 0 ? 0 : (i + delta + state.lineup.length) % state.lineup.length;
  tuneTo(state.lineup[n]);
}
function refreshChannelList() {
  var layout = state.layout || {};
  var els = stage.querySelectorAll('[data-chlist]');
  for (var i = 0; i < els.length; i++) {
    var id = els[i].id.replace('zone-', '');
    var z = (layout.zones || []).filter(function (x) { return x.id === id; })[0];
    if (z) renderChannelList(els[i], z);
  }
}

// ---------------------------------------------------------------- overlays (banner, digits, message)
function banner(text, ms) {
  var b = overlayEl.querySelector('.banner');
  b.textContent = text; b.className = 'banner show';
  if (state.bannerTimer) clearTimeout(state.bannerTimer);
  state.bannerTimer = setTimeout(function () { b.className = 'banner'; }, ms || BANNER_MS);
}
function showMessage(text, ttlS) {
  var m = overlayEl.querySelector('.message');
  m.textContent = text; m.className = 'message show';
  if (state.messageTimer) clearTimeout(state.messageTimer);
  if (ttlS !== 0) state.messageTimer = setTimeout(function () { m.className = 'message'; }, (ttlS || 20) * 1000);
}
function hideMessage() { overlayEl.querySelector('.message').className = 'message'; }
function digitsDisplay() {
  var d = overlayEl.querySelector('.digits');
  d.textContent = state.digits; d.className = 'digits' + (state.digits ? ' show' : '');
}
function pressDigit(n) {
  state.digits = (state.digits + n).slice(-4);
  digitsDisplay();
  if (state.digitTimer) clearTimeout(state.digitTimer);
  state.digitTimer = setTimeout(commitDigits, DIGIT_TIMEOUT_MS);
}
function commitDigits() {
  if (state.digitTimer) { clearTimeout(state.digitTimer); state.digitTimer = null; }
  if (!state.digits) return;
  var n = Number(state.digits);
  state.digits = ''; digitsDisplay();
  var ch = findChannel(n);
  if (ch) tuneTo(ch); else banner(n + '  — no such channel');
}

// ---------------------------------------------------------------- screens / actions
function showScreen(id, push) {
  var scr = (state.layout && state.layout.screens || []).filter(function (s) { return s.id === id; })[0];
  if (!scr) return false;
  if (push && state.screen && state.screen !== id) state.screenStack.push(state.screen);
  state.screen = id; state.openPage = null;
  render();
  return true;
}
function doAction(action, arg) {
  switch (action) {
    case 'toggle_menu': {
      var scrs = (state.layout && state.layout.screens) || [];
      if (scrs.length < 2) return;
      var home = scrs[0].id, alt = (scrs.filter(function (s) { return s.id === 'fullscreen'; })[0] || scrs[1]).id;
      showScreen(state.screen === home ? alt : home, false);
      break;
    }
    case 'fullscreen_tv': if (!showScreen('fullscreen', true)) { state.openPage = null; render(); } break;
    case 'home': showScreen(((state.layout.screens || [])[0] || {}).id, false); state.screenStack = []; break;
    case 'show_page': state.openPage = arg && (arg.page || arg); render(); break;
    case 'close_page':
      if (state.openPage) { state.openPage = null; render(); }
      else if (state.screenStack.length) showScreen(state.screenStack.pop(), false);
      break;
    case 'launch_app': if (arg && arg.app_id) tv.launchApp(arg.app_id, arg.params).then(null, function (e) { log('launch ' + arg.app_id + ' failed: ' + e.message); }); break;
    case 'tune': if (arg && arg.number != null) { var c = findChannel(arg.number); if (c) tuneTo(c); } break;
    case 'reload': window.location.reload(); break;
    default: log('unknown action ' + action);
  }
}
function menuZones() {
  var vis = visibleZoneIds();
  return ((state.layout && state.layout.zones) || []).filter(function (z) { return (z.type === 'menu' || z.type === 'app_launcher') && (!vis || vis[z.id] || state.openPage === z.id) && !(z.hidden && state.openPage !== z.id); });
}
function menuItems(z) { return z.type === 'app_launcher' ? (z.apps || []).map(function (a) { return { label: a.label, action: 'launch_app', app_id: a.app_id }; }) : (z.items || []); }
function moveFocus(delta) {
  var menus = menuZones();
  if (!menus.length) return false;
  var z = menus.filter(function (m) { return m.id === state.focus.zone; })[0] || menus[0];
  var items = menuItems(z);
  if (!items.length) return false;
  // First press on an unfocused menu lands on its first item; after that, move.
  var index = state.focus.zone === z.id ? (state.focus.index + delta + items.length) % items.length : 0;
  state.focus = { zone: z.id, index: index };
  var e = document.getElementById('zone-' + z.id);
  if (e) renderMenu(e, z);
  return true;
}
function activateFocus() {
  var menus = menuZones();
  var z = menus.filter(function (m) { return m.id === state.focus.zone; })[0];
  if (!z) { if (menus.length) { state.focus = { zone: menus[0].id, index: 0 }; render(); } return false; }
  var it = menuItems(z)[state.focus.index];
  if (!it) return false;
  doAction(it.action, it);
  return true;
}

// ---------------------------------------------------------------- keys
function onKeyDown(ev) {
  var code = ev.keyCode;
  var name = KEY_NAME[code];
  if (!name) return;
  var keys = (state.layout && state.layout.keys) || {};
  var handled = true;
  if (code >= KEY.NUM_0 && code <= KEY.NUM_9) pressDigit(String(code - KEY.NUM_0));
  else if (name === 'CH_UP') step(1);
  else if (name === 'CH_DOWN') step(-1);
  else if (name === 'ENTER' && state.digits) commitDigits();
  else if (name === 'LAST_CH') { var prev = findChannel(state.prevChannel); if (prev) tuneTo(prev); }
  else if (name === 'INFO') { if (state.channel) banner(state.channel.number + '  ' + state.channel.name + '   ' + formatClock('HH:mm', new Date())); else handled = false; }
  else if (keys[name]) doAction(keys[name]);
  else if (name === 'PORTAL' || name === 'GUIDE') doAction('toggle_menu');
  else if (name === 'BACK' || name === 'EXIT') doAction('close_page');
  else if (name === 'UP') handled = moveFocus(-1);
  else if (name === 'DOWN') handled = moveFocus(1);
  else if (name === 'ENTER') handled = activateFocus();
  else handled = false;
  if (handled) { ev.preventDefault(); ev.stopPropagation(); }
}

// ---------------------------------------------------------------- state from server
function applyLayout(layout, ctx, force) {
  if (ctx) state.context = ctx;
  var json = JSON.stringify(layout) + JSON.stringify(state.context);
  if (!force && json === state.layoutJson) return;
  state.layoutJson = json;
  state.layout = layout || {};
  var screens = state.layout.screens || [];
  if (!screens.some(function (s) { return s.id === state.screen; })) { state.screen = screens.length ? screens[0].id : null; state.screenStack = []; }
  state.openPage = null;
  render();
  log('layout: ' + (state.layout.name || '?') + (state.layout.version ? ' v' + state.layout.version : ''));
}
function applyLineup(lineup) {
  var json = JSON.stringify(lineup || []);
  var changed = json !== JSON.stringify(state.lineup);
  state.lineup = lineup || [];
  if (!changed) return;
  log('lineup: ' + state.lineup.length + ' channels');
  refreshChannelList();
  var hasVideo = !!(state.videoRect);
  if (!hasVideo) return;
  if (!state.channel || !state.lineup.some(function (c) { return c.id === state.channel.id; })) {
    var z = ((state.layout && state.layout.zones) || []).filter(function (x) { return x.type === 'video'; })[0];
    if (state.lineup.length) tuneStart(z); else { state.channel = null; tv.stopVideo(); refreshChannelList(); }
  }
}
function applyMessages(messages) {
  state.messages = messages || [];
  var m = state.messages[0];
  if (m) showMessage(m.text, 0); else hideMessage();
}
function applyState(data) {
  state.context = data.context || { hotel: '', room: data.room_number || '', guest: '', serial: state.props.serial_number || '' };
  applyLayout(data.layout, state.context);
  applyLineup(data.lineup);
  if (data.messages) applyMessages(data.messages);
  if (data.poll_interval_s) state.pollInterval = Math.max(10, Number(data.poll_interval_s));
  if (data.commands && data.commands.length) data.commands.forEach(function (c) { runCommand(c, ackViaHttp); });
  if (data.ws_url && !state.ws) { state.wsUrl = data.ws_url; connectWs(); }
}

// ---------------------------------------------------------------- commands
function uploadScreenshot(cmdId) {
  return tv.screenshot().then(function (r) {
    var uri = r && (r.uri || r.url || r.imageUri || r.image || r.data);
    if (!uri) return { note: 'no uri in capture result', raw: r };
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', uri, true);
      xhr.responseType = 'blob';
      xhr.onload = function () {
        if (xhr.status && (xhr.status < 200 || xhr.status >= 300)) { resolve({ note: 'capture uri not readable', uri: uri, status: xhr.status }); return; }
        var up = new XMLHttpRequest();
        up.open('POST', '/api/tv/upload' + authQs() + '&command_id=' + cmdId, true);
        up.setRequestHeader('Content-Type', xhr.response.type || 'image/jpeg');
        up.onload = function () { resolve(up.status < 300 ? { uploaded: true, bytes: xhr.response.size } : { note: 'upload failed HTTP ' + up.status }); };
        up.onerror = function () { resolve({ note: 'upload network error' }); };
        up.send(xhr.response);
      };
      xhr.onerror = function () { resolve({ note: 'capture uri not readable (network)', uri: uri }); };
      xhr.send();
    });
  });
}
function runCommand(cmd, ack) {
  var p = cmd.payload || {};
  var r;
  try {
    switch (cmd.type) {
      case 'set_property':
        r = tv.setProperty(p.key, p.value).then(function () { if (p.key === 'room_number') state.props.room_number = p.value; return { key: p.key }; });
        break;
      case 'reload_app': r = Promise.resolve({ reloading: true }); setTimeout(function () { window.location.reload(); }, 500); break;
      case 'reboot': r = tv.reboot().then(function () { return { rebooting: true }; }); break;
      case 'power':
        if (p.mode === 'off') r = tv.powerOff().then(function () { return { off: true }; });
        else if (p.mode === 'reboot') r = tv.reboot().then(function () { return { rebooting: true }; });
        else r = Promise.reject(new Error('power mode ' + p.mode + ' not supported from the app'));
        break;
      case 'tune': {
        var ch = p.channel_id ? state.lineup.filter(function (c) { return c.id === p.channel_id; })[0] : p.number != null ? findChannel(p.number) : p.params ? { id: 0, number: p.number || 0, name: p.name || 'direct', type: p.type || 'ip', params: p.params } : null;
        if (!ch) r = Promise.reject(new Error('channel not in lineup'));
        else r = tuneTo(ch).then(function (ok) { if (!ok) throw new Error('tune failed'); return { number: ch.number }; });
        break;
      }
      case 'volume': r = tv.setVolume(p.level).then(function () { state.volume = Number(p.level); return { level: Number(p.level) }; }); break;
      case 'mute': r = tv.setMute(p.mute !== false).then(function () { state.muted = p.mute !== false; return { mute: state.muted }; }); break;
      case 'message': showMessage(p.text || '', p.ttl_s != null ? Number(p.ttl_s) : 30); r = Promise.resolve({ shown: true }); break;
      case 'toast': r = tv.toast(p.text || '').then(function () { return { shown: true }; }); break;
      case 'screenshot': r = uploadScreenshot(cmd.id); break;
      case 'checkout': r = tv.checkout().then(function () { try { localStorage.clear(); } catch (e) {} return { checkout: true }; }); break;
      case 'launch_app': r = tv.launchApp(p.app_id, p.params).then(function () { return { app_id: p.app_id }; }); break;
      default: r = Promise.reject(new Error('unsupported command ' + cmd.type));
    }
  } catch (e) { r = Promise.reject(e); }
  r.then(function (result) { log('command ' + cmd.type + ' ok'); ack(cmd.id, true, result); },
         function (err) { log('command ' + cmd.type + ' failed: ' + err.message); ack(cmd.id, false, { error: err.message }); });
}
function ackViaHttp(id, ok, result) {
  request('POST', '/api/tv/ack' + authQs(), { command_id: id, ok: ok, result: result }).then(null, function () {});
}
function ackViaWs(id, ok, result) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'ack', command_id: id, ok: ok, result: result }));
  else ackViaHttp(id, ok, result);
}
function sendEvent(name, payload) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'event', name: name, payload: payload }));
}

// ---------------------------------------------------------------- websocket
function heartbeatPayload() {
  return { type: 'hb', uptime: Math.floor((Date.now() - state.bootTime) / 1000), channel: state.channel ? state.channel.number : null,
    volume: state.volume, muted: state.muted, power_mode: state.powerMode, app_version: APP_VERSION };
}
function sendHeartbeat(ws) {
  var send = function () { if (ws.readyState === 1) ws.send(JSON.stringify(heartbeatPayload())); };
  if (!state.api) { send(); return; }
  tv.getVolume().then(function (v) { if (v.level != null) state.volume = v.level; if (v.mute != null) state.muted = v.mute; send(); }, send);
}
function connectWs() {
  if (!state.wsUrl || typeof WebSocket === 'undefined') return;
  if (state.wsTimer) { clearTimeout(state.wsTimer); state.wsTimer = null; }
  var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  var url = proto + window.location.host + state.wsUrl + authQs();
  var ws;
  try { ws = new WebSocket(url); } catch (e) { log('ws error: ' + e.message); scheduleWsReconnect(); return; }
  state.ws = ws;
  ws.onopen = function () {
    state.wsBackoff = 0;
    log('ws connected');
    sendHeartbeat(ws);
    if (state.hbTimer) clearInterval(state.hbTimer);
    state.hbTimer = setInterval(function () { sendHeartbeat(ws); }, 60000);
  };
  ws.onmessage = function (ev) { var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; } onWsMessage(msg); };
  ws.onclose = function (ev) {
    if (state.ws === ws) state.ws = null;
    if (state.hbTimer) { clearInterval(state.hbTimer); state.hbTimer = null; }
    if (ev && ev.code === 4000) { log('ws replaced by another connection'); return; }
    log('ws closed' + (ev && ev.code ? ' (' + ev.code + ')' : ''));
    scheduleWsReconnect();
  };
  ws.onerror = function () {};
}
function scheduleWsReconnect() {
  var waits = [3000, 5000, 10000, 20000, 30000, 60000];
  var wait = waits[Math.min(state.wsBackoff++, waits.length - 1)];
  if (state.wsTimer) clearTimeout(state.wsTimer);
  state.wsTimer = setTimeout(connectWs, wait);
}
function onWsMessage(msg) {
  switch (msg.type) {
    case 'hello': break;
    case 'layout':
      if (msg.room_number !== undefined && msg.context) msg.context.room = msg.room_number || '';
      applyLayout(msg.layout, msg.context || state.context, !!msg.preview);
      if (msg.preview) log('preview layout from admin');
      break;
    case 'lineup': applyLineup(msg.lineup); break;
    case 'messages': applyMessages(msg.messages); break;
    case 'command': runCommand(msg.command, ackViaWs); break;
    case 'deleted': log('this set was deleted in admin; re-registering'); state.setId = null; state.token = null; registerLoop(0); break;
    case 'pong': break;
    default: log('ws: unknown message ' + msg.type);
  }
}

// ---------------------------------------------------------------- boot loop
function schedulePoll() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(function () {
    poll().then(function (data) { applyState(data); schedulePoll(); }, function (err) {
      log('poll failed: ' + err.message);
      if (/HTTP 401/.test(err.message)) { registerLoop(0); return; }
      schedulePoll();
    });
  }, state.pollInterval * 1000);
}
function registerLoop(attempt) {
  register().then(function (data) {
    state.setId = data.set_id; state.token = data.token;
    if (state.ws) { try { state.ws.onclose = null; state.ws.close(); } catch (e) {} state.ws = null; }
    showStatus(false);
    log('registered as set ' + data.set_id + (data.created ? ' (new)' : ''));
    applyState(data);
    schedulePoll();
  }, function (err) {
    var wait = REGISTER_RETRY_MS[Math.min(attempt, REGISTER_RETRY_MS.length - 1)];
    showStatus(true);
    log('register failed: ' + err.message + ' — retry in ' + (wait / 1000) + 's');
    setTimeout(function () { registerLoop(attempt + 1); }, wait);
  });
}
function localLayout(text) {
  return { schema: 1, name: 'local', canvas: { w: 1920, h: 1080, background: '#0b1a2a' }, zones: [
    { id: 't', type: 'text', x: 120, y: 200, w: 1680, h: 100, text: 'CoopCentric ' + APP_VERSION, style: { fontSize: 56, fontWeight: 'bold', color: '#fff' } },
    { id: 'm', type: 'text', x: 120, y: 340, w: 1680, h: 300, text: text, style: { fontSize: 34, color: '#8fb3c9' } },
    { id: 'c', type: 'clock', x: 1560, y: 980, w: 260, h: 60, format: 'HH:mm:ss', style: { fontSize: 40, color: '#fff', align: 'right' } } ] };
}
function readProperties() {
  var p = Promise.resolve();
  PROPERTY_KEYS.forEach(function (k) { p = p.then(function () { return tv.getProperty(k).then(function (v) { state.props[k] = v; }); }); });
  return p.then(function () { return tv.displayResolution(); }).then(function (osd) { state.osd = osd; })
    .then(function () { return tv.getPowerMode(); }).then(function (pm) { state.powerMode = pm; });
}
function preparePlatform() {
  // Claim the keys the lineup needs; leave VOL/MUTE with the TV firmware.
  return tv.claimKeys(CLAIMED_KEYS, 1).then(function () { log('keys claimed: ' + CLAIMED_KEYS.length); }, function () {});
}
function boot() {
  fitStage({ w: 1920, h: 1080 });
  showStatus(true);
  log('CoopCentric renderer ' + APP_VERSION + ' — detecting platform…');
  try { state.lastChannel = Number(localStorage.getItem('cc_last_channel')) || null; state.prevChannel = state.lastChannel; } catch (e) {}
  document.addEventListener('keydown', onKeyDown, true);
  tv.on('channel_changed', function (ev) { if (ev && ev.result === false) log('channel_changed error: ' + ev.errorMessage); });
  tv.on('power_mode_changed', function (ev) { state.powerMode = ev && ev.mode ? String(ev.mode) : state.powerMode; sendEvent('power', { mode: state.powerMode }); });
  document.addEventListener('visibilitychange', function () { sendEvent('visibility', { hidden: !!document.hidden }); });
  tv.detect().then(function (api) {
    state.api = api;
    if (!api) { log('no LG middleware answered; running in browser mode'); return Promise.resolve(); }
    log('API: ' + api.toUpperCase());
    return readProperties().then(preparePlatform);
  }).then(function () {
    if (!state.props.serial_number) {
      var m = /[?&]serial=([^&]+)/.exec(window.location.search || '');
      if (m) { state.props.serial_number = decodeURIComponent(m[1]); state.props.model_name = state.props.model_name || 'browser'; }
      else { state.layout = localLayout('No LG middleware and no ?serial=… given.\nOpen this page on a Pro:Centric set, or add ?serial=TEST to simulate one.'); render(); return; }
    }
    log('serial ' + (state.props.serial_number || '?') + ' · ' + (state.props.model_name || '?'));
    registerLoop(0);
  });
}
window.addEventListener('resize', function () { if (state.layout) render(); });
document.addEventListener('DOMContentLoaded', boot);
// Test hook (read-only view of state).
window.__cc = { state: state, tuneTo: tuneTo, findChannel: findChannel };
