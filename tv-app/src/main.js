// CoopCentric TV renderer.
// Boot: detect platform → read set properties → POST /api/tv/register on our own hostname →
// draw the layout → WebSocket for live pushes (poll fallback) → remote keys drive the lineup.
// Video placement, tuning, key claiming follow LG's sample apps via ./platform.js.
/* global __APP_VERSION__ */
import * as tv from './platform.js';
import { KEY, KEY_NAME } from './platform.js';
import ZONE_TYPES from '../../shared/zone-types.json';
import * as draw from '../../shared/zone-draw.js';
import * as model from '../../shared/layout-model.js';

var APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
var PROPERTY_KEYS = ['serial_number', 'model_name', 'platform_version', 'firmware_version', 'webos_version', 'idpn', 'room_number', 'instant_power'];
var REGISTER_RETRY_MS = [5000, 10000, 20000, 30000];
var CLAIMED_KEYS = ['CH_UP', 'CH_DOWN', 'NUM_0', 'NUM_1', 'NUM_2', 'NUM_3', 'NUM_4', 'NUM_5', 'NUM_6', 'NUM_7', 'NUM_8', 'NUM_9', 'PORTAL', 'GUIDE', 'INFO', 'BACK', 'LAST_CH', 'NETFLIX'];
var NETFLIX_LAUNCHER_VERSION = '1.0';
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
  page: null, pageStack: [], fullscreen: false, toggled: {}, lineup: [], channel: null, lastChannel: null, tuning: null, videoRect: null,
  osd: null, scale: 1, offset: { x: 0, y: 0 }, digits: '', digitTimer: null, focus: { zone: null, index: 0 },
  pollInterval: 60, pollTimer: null, clockTimer: null, ws: null, wsUrl: null, wsBackoff: 0, wsTimer: null, hbTimer: null,
  bootTime: Date.now(), volume: null, muted: null, powerMode: null, messages: [], bannerTimer: null, messageTimer: null,
  apps: [], appsReported: null, appsStatus: null, hiddenAt: null, activation: null, registering: false, bootRegistered: false, serviceCountry: null
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
  if (state.appsReported) body.apps = state.appsReported;   // idcap://application/list result, raw
  if (state.appsStatus) body.apps_status = state.appsStatus;   // idcap://application/register/status per app, raw
  if (state.serviceCountry != null) body.service_country = state.serviceCountry;   // configuration/servicecountry/get, raw (server flags "Others")
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
  if (state.fullscreen) { var c = state.canvasSize || { w: 1920, h: 1080 }; return { x: 0, y: 0, w: c.w, h: c.h }; }
  return { x: z.x, y: z.y, w: z.w, h: z.h };
}

// ---------------------------------------------------------------- rendering helpers
// Drawing code is shared with the admin's in-editor preview: ../../shared/zone-draw.js.
var substitute = draw.substitute, applyStyle = draw.applyStyle, formatClock = draw.formatClock, el = draw.el;
// Text variables: the server's context (hotel, room, guest, logo, …) plus the clock-driven
// {{time}} and {{date}} computed on the set.
function textContext() { return draw.liveContext(state.context, new Date()); }
// Live data the shared drawers need (lineup, current channel, menu focus, weather).
function drawEnv() {
  return { lineup: state.lineup, currentIndex: currentIndex(), focus: state.focus, weather: state.weather, apps: state.apps,
    units: state.context && state.context.units, videoRect: effectiveVideoRect, preview: false };
}

var RENDERERS = draw.DRAWERS;
function renderChannelList(e, z) { draw.drawChannelList(e, z, textContext(), drawEnv()); }
function renderMenu(e, z) { (z.type === 'apps' ? draw.drawApps : draw.drawMenu)(e, z, textContext(), drawEnv()); }
function renderWeather(e, z) { draw.drawWeather(e, z, textContext(), drawEnv()); }

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
function tickClocks() { draw.tick(stage, state.layout, state.context, new Date()); }

