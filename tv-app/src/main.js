// CoopCentric TV renderer v0.
// Boot: detect API (IDCAP probe, HCAP fallback) → read set properties → POST /api/tv/register
// on our own tenant hostname → draw the returned layout (text / image / clock zones) → poll
// /api/tv/poll every poll_interval_s and redraw when the layout changes. Everything is
// same-origin, so relative URLs. ES2015 only; no fetch (older HCAP sets), XHR instead.
/* global hcap, idcap, __APP_VERSION__ */

var APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
var PROPERTY_KEYS = ['serial_number', 'model_name', 'platform_version', 'firmware_version', 'webos_version', 'idpn', 'room_number'];
var PROBE_TIMEOUT_MS = 4000;
var REGISTER_RETRY_MS = [5000, 10000, 20000, 30000];

var stage = document.getElementById('stage');
var statusEl = document.getElementById('status');
var state = { api: null, props: {}, setId: null, token: null, layoutJson: null, context: {}, pollInterval: 60, pollTimer: null, clockTimer: null,
  ws: null, wsUrl: null, wsBackoff: 0, wsTimer: null, hbTimer: null, bootTime: Date.now() };

// ---------------------------------------------------------------- logging
function log(msg) {
  try { console.log('[coopcentric] ' + msg); } catch (e) {}
  statusEl.textContent = (statusEl.textContent + '\n' + msg).split('\n').slice(-6).join('\n');
}
function showStatus(on) { statusEl.className = on ? 'show' : ''; }

// ---------------------------------------------------------------- platform access
function withTimeout(ms, run, fail) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; fail('timeout'); } }, ms);
  try {
    run(function () { if (!done) { done = true; clearTimeout(t); return true; } return false; });
  } catch (e) {
    if (!done) { done = true; clearTimeout(t); fail('threw: ' + (e && e.message)); }
  }
}

function probeIdcap(ok, fail) {
  if (typeof idcap === 'undefined') { fail('idcap.js not loaded'); return; }
  withTimeout(PROBE_TIMEOUT_MS, function (settle) {
    idcap.request('idcap://configuration/property/get', {
      parameters: { key: 'idpn' },
      onSuccess: function (cb) { if (settle()) ok(cb); },
      onFailure: function (e) { if (settle()) fail('idcap error: ' + (e && e.errorMessage)); }
    });
  }, fail);
}

function probeHcap(ok, fail) {
  if (typeof hcap === 'undefined') { fail('hcap.js not loaded'); return; }
  withTimeout(PROBE_TIMEOUT_MS, function (settle) {
    hcap.property.getProperty({
      key: 'model_name',
      onSuccess: function (s) { if (settle()) ok(s); },
      onFailure: function (f) { if (settle()) fail('hcap error: ' + (f && f.errorMessage)); }
    });
  }, fail);
}

function getProperty(key) {
  return new Promise(function (resolve) {
    var t = setTimeout(function () { resolve(null); }, PROBE_TIMEOUT_MS);
    var done = function (v) { clearTimeout(t); resolve(v === undefined ? null : v); };
    try {
      if (state.api === 'idcap') {
        idcap.request('idcap://configuration/property/get', { parameters: { key: key },
          onSuccess: function (cb) { done(cb && cb.value); }, onFailure: function () { done(null); } });
      } else {
        hcap.property.getProperty({ key: key,
          onSuccess: function (s) { done(s && s.value); }, onFailure: function () { done(null); } });
      }
    } catch (e) { done(null); }
  });
}

function setProperty(key, value) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('timeout')); }, PROBE_TIMEOUT_MS);
    var ok = function () { clearTimeout(t); resolve(true); };
    var bad = function (e) { clearTimeout(t); reject(new Error((e && e.errorMessage) || 'failed')); };
    try {
      if (state.api === 'idcap') {
        idcap.request('idcap://configuration/property/set', { parameters: { key: key, value: String(value) }, onSuccess: ok, onFailure: bad });
      } else if (state.api === 'hcap') {
        hcap.property.setProperty({ key: key, value: String(value), onSuccess: ok, onFailure: bad });
      } else { clearTimeout(t); reject(new Error('no platform')); }
    } catch (e) { bad(e); }
  });
}

function readProperties() {
  var p = Promise.resolve();
  PROPERTY_KEYS.forEach(function (k) {
    p = p.then(function () { return getProperty(k).then(function (v) { state.props[k] = v; }); });
  });
  return p;
}

function detectApi() {
  return new Promise(function (resolve) {
    probeIdcap(function () { resolve('idcap'); }, function (why) {
      log(why + ' → trying HCAP');
      probeHcap(function () { resolve('hcap'); }, function (why2) { log(why2); resolve(null); });
    });
  });
}

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

function register() {
  var body = { api: state.api, app_version: APP_VERSION };
  PROPERTY_KEYS.forEach(function (k) { body[k] = state.props[k]; });
  return request('POST', '/api/tv/register', body);
}

