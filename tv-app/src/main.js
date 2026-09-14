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
var state = { api: null, props: {}, setId: null, token: null, layoutJson: null, pollInterval: 60, pollTimer: null, clockTimer: null };

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

function applyState(data) {
  var ctx = {
    hotel: (data.layout && data.layout.hotel) || '',
    room: data.room_number || state.props.room_number || '',
    guest: '',
    serial: state.props.serial_number || ''
  };
  var json = JSON.stringify(data.layout);
  if (json !== state.layoutJson) {
    state.layoutJson = json;
    render(data.layout, ctx);
    log('layout: ' + ((data.layout && data.layout.name) || '?'));
  }
  if (data.poll_interval_s) state.pollInterval = Math.max(10, Number(data.poll_interval_s));
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