function viewOpts() { return { toggled: state.toggled, fullscreen: state.fullscreen }; }
// {zoneId: true} for everything drawn on the current page (inherited globals included).
function visibleZoneIds() {
  var m = {};
  draw.visibleZones(state.layout || {}, state.page, viewOpts()).forEach(function (z) { m[z.id] = true; });
  return m;
}

function render() {
  var layout = state.layout || {};
  var canvas = layout.canvas || {};
  fitStage(canvas);
  stage.style.background = canvas.background || '#000';
  stage.style.backgroundImage = canvas.backgroundImage ? 'url(' + canvas.backgroundImage + ')' : 'none';
  ensureVideoHost();
  placeOverlays(layout);
  // The video zone is tracked even when the current screen hides it, so placeVideo() can pause
  // instead of tearing the channel down.
  var videoZone = (layout.zones || []).filter(function (z) { return z.type === 'video'; })[0] || null;
  var skipped = draw.renderStage(stage, layout, textContext(), drawEnv(), state.page, viewOpts());
  if (skipped.length) log('zone types not supported: ' + skipped.join(', '));
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClocks, 1000);
  placeVideo(videoZone);
}

// The host starts *without* the url('TV:') hole: on a real set the hole shows whatever the
// tuner plane holds (the last raster) for the second or two before the first HTML5 stream has
// frames. The hole is created only when a tuner channel is actually selected (setHostMode).
function ensureVideoHost() {
  if (videoHost) return videoHost;
  videoHost = el('div', 'videohost');
  videoHost.id = 'videohost';
  videoHost.setAttribute('data-mode', 'idle');
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
// html5 mode keeps the host transparent so the layout background stays visible under the
// <video> until it has frames (the element itself is hidden until 'playing', see ensureVideoEl).
function setHostMode(html5) {
  ensureVideoHost();
  var tvUrl = "url('TV:')";
  if (html5) { videoHost.style.backgroundImage = 'none'; videoHost.style.background = 'transparent'; videoHost.setAttribute('data-mode', 'html5'); }
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
  var shown = !!visibleZoneIds()[z.id];
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
  videoEl.addEventListener('playing', function () { videoEl.setAttribute('data-ready', '1'); if (videoEl.__resolve) videoEl.__resolve(true); });
  videoEl.addEventListener('loadeddata', function () { videoEl.setAttribute('data-ready', '1'); });
  videoEl.addEventListener('emptied', function () { videoEl.removeAttribute('data-ready'); });
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
      v.removeAttribute('data-ready');   // invisible (layout background shows) until it has frames
      v.src = ch.params.url;
      var p = v.play();
      if (p && p.then) p.then(null, function (e) { v.__reject(new Error('play() rejected: ' + (e && e.message))); });
    });
  });
}
function htmlVideoStop() {
  if (!videoEl) return;
  try { videoEl.__resolve = null; videoEl.__reject = null; videoEl.removeAttribute('data-ready'); videoEl.pause(); videoEl.removeAttribute('src'); videoEl.load(); } catch (e) {}
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

// ---------------------------------------------------------------- pages / actions
function homeId() { return model.homePageId(state.layout || {}); }
function gotoPage(id, push) {
  if (!model.pageById(state.layout || {}, id)) return false;
  if (push && state.page && state.page !== id) state.pageStack.push(state.page);
  state.page = id; state.fullscreen = false; state.toggled = {};
  state.focus = { zone: null, index: 0 };
  render();
  sendEvent('page', { page: id });
  return true;
}
function setFullscreen(on) {
  state.fullscreen = !!on;
  state.focus = { zone: null, index: 0 };
  render();
}
// Run an action: a v2 object {type, page|number|app_id|zone}, a flat menu item, or a legacy
// name (show_page, close_page, toggle_menu, …) — actionOf() normalises all of them.
function doAction(action, arg) {
  var a = model.actionOf(typeof action === 'string' && arg && typeof arg === 'object' ? Object.assign({}, arg, { action: action }) : action, homeId());
  if (!a) return;
  switch (a.type) {
    case 'goto_page': gotoPage(a.page, true); break;
    case 'back':
      if (state.fullscreen) setFullscreen(false);
      else if (state.pageStack.length) gotoPage(state.pageStack.pop(), false);
      else if (state.page !== homeId()) gotoPage(homeId(), false);
      else if ((state.layout && state.layout.back_on_home) === 'fullscreen_tv') setFullscreen(true);
      break;
    case 'fullscreen_tv': setFullscreen(!state.fullscreen); break;
    case 'toggle': if (a.zone) { state.toggled[a.zone] = !state.toggled[a.zone]; render(); } break;
    case 'launch_app':
      if (a.app_id) {
        launchApp(a.app_id, arg && arg.params, arg && arg.noSplash, 'launcher').then(null, function (e) { reportError('launch', 'launch ' + a.app_id + ' failed: ' + e.message, { app_id: a.app_id }); });
      }
      break;
    case 'tune': if (a.number != null) { var c = findChannel(a.number); if (c) tuneTo(c); } break;
    case 'reload': window.location.reload(); break;
    default: log('unknown action ' + a.type);
  }
}

// ---------------------------------------------------------------- focus (spatial navigation)
// Targets = every focusable thing on the page: menu items / app tiles (item-level) and
// text/image/button zones that carry an action. Rects are read from the DOM in canvas px.
function stageRect(el) {
  var sr = stage.getBoundingClientRect(), r = el.getBoundingClientRect(), k = state.scale || 1;
  return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k };
}
function focusTargets() {
  var out = [];
  draw.visibleZones(state.layout || {}, state.page, viewOpts()).forEach(function (z) {
    if (!model.isFocusable(z)) return;
    var e = document.getElementById('zone-' + z.id);
    if (!e) return;
    if (model.NAV_ZONE_TYPES.indexOf(z.type) >= 0) {
      var items = e.querySelectorAll('.menuitem, .apptile');
      for (var i = 0; i < items.length; i++) out.push({ zone: z.id, index: i, rect: stageRect(items[i]), zoneObj: z });
    } else out.push({ zone: z.id, index: 0, rect: stageRect(e), zoneObj: z });
  });
  return out;
}
function focusedTarget(targets) {
  for (var i = 0; i < targets.length; i++) if (targets[i].zone === state.focus.zone && targets[i].index === state.focus.index) return i;
  return -1;
}
function setFocus(t) {
  var prev = state.focus;
  state.focus = { zone: t.zone, index: t.index };
  var ids = {}; if (prev && prev.zone) ids[prev.zone] = true; ids[t.zone] = true;
  var layout = state.layout || {};
  for (var id in ids) {
    var z = (layout.zones || []).filter(function (x) { return x.id === id; })[0];
    var e = document.getElementById('zone-' + id);
    if (!z || !e) continue;
    if (model.NAV_ZONE_TYPES.indexOf(z.type) >= 0) renderMenu(e, z);
    else { var fresh = draw.zoneElement(z, textContext(), drawEnv()); if (fresh) e.parentNode.replaceChild(fresh, e); }
  }
}
function moveFocusDir(dir) {
  var targets = focusTargets();
  if (!targets.length) return false;
  var cur = focusedTarget(targets);
  var next = model.spatialNext(targets.map(function (t) { return t.rect; }), cur, dir);
  if (next < 0) return true;   // nothing that way: swallow the key, keep the highlight
  setFocus(targets[next]);
  return true;
}
function moveFocus(delta) { return moveFocusDir(delta < 0 ? 'up' : 'down'); }   // kept for tests / legacy callers
function menuItems(z) { return z.type === 'apps' ? draw.appItemsOf(z, drawEnv()) : draw.menuItemsOf(z); }
function activateFocus() {
  var targets = focusTargets();
  var i = focusedTarget(targets);
  if (i < 0) { if (targets.length) setFocus(targets[model.spatialNext(targets.map(function (t) { return t.rect; }), -1, 'down')]); return targets.length > 0; }
  var t = targets[i];
  if (model.NAV_ZONE_TYPES.indexOf(t.zoneObj.type) >= 0) { var it = menuItems(t.zoneObj)[t.index]; if (!it) return false; doAction(it); }
  else doAction(t.zoneObj.action);
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
  else if (name === 'NETFLIX') launchApp('netflix', null, undefined, 'hotkey').then(null, function (e) { reportError('launch', 'netflix hot key: ' + e.message, { app_id: 'netflix' }); });
  else if (keys[name]) doAction(keys[name]);
  else if (name === 'PORTAL' || name === 'GUIDE') doAction({ type: 'fullscreen_tv' });
  else if (name === 'BACK' || name === 'EXIT') doAction({ type: 'back' });
  else if (name === 'UP') handled = moveFocusDir('up');
  else if (name === 'DOWN') handled = moveFocusDir('down');
  else if (name === 'LEFT') handled = moveFocusDir('left');
  else if (name === 'RIGHT') handled = moveFocusDir('right');
  else if (name === 'ENTER') handled = activateFocus();
  else handled = false;
  if (handled) { ev.preventDefault(); ev.stopPropagation(); }
}

