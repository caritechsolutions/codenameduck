// CoopCentric TV renderer.
// Boot: detect platform → read set properties → POST /api/tv/register on our own hostname →
// draw the layout → WebSocket for live pushes (poll fallback) → remote keys drive the lineup.
// Video placement, tuning, key claiming follow LG's sample apps via ./platform.js.
/* global __APP_VERSION__ */
import * as tv from './platform.js';
import { KEY, KEY_NAME } from './platform.js';
import ZONE_TYPES from '../../shared/zone-types.json';

var APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
var PROPERTY_KEYS = ['serial_number', 'model_name', 'platform_version', 'firmware_version', 'webos_version', 'idpn', 'room_number', 'instant_power'];
var REGISTER_RETRY_MS = [5000, 10000, 20000, 30000];
var CLAIMED_KEYS = ['CH_UP', 'CH_DOWN', 'NUM_0', 'NUM_1', 'NUM_2', 'NUM_3', 'NUM_4', 'NUM_5', 'NUM_6', 'NUM_7', 'NUM_8', 'NUM_9', 'PORTAL', 'GUIDE', 'INFO', 'BACK', 'LAST_CH'];
var BANNER_MS = 3500;
var DIGIT_TIMEOUT_MS = 2500;

var stage = document.getElementById('stage');
var statusEl = document.getElementById('status');
var overlayEl = document.getElementById('overlay');
var videoEl = null;            // HTML5 <video> used for URL (HLS/MP4) channels — created once, never re-created
var videoHost = null;          // persistent box: url('TV:') hole for tuner channels, parent of videoEl
var pendingEvents = [];        // events queued while the WebSocket is down
var MAX_PENDING_EVENTS = 50;
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
// The stage AND the overlay (banner, digits, messages) are laid out in canvas pixels and
// scaled to the viewport together, so OSD elements land on screen at any TV resolution.
function fitStage(canvas) {
  var w = (canvas && canvas.w) || 1920, h = (canvas && canvas.h) || 1080;
  var s = Math.min(window.innerWidth / w, window.innerHeight / h) || 1;
  state.canvasSize = { w: w, h: h };
  state.scale = s;
  state.offset = { x: Math.floor((window.innerWidth - w * s) / 2), y: Math.floor((window.innerHeight - h * s) / 2) };
  [stage, overlayEl].forEach(function (e) {
    e.style.width = w + 'px'; e.style.height = h + 'px';
    e.style.transform = 'scale(' + s + ')';
    e.style.left = state.offset.x + 'px';
    e.style.top = state.offset.y + 'px';
  });
}
// Canvas rect → OSD pixels. LG positions the tuner video in display_resolution coordinates
// (1280x720 / 1920x1080 / 3840x2160), so scale straight from the layout canvas to that.
function toOsdRect(z) {
  var c = state.canvasSize || { w: 1920, h: 1080 };
  var osdW = (state.osd && state.osd.w) || window.innerWidth, osdH = (state.osd && state.osd.h) || window.innerHeight;
  var kx = osdW / c.w, ky = osdH / c.h;
  return { x: z.x * kx, y: z.y * ky, width: z.w * kx, height: z.h * ky };
}
// The "fullscreen" screen shows the video zone over the whole canvas.
function effectiveVideoRect(z) {
  if (state.screen === 'fullscreen') { var c = state.canvasSize || { w: 1920, h: 1080 }; return { x: 0, y: 0, w: c.w, h: c.h }; }
  return { x: z.x, y: z.y, w: z.w, h: z.h };
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
  image: function (e, z, ctx) { var img = document.createElement('img'); img.src = substitute(z.src || '', ctx); img.alt = ''; if (z.fit) img.style.objectFit = z.fit; e.appendChild(img); },
  clock: function (e, z) { e.setAttribute('data-clock', z.format || 'HH:mm'); e.textContent = formatClock(z.format, new Date()); },
  video: function (e, z) {
    // The zone element is only a placeholder in the stacking order; the actual picture lives in
    // the persistent #videohost (tuner: transparent url('TV:') hole; URL channels: <video>),
    // which is repositioned on screen changes and never re-created — re-creating or moving a
    // playing <video> in the DOM pauses it (that was the black screen on PORTAL).
    var r = effectiveVideoRect(z);
    e.style.left = r.x + 'px'; e.style.top = r.y + 'px'; e.style.width = r.w + 'px'; e.style.height = r.h + 'px';
    e.style.background = 'transparent';
    e.setAttribute('data-video', '1');
  },
  banner: function (e) { e.style.display = 'none'; },   // overlay placement zones draw nothing themselves
  digits: function (e) { e.style.display = 'none'; },
  popup: function (e) { e.style.display = 'none'; },
  channel_list: function (e, z) { e.setAttribute('data-chlist', '1'); renderChannelList(e, z); },
  menu: function (e, z) { e.setAttribute('data-menu', '1'); renderMenu(e, z); },
  html: function (e, z) { e.innerHTML = z.html || ''; },
  weather: function (e, z) { e.setAttribute('data-weather', '1'); renderWeather(e, z); },
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
function renderWeather(e, z) {
  var w = state.weather;
  var st = z.style || {};
  while (e.firstChild) e.removeChild(e.firstChild);
  if (!w || !w.ok) { e.appendChild(el('span', 'wx-na', w && w.reason ? '' : '…')); return; }
  var imperial = (z.units || state.context.units) === 'imperial';
  var wrap = el('div', 'wx');
  wrap.appendChild(el('span', 'wx-icon', w.icon || ''));
  wrap.appendChild(el('span', 'wx-temp', (imperial ? w.temp_f + '°F' : w.temp_c + '°C')));
  if (z.showText !== false) wrap.appendChild(el('span', 'wx-text', w.text || ''));
  if (st.align === 'right') wrap.style.justifyContent = 'flex-end';
  if (st.align === 'center') wrap.style.justifyContent = 'center';
  e.appendChild(wrap);
}
function refreshWeather() {
  if (!state.setId) return;
  request('GET', '/api/tv/weather' + authQs()).then(function (w) {
    state.weather = w;
    var els = stage.querySelectorAll('[data-weather]');
    for (var i = 0; i < els.length; i++) {
      var id = els[i].id.replace('zone-', '');
      var z = ((state.layout && state.layout.zones) || []).filter(function (x) { return x.id === id; })[0];
      if (z) renderWeather(els[i], z);
    }
  }, function (err) { log('weather: ' + err.message); });
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
  ensureVideoHost();
  Array.prototype.slice.call(stage.querySelectorAll('.zone')).forEach(function (n) { stage.removeChild(n); });
  placeOverlays(layout);
  var visible = visibleZoneIds();
  var skipped = [];
  // The video zone is tracked even when the current screen hides it, so placeVideo() can pause
  // instead of tearing the channel down.
  var videoZone = (layout.zones || []).filter(function (z) { return z.type === 'video'; })[0] || null;
  (layout.zones || []).forEach(function (z) {
    if (z.hidden && !(state.openPage === z.id)) return;
    if (visible && !visible[z.id] && state.openPage !== z.id) return;
    var fn = RENDERERS[z.type];
    if (!fn) { skipped.push(z.type); return; }
    if (z.type === 'banner' || z.type === 'digits' || z.type === 'popup') return;   // placement only
    var e = el('div', 'zone zone-' + z.type);
    e.id = 'zone-' + z.id;
    e.style.left = (z.x || 0) + 'px'; e.style.top = (z.y || 0) + 'px';
    e.style.width = (z.w || 0) + 'px'; e.style.height = (z.h || 0) + 'px';
    applyStyle(e, z.style);
    fn(e, z, state.context);
    stage.appendChild(e);
  });
  if (skipped.length) log('zone types not supported: ' + skipped.join(', '));
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClocks, 1000);
  placeVideo(videoZone);
}