function poll() {
  return request('GET', '/api/tv/poll?set_id=' + encodeURIComponent(state.setId) + '&token=' + encodeURIComponent(state.token));
}

// ---------------------------------------------------------------- rendering
function fitStage(canvas) {
  var w = (canvas && canvas.w) || 1920, h = (canvas && canvas.h) || 1080;
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  var sx = window.innerWidth / w, sy = window.innerHeight / h;
  var s = Math.min(sx, sy) || 1;
  stage.style.transform = 'scale(' + s + ')';
  stage.style.left = Math.floor((window.innerWidth - w * s) / 2) + 'px';
  stage.style.top = Math.floor((window.innerHeight - h * s) / 2) + 'px';
}

function substitute(text, ctx) {
  return String(text == null ? '' : text).replace(/\{\{\s*(\w+)\s*\}\}/g, function (_, k) {
    return ctx[k] == null ? '' : ctx[k];
  });
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
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function formatClock(fmt, d) {
  var h24 = d.getHours(), h12 = h24 % 12 || 12;
  return (fmt || 'HH:mm')
    .replace('HH', pad2(h24)).replace('hh', pad2(h12)).replace('mm', pad2(d.getMinutes()))
    .replace('ss', pad2(d.getSeconds())).replace('a', h24 < 12 ? 'AM' : 'PM')
    .replace('DD', pad2(d.getDate())).replace('MM', pad2(d.getMonth() + 1)).replace('YYYY', d.getFullYear());
}

var RENDERERS = {
  text: function (el, z, ctx) { el.textContent = substitute(z.text, ctx); },
  image: function (el, z) {
    var img = document.createElement('img');
    img.src = z.src || '';
    img.alt = '';
    if (z.fit) img.style.objectFit = z.fit;
    el.appendChild(img);
  },
  clock: function (el, z) {
    el.setAttribute('data-clock', z.format || 'HH:mm');
    el.textContent = formatClock(z.format, new Date());
  }
};

function tickClocks() {
  var els = stage.querySelectorAll('[data-clock]');
  var now = new Date();
  for (var i = 0; i < els.length; i++) els[i].textContent = formatClock(els[i].getAttribute('data-clock'), now);
}

function render(layout, ctx) {
  layout = layout || {};
  var canvas = layout.canvas || {};
  fitStage(canvas);
  stage.style.background = canvas.background || '#000';
  if (canvas.backgroundImage) stage.style.backgroundImage = 'url(' + canvas.backgroundImage + ')';
  else stage.style.backgroundImage = 'none';
  while (stage.firstChild) stage.removeChild(stage.firstChild);

  var zones = layout.zones || [];
  var visible = null;
  if (layout.screens && layout.screens.length) {
    var home = null;
    for (var i = 0; i < layout.screens.length; i++) if (layout.screens[i].id === 'home') home = layout.screens[i];
    home = home || layout.screens[0];
    visible = {};
    (home.zones || []).forEach(function (id) { visible[id] = true; });
  }
  var skipped = [];
  zones.forEach(function (z) {
    if (z.hidden) return;
    if (visible && !visible[z.id]) return;
    var fn = RENDERERS[z.type];
    if (!fn) { skipped.push(z.type); return; }
    var el = document.createElement('div');
    el.className = 'zone zone-' + z.type;
    el.id = 'zone-' + z.id;
    el.style.left = (z.x || 0) + 'px'; el.style.top = (z.y || 0) + 'px';
    el.style.width = (z.w || 0) + 'px'; el.style.height = (z.h || 0) + 'px';
    applyStyle(el, z.style);
    fn(el, z, ctx);
    stage.appendChild(el);
  });
  if (skipped.length) log('zone types not supported by renderer v0: ' + skipped.join(', '));
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClocks, 1000);
}

function applyLayout(layout, ctx, force) {
  if (ctx) state.context = ctx;
  var json = JSON.stringify(layout) + JSON.stringify(state.context);
  if (force || json !== state.layoutJson) {
    state.layoutJson = json;
    render(layout, state.context);
    log('layout: ' + ((layout && layout.name) || '?') + (layout && layout.version ? ' v' + layout.version : ''));
  }
}

function applyState(data) {
  if (data.context) state.context = data.context;
  else state.context = { hotel: '', room: data.room_number || '', guest: '', serial: state.props.serial_number || '' };
  applyLayout(data.layout, state.context);
  if (data.poll_interval_s) state.pollInterval = Math.max(10, Number(data.poll_interval_s));
  if (data.commands && data.commands.length) data.commands.forEach(function (c) { runCommand(c, ackViaHttp); });
  if (data.ws_url && !state.ws) { state.wsUrl = data.ws_url; connectWs(); }
}