// ---------------------------------------------------------------- state from server
function applyLayout(layout, ctx, force, openOn) {
  if (ctx) state.context = ctx;
  var json = JSON.stringify(layout) + JSON.stringify(state.context);
  if (!force && json === state.layoutJson) return;
  state.layoutJson = json;
  state.layout = model.upgradeLayout(layout || {}) || {};
  if (openOn && model.pageById(state.layout, openOn)) { state.page = openOn; state.pageStack = []; state.fullscreen = false; }
  else if (!model.pageById(state.layout, state.page)) { state.page = model.homePageId(state.layout); state.pageStack = []; state.fullscreen = false; }
  state.toggled = {};
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
function applyApps(apps) {
  var next = apps || [];
  if (JSON.stringify(next) === JSON.stringify(state.apps)) return;
  state.apps = next;
  log('apps: ' + state.apps.length + ' enabled');
  var els = stage.querySelectorAll('[data-apps]');
  for (var i = 0; i < els.length; i++) {
    var id = els[i].getAttribute('data-zone-id');
    var z = ((state.layout && state.layout.zones) || []).filter(function (x) { return x.id === id; })[0];
    if (z) draw.drawApps(els[i], z, textContext(), drawEnv());
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
  if (data.apps) applyApps(data.apps);
  if (data.poll_interval_s) state.pollInterval = Math.max(10, Number(data.poll_interval_s));
  if (data.commands && data.commands.length) data.commands.forEach(function (c) { runCommand(c, ackViaHttp); });
  if (data.ws_url && !state.ws) { state.wsUrl = data.ws_url; connectWs(); }
  if (data.activation !== undefined) { state.activation = data.activation || null; bootRegisterApps(); }
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
        // LG wipes the guest's app data (tv/checkout/request); we drop our own state and reload
        // the app (docs/PHASE3.md Part C) so nothing of the guest survives in memory either.
        // The checkout message is shown after the reload (kept in localStorage for that only).
        r = tv.checkout().then(null, function (e) { log('platform checkout failed: ' + e.message); }).then(function () {
          try { localStorage.clear(); if (p.message) localStorage.setItem('cc_checkout_note', String(p.message)); } catch (e) {}
          state.lastChannel = null; state.prevChannel = null;
          sendEvent('checkout', { reload: true });
          setTimeout(function () { tv.reloadApp(); }, 1500);
          return { checkout: true, reload: true };
        });
        break;
      case 'launch_app': r = launchApp(p.app_id, p.params, p.noSplash, 'launcher').then(function (sent) { return { app_id: p.app_id, params: sent }; }); break;
      case 'register_apps': r = registerAndRefresh(p).then(function (res) { if (res.ok === false) throw new Error('registration failed: ' + JSON.stringify(res.result)); return res; }); break;
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
      applyLayout(msg.layout, msg.context || state.context, !!msg.preview, msg.page || null);
      if (msg.preview) log('preview layout from admin');
      break;
    case 'lineup': applyLineup(msg.lineup); break;
    case 'messages': applyMessages(msg.messages); break;
    case 'apps': applyApps(msg.apps); break;
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
    .then(function () { return tv.getPowerMode(); }).then(function (pm) { state.powerMode = pm; })
    .then(function () { return tv.getServiceCountry(); }).then(function (sc) { state.serviceCountry = sc; if (sc != null) log('service country: ' + JSON.stringify(sc)); });
}
// Another app (Netflix…) in front: stop our picture so it does not fight the app's; when we
// are back, resume where we were and claim the remote keys again (LG hands them to the app).
function pauseForBackground() {
  if (!state.channel || state.videoPaused) return;
  state.videoPaused = true;
  if (isUrlChannel(state.channel)) { if (state.mediaMode === 'html5' && videoEl) { try { videoEl.pause(); } catch (e) {} } else if (state.api) tv.platformMediaStop().then(null, function () {}); }
  else if (state.api) tv.channelStop().then(null, function (e) { reportError('channel_stop', e.message); });
  log('hidden: video paused');
}
function resumeFromBackground() {
  var away = state.hiddenAt ? Math.round((Date.now() - state.hiddenAt) / 1000) : null;
  state.hiddenAt = null;
  var p = state.api ? tv.claimKeys(CLAIMED_KEYS, 1).then(function () { log('keys re-claimed'); }, function (e) { reportError('keys', 'claim after app: ' + e.message); }) : Promise.resolve();
  p.then(function () {
    if (state.videoPaused && state.channel) {
      var z = ((state.layout && state.layout.zones) || []).filter(function (x) { return x.type === 'video'; })[0];
      if (z) placeVideo(z); else state.videoPaused = false;
    }
    sendEvent('visibility', { hidden: false, resumed: true, away_s: away });
  });
}
function preparePlatform() {
  // Claim the keys the lineup needs; leave VOL/MUTE with the TV firmware. Then make sure the
  // set is on the TV input so no external-input OSD covers the layout.
  return tv.claimKeys(CLAIMED_KEYS, 1).then(function () { log('keys claimed: ' + CLAIMED_KEYS.length); }, function () {}).then(ensureTvInput).then(readAppList);
}
function readAppList() {
  return tv.listApps().then(function (r) {
    state.appsReported = r || null;
    var n = Array.isArray(r) ? r.length : (r && (r.list || r.applications || r.apps || r.appList) ? (r.list || r.applications || r.apps || r.appList).length : '?');
    log('application/list: ' + n + ' entries');
  }, function (e) { log('application/list failed: ' + e.message); state.appsReported = null; }).then(readAppStatus);
}
// App ids out of whatever shape application/list returned.
function reportedAppIds() {
  var r = state.appsReported;
  var arr = Array.isArray(r) ? r : (r && (r.list || r.applications || r.apps || r.appList)) || [];
  var ids = [];
  arr.forEach(function (a) { var id = typeof a === 'string' ? a : a && (a.id || a.appId || a.app_id); if (id && ids.indexOf(id) < 0) ids.push(id); });
  return ids.slice(0, 100);
}
// application/register/status per discovered app → state.appsStatus {id: raw}. Sequential, best effort.
function readAppStatus() {
  var ids = reportedAppIds();
  if (!ids.length || state.api !== 'idcap') { state.appsStatus = null; return Promise.resolve(null); }
  var out = {};
  var p = Promise.resolve();
  ids.forEach(function (id) { p = p.then(function () { return tv.appRegisterStatus(id).then(function (r) { if (r != null) out[id] = r; }, function (e) { out[id] = { error: e.message }; }); }); });
  return p.then(function () { state.appsStatus = out; log('application/register/status: ' + Object.keys(out).length + ' apps'); return out; });
}
// After a registration: re-read the status and tell the server (it hides un-activated apps).
function refreshAppStatus() {
  return readAppStatus().then(function (st) { if (st) sendEvent('apps_status', { status: st }); return st; });
}
// register_apps command: application/register + wait for application_registration_result_received.
function registerApps(payload) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; resolve({ ok: null, result: { timeout: true } }); } }, 20000);
    var onResult = function (ev) {
      if (done) return; done = true; clearTimeout(t);
      // LG (docs/lg/netflix.md): p.id, p.tokenResult (boolean), p.errorMessage. Older/other shapes kept.
      var r = {}; ['tokenResult', 'result', 'status', 'errorMessage', 'id', 'tokenList', 'accountNumber', 'detail'].forEach(function (k) { if (ev && ev[k] !== undefined) r[k] = ev[k]; });
      var ok = ev && (ev.tokenResult === true || ev.result === true || ev.result === 'success' || ev.status === 'success' || ev.status === 'registered') ? true
        : (ev && (ev.tokenResult === false || ev.result === false || ev.errorMessage) ? false : null);
      resolve({ ok: ok, result: r });
    };
    tv.on('application_registration_result_received', onResult);
    tv.registerApps(payload).then(null, function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}