function ensureVideoHost() {
  if (videoHost) return videoHost;
  videoHost = el('div', 'videohost');
  videoHost.id = 'videohost';
  videoHost.style.backgroundImage = "url('TV:')";
  videoHost.style.background = "url('TV:')";
  videoHost.appendChild(ensureVideoEl());
  stage.insertBefore(videoHost, stage.firstChild);
  return videoHost;
}
// LG's own "No Signal" OSD sits above the page whenever the tuner has no channel; turn it off
// while an HTML5 stream is the picture and restore it for tuner channels. The url('TV:') hole
// is also removed in HTML5 mode so nothing of the tuner plane shows through.
function setNoSignal(mode) {
  if (!state.api || state.noSignalMode === mode) return Promise.resolve();
  state.noSignalMode = mode;
  return tv.setNoSignalImage(mode).then(function () { log('nosignalimage ' + mode); }, function (e) { state.noSignalMode = null; reportError('nosignal', 'nosignalimage/set ' + mode + ': ' + e.message); });
}
// Make sure the set's A/V source is the tuner ("TV"), not an HDMI input: at boot and before any
// HTML5 channel. LG's external-input OSD ("check the power of the external devices…") sits above
// the page and nosignalimage/set does nothing about it.
function ensureTvInput() {
  if (!state.api) return Promise.resolve();
  return tv.getExternalInput().then(function (cur) {
    state.input = cur;
    if (cur && cur.type === 'TV') return cur;
    return tv.setExternalInput('TV', 0).then(function () {
      log('input switched to TV (was ' + (cur && cur.type ? cur.type + (cur.index != null ? ' ' + cur.index : '') : '?') + ')');
      sendEvent('input', { from: cur ? cur.type : null, from_index: cur ? cur.index : null, to: 'TV', index: 0 });
      state.input = { type: 'TV', index: 0 };
      return state.input;
    });
  }, function (e) { reportError('input', 'externalinput/get: ' + e.message); }).then(null, function (e) { reportError('input', 'externalinput/set TV: ' + e.message); });
}
function setHostMode(html5) {
  ensureVideoHost();
  var tvUrl = "url('TV:')";
  if (html5) { videoHost.style.backgroundImage = 'none'; videoHost.style.background = '#000'; videoHost.setAttribute('data-mode', 'html5'); }
  else { videoHost.style.backgroundImage = tvUrl; videoHost.style.background = tvUrl; videoHost.setAttribute('data-mode', 'tuner'); }
}
function positionVideoHost(r) {
  ensureVideoHost();
  videoHost.style.left = r.x + 'px'; videoHost.style.top = r.y + 'px'; videoHost.style.width = r.w + 'px'; videoHost.style.height = r.h + 'px';
  videoHost.style.display = 'block';
}
// Overlay elements (banner, digits, popup) take their geometry from placement zones when present.
var OVERLAY_DEFAULTS = {
  banner: { x: 80, y: 880, w: 1200, h: 80 },
  digits: { x: 1560, y: 60, w: 280, h: 110 },
  popup: { x: 210, y: 150, w: 1500, h: 200 }
};
function placeOverlays(layout) {
  ['banner', 'digits', 'popup'].forEach(function (type) {
    var z = (layout.zones || []).filter(function (x) { return x.type === type; })[0];
    var e = overlayEl.querySelector('.' + type);
    var r = z || OVERLAY_DEFAULTS[type];
    e.style.left = r.x + 'px'; e.style.top = r.y + 'px'; e.style.width = r.w + 'px'; e.style.minHeight = r.h + 'px';
    e.style.right = 'auto'; e.style.bottom = 'auto'; e.style.transform = 'none'; e.style.maxWidth = 'none';
    e.setAttribute('data-placed', z ? '1' : '0');
    ['fontSize', 'color', 'background', 'fontWeight', 'align', 'padding', 'borderRadius', 'border', 'opacity'].forEach(function (k) { e.style[k === 'align' ? 'textAlign' : k] = ''; });
    if (z && z.style) applyStyle(e, z.style);
  });
}