// ---------------------------------------------------------------- commands
function runCommand(cmd, ack) {
  var p;
  try {
    switch (cmd.type) {
      case 'set_property':
        p = setProperty(cmd.payload.key, cmd.payload.value).then(function () {
          if (cmd.payload.key === 'room_number') state.props.room_number = cmd.payload.value;
          return { key: cmd.payload.key };
        });
        break;
      case 'reload_app':
        p = Promise.resolve({ reloading: true });
        setTimeout(function () { window.location.reload(); }, 500);
        break;
      default:
        p = Promise.reject(new Error('unsupported command ' + cmd.type));
    }
  } catch (e) { p = Promise.reject(e); }
  p.then(function (result) { log('command ' + cmd.type + ' ok'); ack(cmd.id, true, result); },
         function (err) { log('command ' + cmd.type + ' failed: ' + err.message); ack(cmd.id, false, { error: err.message }); });
}
function ackViaHttp(id, ok, result) {
  request('POST', '/api/tv/ack?set_id=' + encodeURIComponent(state.setId) + '&token=' + encodeURIComponent(state.token), { command_id: id, ok: ok, result: result })
    .then(null, function () {});
}
function ackViaWs(id, ok, result) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'ack', command_id: id, ok: ok, result: result }));
  else ackViaHttp(id, ok, result);
}

// ---------------------------------------------------------------- websocket
function heartbeatPayload() {
  return { type: 'hb', uptime: Math.floor((Date.now() - state.bootTime) / 1000), channel: state.channel || null,
    volume: null, muted: null, power_mode: state.powerMode || null, app_version: APP_VERSION };
}
function connectWs() {
  if (!state.wsUrl || typeof WebSocket === 'undefined') return;
  if (state.wsTimer) { clearTimeout(state.wsTimer); state.wsTimer = null; }
  var proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  var url = proto + window.location.host + state.wsUrl + '?set_id=' + encodeURIComponent(state.setId) + '&token=' + encodeURIComponent(state.token);
  var ws;
  try { ws = new WebSocket(url); } catch (e) { log('ws error: ' + e.message); scheduleWsReconnect(); return; }
  state.ws = ws;
  ws.onopen = function () {
    state.wsBackoff = 0;
    log('ws connected');
    ws.send(JSON.stringify(heartbeatPayload()));
    if (state.hbTimer) clearInterval(state.hbTimer);
    state.hbTimer = setInterval(function () { if (ws.readyState === 1) ws.send(JSON.stringify(heartbeatPayload())); }, 60000);
  };
  ws.onmessage = function (ev) {
    var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    onWsMessage(msg);
  };
  ws.onclose = function (ev) {
    if (state.ws === ws) state.ws = null;
    if (state.hbTimer) { clearInterval(state.hbTimer); state.hbTimer = null; }
    if (ev && ev.code === 4000) { log('ws replaced by another connection'); return; }
    log('ws closed' + (ev && ev.code ? ' (' + ev.code + ')' : ''));
    scheduleWsReconnect();
  };
  ws.onerror = function () { /* onclose follows */ };
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
    case 'lineup': state.lineup = msg.lineup || []; break;
    case 'messages': state.messages = msg.messages || []; break;
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

function boot() {
  fitStage({ w: 1920, h: 1080 });
  showStatus(true);
  log('CoopCentric renderer ' + APP_VERSION + ' — detecting platform…');
  detectApi().then(function (api) {
    state.api = api;
    if (!api) {
      log('no LG middleware answered; running in browser mode');
      return Promise.resolve();
    }
    log('API: ' + api.toUpperCase());
    return readProperties();
  }).then(function () {
    if (!state.props.serial_number) {
      // Browser/dev mode: only register when a serial is given explicitly (?serial=TEST), so
      // opening the URL on a laptop does not create phantom sets in admin.
      var m = /[?&]serial=([^&]+)/.exec(window.location.search || '');
      if (m) { state.props.serial_number = decodeURIComponent(m[1]); state.props.model_name = state.props.model_name || 'browser'; }
      else { render(localLayout('No LG middleware and no ?serial=… given.\nOpen this page on a Pro:Centric set, or add ?serial=TEST to simulate one.'), {}); return; }
    }
    log('serial ' + (state.props.serial_number || '?') + ' · ' + (state.props.model_name || '?'));
    registerLoop(0);
  });
}

function localLayout(text) {
  return { schema: 1, name: 'local', canvas: { w: 1920, h: 1080, background: '#0b1a2a' }, zones: [
    { id: 't', type: 'text', x: 120, y: 200, w: 1680, h: 100, text: 'CoopCentric ' + APP_VERSION, style: { fontSize: 56, fontWeight: 'bold', color: '#fff' } },
    { id: 'm', type: 'text', x: 120, y: 340, w: 1680, h: 300, text: text, style: { fontSize: 34, color: '#8fb3c9' } },
    { id: 'c', type: 'clock', x: 1560, y: 980, w: 260, h: 60, format: 'HH:mm:ss', style: { fontSize: 40, color: '#fff', align: 'right' } } ] };
}

window.addEventListener('resize', function () {
  try { fitStage(JSON.parse(state.layoutJson || '{}').canvas); } catch (e) {}
});
document.addEventListener('DOMContentLoaded', boot);