// Registration + status refresh shared by the register_apps command and the boot path.
function registerAndRefresh(payload) {
  if (state.registering) return Promise.reject(new Error('registration already in progress'));
  state.registering = true;
  var done = function () { state.registering = false; };
  return registerApps(payload).then(function (res) {
    sendEvent('apps_registration', { ok: res.ok, result: res.result });
    // controlled apps only appear in application/list once registered → re-read the list too
    return readAppList().then(function () {
      if (state.appsReported) sendEvent('apps_list', { apps: state.appsReported });
      if (state.appsStatus) sendEvent('apps_status', { status: state.appsStatus });
      done(); return res;
    });
  }, function (e) { done(); throw e; });
}
// Does the raw register/status reply say "not authorised"? Mirrors the server's normalizeAuth.
function statusActivated(raw) {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw;
  var v = null;
  if (typeof raw === 'string' || typeof raw === 'number') v = String(raw);
  else if (typeof raw === 'object') {
    var keys = ['auth', 'auth_status', 'authStatus', 'status', 'registered', 'activated', 'activation', 'result', 'state', 'value'];
    for (var i = 0; i < keys.length; i++) { if (raw[keys[i]] !== undefined && raw[keys[i]] !== null) { v = raw[keys[i]]; break; } }
    if (typeof v === 'boolean') return v;
    if (v == null) return null; v = String(v);
  }
  if (/^(unregist|not|un|fail|deni|invalid|error|no$)/i.test(v)) return false;
  if (/^(regist|authori|ok|success|valid|activ|true|yes|1$)/i.test(v)) return true;
  return null;
}
// Boot activation (docs/lg/netflix.md): the state payload carries every licence token on file
// (+ the tenant's account number). If any token's app is missing from application/list or its
// register/status is not authorised, register them all once per boot. The register_apps command
// (queued by the server for sets without a successful registration) is the same path.
function bootRegisterApps() {
  var a = state.activation;
  if (!a || state.bootRegistered || state.registering || state.api !== 'idcap') return;
  var tokens = Array.isArray(a.tokenList) ? a.tokenList : [];
  if (!tokens.length && !a.accountNumber) return;
  var ids = reportedAppIds(), st = state.appsStatus || {};
  var need = tokens.filter(function (t) { return t && t.id && (ids.indexOf(t.id) < 0 || statusActivated(st[t.id]) === false); }).map(function (t) { return t.id; });
  if (!need.length) { state.bootRegistered = true; return; }
  state.bootRegistered = true;
  log('registering app licences at boot: ' + need.join(','));
  registerAndRefresh(a).then(function (res) { log('boot registration ' + (res.ok === false ? 'FAILED' : 'done')); if (res.ok === false) reportError('app_registration', 'licence registration failed: ' + JSON.stringify(res.result), { apps: need }); },
    function (e) { reportError('app_registration', 'licence registration: ' + e.message, { apps: need }); });
}
// Launch an app with LG's parameters. Netflix (docs/lg/netflix.md) needs the tenant's hotel id and
// a reason: 'launcher' (tile/menu/command), 'hotKey' (remote key while ON), 'boot' with
// params.reason 'netflix' (remote key while the set is in WARM standby). Other apps: as given.
function netflixParams(reason) {
  var hotel = state.context && state.context.netflix_hotel_id;
  var inner = { hotel_id: hotel, launcher_version: NETFLIX_LAUNCHER_VERSION };
  if (reason === 'boot') inner.reason = 'netflix';
  return { reason: reason, params: inner };
}
function launchApp(appId, params, noSplash, source) {
  sendEvent('app', { kind: 'launch', app_id: appId, source: source || 'launcher' });
  if (appId !== 'netflix') return tv.launchApp(appId, params, noSplash).then(function () { return params || {}; });
  if (!(state.context && state.context.netflix_hotel_id)) {
    showPopup('Netflix is not enabled for this hotel', 6);
    return Promise.reject(new Error('netflix_hotel_id not set for this tenant (Settings → Netflix hotel id)'));
  }
  var mode = source === 'hotkey' ? tv.getPowerMode().then(function (pm) { return pm; }, function () { return state.powerMode; }) : Promise.resolve(null);
  return mode.then(function (pm) {
    if (pm) state.powerMode = pm;
    var reason = source === 'hotkey' ? (/warm/i.test(String(pm || state.powerMode || '')) ? 'boot' : 'hotKey') : 'launcher';
    var sent = params && params.reason ? params : netflixParams(reason);
    // LG's own example launches Netflix with noSplash false
    return tv.launchApp('netflix', sent, noSplash === undefined ? false : noSplash).then(function () { return sent; });
  });
}
function boot() {
  fitStage({ w: 1920, h: 1080 });
  showStatus(true);
  log('CoopCentric renderer ' + APP_VERSION + ' — detecting platform…');
  try { state.lastChannel = Number(localStorage.getItem('cc_last_channel')) || null; state.prevChannel = state.lastChannel; } catch (e) {}
  try { var note = localStorage.getItem('cc_checkout_note'); if (note) { localStorage.removeItem('cc_checkout_note'); setTimeout(function () { showPopup(note, 20); }, 1500); } } catch (e) {}
  document.addEventListener('keydown', onKeyDown, true);
  tv.on('channel_changed', function (ev) { if (ev && ev.result === false) reportError('channel_changed', ev.errorMessage || 'failed'); });
  ['play_error', 'media_error', 'media_play_error'].forEach(function (n) { tv.on(n, function (ev) { reportError('media_event', n + ': ' + ((ev && (ev.errorMessage || ev.message)) || JSON.stringify(ev && ev.detail || {}))); }); });
  ['play_start', 'play_end', 'buffering_start', 'buffering_end', 'network_changed', 'checkout'].forEach(function (n) { tv.on(n, function () { sendEvent('platform', { kind: n }); }); });
  window.addEventListener('error', function (e) { reportError('js', (e && e.message) || 'script error', { source: e && e.filename, line: e && e.lineno }); });
  tv.on('power_mode_changed', function (ev) { state.powerMode = ev && ev.mode ? String(ev.mode) : state.powerMode; sendEvent('power', { mode: state.powerMode }); });
  document.addEventListener('visibilitychange', function () {
    sendEvent('visibility', { hidden: !!document.hidden });
    if (document.hidden) { state.hiddenAt = Date.now(); pauseForBackground(); }
    else resumeFromBackground();
  });
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
window.__cc = { state: state, tuneTo: tuneTo, findChannel: findChannel, render: render, doAction: doAction, focusTargets: focusTargets, zoneTypes: Object.keys(RENDERERS) };