// Video: make sure the picture is what the layout wants, where it wants it.
//  - no video zone in the layout      → stop everything, forget the channel
//  - video zone not on this screen    → keep the channel, pause to save bandwidth (channel/stop
//                                       leaves the multicast group; <video> pauses)
//  - visible, geometry changed        → only move it (video/size/set or CSS), never retune
function placeVideo(z) {
  if (!z) {
    if (state.videoRect || state.channel) { state.videoRect = null; htmlVideoStop(); if (state.api) tv.stopVideo(); state.channel = null; state.mediaMode = null; state.videoPaused = false; }
    if (videoHost) videoHost.style.display = 'none';
    return;
  }
  var vis = visibleZoneIds();
  var shown = !vis || !!vis[z.id];
  if (!shown) {
    if (videoHost) videoHost.style.display = 'none';
    if (state.channel && !state.videoPaused) {
      state.videoPaused = true;
      if (isUrlChannel(state.channel)) { if (state.mediaMode === 'html5' && videoEl) { try { videoEl.pause(); } catch (e) {} } else if (state.api) tv.platformMediaStop().then(null, function () {}); }
      else if (state.api) tv.channelStop().then(null, function (e) { reportError('channel_stop', e.message); });
      log('video hidden: paused');
    }
    return;
  }
  var r = effectiveVideoRect(z);
  positionVideoHost(r);
  var rect = toOsdRect(r);
  var key = JSON.stringify(rect);
  var moved = state.videoRect !== key;
  state.videoRect = key;
  if (!state.api) return;
  if (!state.channel) { tuneStart(z); return; }
  if (state.videoPaused) {
    state.videoPaused = false;
    if (isUrlChannel(state.channel)) {
      if (state.mediaMode === 'html5' && videoEl) { var p = videoEl.play(); if (p && p.then) p.then(null, function (e) { reportError('media', 'resume failed: ' + (e && e.message)); }); }
      else tuneTo(state.channel);      // platform pipeline was torn down; restart it
    } else tv.channelReplay().then(null, function (e) { reportError('channel_replay', e.message); });
    log('video shown: resumed');
  }
  // Only tuner (multicast/RF) video is positioned by the TV; the <video> element follows the host box.
  if (moved && !isUrlChannel(state.channel)) tv.setVideoSize(rect).then(null, function (e) { reportError('video_size', e.message); });
}
function isUrlChannel(ch) { return !!(ch && ch.type === 'ip' && ch.params && ch.params.url); }

// ---------------------------------------------------------------- URL channels (HTML5 video)
function ensureVideoEl() {
  if (videoEl) return videoEl;
  videoEl = document.createElement('video');
  videoEl.className = 'urlvideo';
  videoEl.id = 'urlvideo';
  videoEl.autoplay = true; videoEl.muted = false; videoEl.playsInline = true;
  videoEl.setAttribute('preload', 'auto');
  videoEl.addEventListener('error', function () {
    var err = videoEl.error;
    var msg = 'video element error ' + (err ? err.code : '?') + (err && err.message ? ' ' + err.message : '');
    if (videoEl.__reject) videoEl.__reject(new Error(msg));
  });
  videoEl.addEventListener('playing', function () { if (videoEl.__resolve) videoEl.__resolve(true); });
  videoEl.addEventListener('stalled', function () { sendEvent('media', { kind: 'stalled', src: videoEl.currentSrc }); });
  return videoEl;
}
function htmlVideoPlay(ch) {
  var v = ensureVideoEl();
  ensureVideoHost();
  return tv.stopVideo().then(null, function () {}).then(function () {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error('video element timeout')); } }, 15000);
      v.__resolve = function () { if (!done) { done = true; clearTimeout(t); resolve(true); } };
      v.__reject = function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } };
      v.src = ch.params.url;
      var p = v.play();
      if (p && p.then) p.then(null, function (e) { v.__reject(new Error('play() rejected: ' + (e && e.message))); });
    });
  });
}
function htmlVideoStop() {
  if (!videoEl) return;
  try { videoEl.__resolve = null; videoEl.__reject = null; videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } catch (e) {}
}
// URL channel: HTML5 <video> first; if the element cannot play it, fall back to LG's media
// pipeline (tv/media/*), and report whatever fails.
function playUrlChannel(ch) {
  return htmlVideoPlay(ch).then(function () { state.mediaMode = 'html5'; return true; }, function (e) {
    reportError('media', 'HTML5 video failed for ' + ch.params.url + ': ' + e.message + ' — trying platform media player');
    htmlVideoStop();
    if (!state.api) throw e;
    setHostMode(false);   // LG's pipeline draws on the TV plane: the hole must be back
    return tv.platformMediaPlay(ch.params.url, ch.params.mimeType).then(function () { state.mediaMode = 'platform'; return true; });
  });
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
  var run;
  if (isUrlChannel(ch)) { setHostMode(true); run = ensureTvInput().then(function () { return setNoSignal('off'); }).then(function () { return playUrlChannel(ch); }); }
  else { htmlVideoStop(); setHostMode(false); run = setNoSignal('default').then(function () { return state.mediaMode === 'platform' ? tv.platformMediaStop() : Promise.resolve(); }).then(function () { state.mediaMode = null; return tv.tune(ch); }); }
  return run.then(function () {
    if (state.tuning !== token) return false;
    log('tuned ' + ch.number + ' ' + ch.name + (state.mediaMode ? ' (' + state.mediaMode + ')' : ''));
    var rect = state.videoRect ? JSON.parse(state.videoRect) : null;
    if (rect && !isUrlChannel(ch)) tv.setVideoSize(rect).then(null, function (e) { reportError('video_size', e.message); });
    sendEvent('channel', { number: ch.number, id: ch.id, mode: state.mediaMode || 'tuner' });
    if (state.ws && state.ws.readyState === 1) sendHeartbeat(state.ws);   // admin sees the new channel at once
    return true;
  }, function (e) {
    if (state.tuning !== token) return false;
    banner(ch.number + '  ' + ch.name + ' — no signal');
    reportError('tune', 'channel ' + ch.number + ' ' + ch.name + ': ' + e.message, { number: ch.number });
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
// Persistent messages (admin Messages page) use the bottom bar; one-off "message" commands
// use the popup so they never fight with the bar.
function showMessage(text, ttlS) {
  var m = overlayEl.querySelector('.message');
  m.textContent = text; m.className = 'message show';
  if (state.messageTimer) clearTimeout(state.messageTimer);
  if (ttlS !== 0) state.messageTimer = setTimeout(function () { m.className = 'message'; }, (ttlS || 20) * 1000);
}
function hideMessage() { overlayEl.querySelector('.message').className = 'message'; }
function showPopup(text, ttlS) {
  var m = overlayEl.querySelector('.popup');
  m.textContent = text; m.className = 'popup show';
  if (state.popupTimer) clearTimeout(state.popupTimer);
  if (ttlS !== 0) state.popupTimer = setTimeout(function () { m.className = 'popup'; }, (ttlS || 30) * 1000);
}
function channelBanner() {
  if (!state.channel) return;
  banner(state.channel.number + '  ' + state.channel.name + '   ' + formatClock('HH:mm', new Date()));
}
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
  else if (name === 'INFO') { if (state.channel) channelBanner(); else handled = false; }
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
// Program the TV's own start channel (what it shows at power-on before the app is up) with
// the first tuner channel of the lineup; disable it when the lineup has none.
function programStartChannel() {
  if (!state.api) return;
  var first = state.lineup.filter(function (c) { return !isUrlChannel(c); })[0] || null;
  var key = first ? JSON.stringify(first.params) + first.type : 'none';
  if (state.startChannelKey === key) return;
  state.startChannelKey = key;
  tv.setStartChannel(first).then(function () { log('start channel: ' + (first ? first.number + ' ' + first.name : 'disabled')); sendEvent('start_channel', { number: first ? first.number : null }); },
    function (e) { state.startChannelKey = null; reportError('start_channel', e.message); });
}
function applyLineup(lineup) {
  var json = JSON.stringify(lineup || []);
  var changed = json !== JSON.stringify(state.lineup);
  state.lineup = lineup || [];
  if (!changed) return;
  log('lineup: ' + state.lineup.length + ' channels');
  refreshChannelList();
  programStartChannel();
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
        r = tv.setPropertyVerified(p.key, p.value).then(function (res) {
          state.props[p.key] = res.back == null ? String(p.value) : String(res.back);
          if (p.key === 'instant_power') sendEvent('instant_power', { value: state.props.instant_power, sent_as: typeof res.sent });
          if (state.ws && state.ws.readyState === 1) sendHeartbeat(state.ws);
          return { key: p.key, value: state.props[p.key], sent_as: typeof res.sent };
        });
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
      case 'message': showPopup(p.text || '', p.ttl_s != null ? Number(p.ttl_s) : 30); r = Promise.resolve({ shown: true }); break;
      case 'toast': r = tv.toast(p.text || '').then(function () { return { shown: true }; }); break;
      case 'screenshot': r = uploadScreenshot(cmd.id); break;
      case 'checkout':
        r = tv.checkout().then(null, function (e) { log('platform checkout failed: ' + e.message); }).then(function () {
          try { localStorage.clear(); } catch (e) {}
          state.lastChannel = null; state.prevChannel = null;
          if (p.message) showPopup(p.message, 20);
          return { checkout: true };
        });
        break;
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
// TV-side events go to the server event log (WS when connected, HTTP batch otherwise, queued
// while offline) so problems are visible in the admin drawer and the journal.
function sendEvent(name, payload) {
  var ev = { name: name, payload: payload, at: new Date().toISOString() };
  if (state.ws && state.ws.readyState === 1) { state.ws.send(JSON.stringify({ type: 'event', name: ev.name, payload: ev.payload, at: ev.at })); return; }
  pendingEvents.push(ev);
  if (pendingEvents.length > MAX_PENDING_EVENTS) pendingEvents.shift();
  if (state.setId && state.token && !state.flushTimer) state.flushTimer = setTimeout(flushEvents, 2000);
}
function flushEvents() {
  state.flushTimer = null;
  if (!pendingEvents.length || !state.setId) return;
  var batch = pendingEvents.splice(0, pendingEvents.length);
  if (state.ws && state.ws.readyState === 1) { batch.forEach(function (ev) { state.ws.send(JSON.stringify({ type: 'event', name: ev.name, payload: ev.payload, at: ev.at })); }); return; }
  request('POST', '/api/tv/events' + authQs(), { events: batch }).then(null, function () {
    pendingEvents = batch.concat(pendingEvents).slice(-MAX_PENDING_EVENTS);
    state.flushTimer = setTimeout(flushEvents, 15000);
  });
}
function reportError(kind, message, extra) {
  log('ERROR ' + kind + ': ' + message);
  var payload = { kind: kind, message: String(message).slice(0, 500) };
  if (extra) Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
  sendEvent('error', payload);
}

// ---------------------------------------------------------------- websocket
function heartbeatPayload() {
  return { type: 'hb', uptime: Math.floor((Date.now() - state.bootTime) / 1000), channel: state.channel ? state.channel.number : null,
    volume: state.volume, muted: state.muted, power_mode: state.powerMode, app_version: APP_VERSION,
    instant_power: state.props.instant_power == null ? null : Number(state.props.instant_power) };
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
    var wasDown = state.wsDownSince;
    state.wsBackoff = 0; state.wsDownSince = null;
    log('ws connected');
    sendHeartbeat(ws);
    sendEvent('ws', { kind: 'open', reconnect: !!wasDown, down_ms: wasDown ? Date.now() - wasDown : 0 });
    flushEvents();
    if (state.hbTimer) clearInterval(state.hbTimer);
    state.hbTimer = setInterval(function () { sendHeartbeat(ws); }, 60000);
  };
  ws.onmessage = function (ev) { var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; } onWsMessage(msg); };
  ws.onclose = function (ev) {
    if (state.ws === ws) state.ws = null;
    if (state.hbTimer) { clearInterval(state.hbTimer); state.hbTimer = null; }
    if (ev && ev.code === 4000) { log('ws replaced by another connection'); return; }
    log('ws closed' + (ev && ev.code ? ' (' + ev.code + ')' : ''));
    if (!state.wsDownSince) state.wsDownSince = Date.now();
    sendEvent('ws', { kind: 'close', code: ev && ev.code, reason: ev && ev.reason, clean: !!(ev && ev.wasClean) });
    scheduleWsReconnect();
  };
  ws.onerror = function () { sendEvent('ws', { kind: 'error' }); };
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
    refreshWeather();
    if (state.weatherTimer) clearInterval(state.weatherTimer);
    state.weatherTimer = setInterval(refreshWeather, 15 * 60 * 1000);
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
  // Claim the keys the lineup needs; leave VOL/MUTE with the TV firmware. Then make sure the
  // set is on the TV input so no external-input OSD covers the layout.
  return tv.claimKeys(CLAIMED_KEYS, 1).then(function () { log('keys claimed: ' + CLAIMED_KEYS.length); }, function () {}).then(ensureTvInput);
}
function boot() {
  fitStage({ w: 1920, h: 1080 });
  showStatus(true);
  log('CoopCentric renderer ' + APP_VERSION + ' — detecting platform…');
  try { state.lastChannel = Number(localStorage.getItem('cc_last_channel')) || null; state.prevChannel = state.lastChannel; } catch (e) {}
  document.addEventListener('keydown', onKeyDown, true);
  tv.on('channel_changed', function (ev) { if (ev && ev.result === false) reportError('channel_changed', ev.errorMessage || 'failed'); });
  ['play_error', 'media_error', 'media_play_error'].forEach(function (n) { tv.on(n, function (ev) { reportError('media_event', n + ': ' + ((ev && (ev.errorMessage || ev.message)) || JSON.stringify(ev && ev.detail || {}))); }); });
  ['play_start', 'play_end', 'buffering_start', 'buffering_end', 'network_changed', 'checkout'].forEach(function (n) { tv.on(n, function () { sendEvent('platform', { kind: n }); }); });
  window.addEventListener('error', function (e) { reportError('js', (e && e.message) || 'script error', { source: e && e.filename, line: e && e.lineno }); });
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
// Every shared zone type must have a drawer and vice versa (shared/zone-types.json).
(function () {
  var have = Object.keys(RENDERERS);
  var missing = ZONE_TYPES.filter(function (t) { return have.indexOf(t) < 0; });
  var extra = have.filter(function (t) { return ZONE_TYPES.indexOf(t) < 0; });
  if (missing.length || extra.length) log('ERROR zone types out of sync: missing ' + missing.join(',') + ' extra ' + extra.join(','));
})();
// Test hook (read-only view of state).
window.__cc = { state: state, tuneTo: tuneTo, findChannel: findChannel, render: render, zoneTypes: Object.keys(RENDERERS) };
