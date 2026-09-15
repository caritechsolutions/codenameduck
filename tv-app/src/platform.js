// Platform adapter: one API over LG's IDCAP (idcap.js, webOS 5+) and HCAP (hcap.js) libraries.
// Mechanics follow LG's sample apps (docs/lg-samples, docs/RENDERER-NOTES.md):
//  - live video is shown through an element with background-image:url('TV:'), positioned with
//    video/size/set AFTER the channel_changed event reports success
//  - URL streams (HLS/MP4/RTSP) use the media path: startup → create → control play;
//    stop → destroy → shutdown before tuning a channel again
//  - keys are claimed per virtual keycode with system/key/add (attribute 1 = app gets it)
/* global idcap, hcap */

var TIMEOUT_MS = 4000;
var TUNE_TIMEOUT_MS = 12000;

// LG key codes (same table for HCAP and IDCAP; verified against hcap.key.Code).
export var KEY = {
  NUM_0: 0x30, NUM_1: 0x31, NUM_2: 0x32, NUM_3: 0x33, NUM_4: 0x34, NUM_5: 0x35, NUM_6: 0x36, NUM_7: 0x37, NUM_8: 0x38, NUM_9: 0x39,
  LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, ENTER: 0x0D,
  CH_UP: 0x1AB, CH_DOWN: 0x1AC, VOL_UP: 0x1BF, VOL_DOWN: 0x1C0, MUTE: 0x1C1,
  BACK: 0x1CD, EXIT: 0x3E9, INFO: 0x1C9, GUIDE: 0x1CA, PORTAL: 0x25A, MENU: 0x12, SETTINGS: 0x263,
  RED: 0x193, GREEN: 0x194, YELLOW: 0x195, BLUE: 0x196,
  PLAY: 0x19F, PAUSE: 0x13, STOP: 0x19D, REWIND: 0x19C, FAST_FORWARD: 0x1A1, LAST_CH: 0x2C7, TV: 0x2DA, SMART_HOME: 0x2DE
};
export var KEY_NAME = {};
Object.keys(KEY).forEach(function (k) { KEY_NAME[KEY[k]] = k; });

// HCAP enum mappings for the string values we store in channel params.
var HCAP_RF = { terrestrial: 16, terrestrial_2: 17, satellite: 32, satellite_2: 33, satellite_cs1: 34, satellite_cs2: 35, satellite_s3_bs: 36, satellite_s3_cs: 37, cable: 48, cable_2: 49 };
var HCAP_IP = { udp: 16, rtp: 32 };

var api = null;          // 'idcap' | 'hcap' | null
var listeners = {};
var mediaActive = false;
var hcapMedia = null;

function emit(name, arg) { (listeners[name] || []).forEach(function (fn) { try { fn(arg); } catch (e) { /* listener error */ } }); }
export function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
export function getApi() { return api; }

function withTimeout(ms, run, resolve, reject) {
  var done = false;
  var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
  var ok = function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } };
  var bad = function (e) { if (!done) { done = true; clearTimeout(t); reject(new Error((e && e.errorMessage) || (e && e.message) || 'failed')); } };
  try { run(ok, bad); } catch (e) { bad(e); }
}

// Generic call: IDCAP uri + params, or HCAP fn(params-with-callbacks).
function idcapCall(uri, params, ms) {
  return new Promise(function (resolve, reject) {
    withTimeout(ms || TIMEOUT_MS, function (ok, bad) {
      idcap.request(uri, { parameters: params || {}, onSuccess: ok, onFailure: bad });
    }, resolve, reject);
  });
}
function hcapCall(fn, params, ms) {
  return new Promise(function (resolve, reject) {
    withTimeout(ms || TIMEOUT_MS, function (ok, bad) {
      if (typeof fn !== 'function') { bad(new Error('not available in hcap.js')); return; }
      var p = {}; Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
      p.onSuccess = ok; p.onFailure = bad;
      fn(p);
    }, resolve, reject);
  });
}

export function detect() {
  return new Promise(function (resolve) {
    var tryHcap = function () {
      if (typeof hcap === 'undefined') { api = null; resolve(null); return; }
      hcapCall(hcap.property.getProperty, { key: 'model_name' }).then(function () { api = 'hcap'; wireEvents(); resolve('hcap'); }, function () { api = null; resolve(null); });
    };
    if (typeof idcap === 'undefined') { tryHcap(); return; }
    idcapCall('idcap://configuration/property/get', { key: 'idpn' }).then(function () { api = 'idcap'; wireEvents(); resolve('idcap'); }, tryHcap);
  });
}

function wireEvents() {
  var prefix = api === 'idcap' ? 'idcap::' : '';
  ['channel_changed', 'play_start', 'play_end', 'play_error', 'seek_done', 'buffering_start', 'buffering_end',
   'media_error', 'media_play_error', 'power_mode_changed', 'checkout', 'network_changed'].forEach(function (name) {
    document.addEventListener(prefix + name, function (ev) { emit(name, ev); }, false);
  });
}

export function getProperty(key) {
  var p = api === 'idcap' ? idcapCall('idcap://configuration/property/get', { key: key }) : hcapCall(hcap.property.getProperty, { key: key });
  return p.then(function (r) { return r && r.value !== undefined ? r.value : null; }, function () { return null; });
}
export function setProperty(key, value) {
  return api === 'idcap' ? idcapCall('idcap://configuration/property/set', { key: key, value: String(value) })
    : hcapCall(hcap.property.setProperty, { key: key, value: String(value) });
}

// ------------------------------------------------------------------ video / tuning
export function setVideoSize(rect) {
  var p = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  return api === 'idcap' ? idcapCall('idcap://video/size/set', p) : hcapCall(hcap.video.setVideoSize, p);
}

function channelParams(ch) {
  var p = ch.params || {};
  if (ch.type === 'rf') {
    var rf = { channelType: 'rf', frequency: Number(p.frequency), programNumber: Number(p.programNumber), rfBroadcastType: p.rfBroadcastType };
    ['majorNumber', 'minorNumber', 'satelliteId', 'polarization', 'symbolRate', 'modulation'].forEach(function (k) { if (p[k] !== undefined && p[k] !== null && p[k] !== '') rf[k] = p[k]; });
    if (api === 'hcap') { rf.channelType = hcap.channel.ChannelType.RF; rf.rfBroadcastType = HCAP_RF[p.rfBroadcastType] || hcap.channel.RfBroadcastType.TERRESTRIAL; }
    return rf;
  }
  var ip = { channelType: 'ip', ip: p.ip, port: Number(p.port), ipBroadcastType: p.ipBroadcastType || 'udp' };
  if (api === 'hcap') { ip.channelType = hcap.channel.ChannelType.IP; ip.ipBroadcastType = HCAP_IP[p.ipBroadcastType] || hcap.channel.IpBroadcastType.UDP; }
  return ip;
}

// Resolves when channel_changed reports success (LG async rule), or rejects.
function requestChannel(params) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; off(); reject(new Error('channel change timeout')); } }, TUNE_TIMEOUT_MS);
    var handler = function (ev) {
      if (done) return;
      done = true; clearTimeout(t); off();
      if (ev && ev.result === false) reject(new Error('channel_changed: ' + (ev.errorMessage || 'failed'))); else resolve(ev);
    };
    var name = (api === 'idcap' ? 'idcap::' : '') + 'channel_changed';
    var off = function () { document.removeEventListener(name, handler, false); };
    document.addEventListener(name, handler, false);
    var req = api === 'idcap' ? idcapCall('idcap://tv/channel/change/request', params, TUNE_TIMEOUT_MS) : hcapCall(hcap.channel.requestChangeCurrentChannel, params, TUNE_TIMEOUT_MS);
    req.then(null, function (e) { if (!done) { done = true; clearTimeout(t); off(); reject(e); } });
  });
}

function mediaStop() {
  if (!mediaActive) return Promise.resolve();
  mediaActive = false;
  if (api === 'idcap') {
    return idcapCall('idcap://tv/media/control', { command: 'stop' }).then(null, function () {})
      .then(function () { return idcapCall('idcap://tv/media/destroy', {}).then(null, function () {}); })
      .then(function () { return idcapCall('idcap://tv/media/shutdown', {}).then(null, function () {}); });
  }
  var m = hcapMedia; hcapMedia = null;
  var p = Promise.resolve();
  if (m) {
    p = p.then(function () { return hcapCall(m.stop.bind(m), {}).then(null, function () {}); })
      .then(function () { return hcapCall(m.destroy.bind(m), {}).then(null, function () {}); });
  }
  return p.then(function () { return hcapCall(hcap.Media.shutDown, {}).then(null, function () {}); });
}

function mediaPlay(url, mimeType) {
  if (api === 'idcap') {
    return idcapCall('idcap://tv/channel/stop', {}).then(null, function () {})
      .then(function () { return idcapCall('idcap://tv/media/startup', {}); })
      .then(function () { return idcapCall('idcap://tv/media/create', { url: url, mimeType: mimeType || 'application/x-mpegURL' }); })
      .then(function () { mediaActive = true; return idcapCall('idcap://tv/media/control', { command: 'play' }, TUNE_TIMEOUT_MS); });
  }
  return hcapCall(hcap.channel.stopCurrentChannel, {}).then(null, function () {})
    .then(function () { return hcapCall(hcap.Media.startUp, {}); })
    .then(function () {
      return new Promise(function (resolve, reject) {
        withTimeout(TIMEOUT_MS, function (ok, bad) {
          hcapMedia = hcap.Media.createMedia({ url: url, mimeType: mimeType || 'application/x-mpegURL', onSuccess: ok, onFailure: bad });
        }, resolve, reject);
      });
    })
    .then(function () { mediaActive = true; return hcapCall(hcapMedia.play.bind(hcapMedia), { repeatCount: 0 }, TUNE_TIMEOUT_MS); });
}

// Platform media pipeline (fallback when the HTML5 <video> element cannot play a URL).
export function platformMediaPlay(url, mimeType) { return mediaStop().then(function () { return mediaPlay(url, mimeType); }); }
export function platformMediaStop() { return mediaStop(); }

// Tune to a channel object {type, params}. Resolves when video should be up.
export function tune(ch) {
  if (!api) return Promise.reject(new Error('no platform'));
  return mediaStop().then(function () { return requestChannel(channelParams(ch)); });
}
export function stopVideo() {
  if (!api) return Promise.resolve();
  return mediaStop().then(function () {
    return api === 'idcap' ? idcapCall('idcap://tv/channel/stop', {}) : hcapCall(hcap.channel.stopCurrentChannel, {});
  }).then(null, function () {});
}
export function currentChannel() {
  return api === 'idcap' ? idcapCall('idcap://tv/channel/get', {}) : hcapCall(hcap.channel.getCurrentChannel, {});
}

// ------------------------------------------------------------------ keys
// attribute: 0 = TV firmware handles the key, 1 = delivered to the app.
export function claimKeys(names, attribute) {
  if (!api) return Promise.resolve();
  var seq = Promise.resolve();
  names.forEach(function (name) {
    seq = seq.then(function () {
      var p = api === 'idcap' ? idcapCall('idcap://system/key/add', { keycode: 0, virtualKeycode: name, attribute: attribute })
        : hcapCall(hcap.key.addKeyItem, { keycode: 0, virtualKeycode: hcap.key.Code[name], attribute: attribute });
      return p.then(null, function () {});
    });
  });
  return seq;
}
export function resetKeys() {
  if (!api) return Promise.resolve();
  return (api === 'idcap' ? idcapCall('idcap://system/key/reset', {}) : hcapCall(hcap.key.clearKeyTable, {})).then(null, function () {});
}

// ------------------------------------------------------------------ audio / power / misc
export function getVolume() {
  var p = api === 'idcap' ? idcapCall('idcap://audio/volumelevel/get', {}) : hcapCall(hcap.volume.getVolumeLevel, {});
  return p.then(function (r) { return { level: r && r.level !== undefined ? Number(r.level) : null, mute: !!(r && (r.mute || r.muted)) }; }, function () { return { level: null, mute: null }; });
}
export function setVolume(level) {
  var l = Math.max(0, Math.min(100, Math.round(Number(level))));
  return api === 'idcap' ? idcapCall('idcap://audio/volumelevel/set', { level: l }) : hcapCall(hcap.volume.setVolumeLevel, { level: l });
}
export function setMute(mute) {
  return api === 'idcap' ? idcapCall('idcap://audio/mute/set', { mute: !!mute }) : Promise.reject(new Error('mute not available in hcap.js'));
}
// LG: toastmsg/create takes {msg}, max 162 bytes.
export function toast(text) {
  var msg = String(text);
  while (unescape(encodeURIComponent(msg)).length > 162) msg = msg.slice(0, -1);
  return api === 'idcap' ? idcapCall('idcap://utility/toastmsg/create', { msg: msg }) : hcapCall(hcap.system.showToastMessage, { text: msg });
}
export function reboot() {
  return api === 'idcap' ? idcapCall('idcap://power/command', { powerCommand: 'reboot' }) : hcapCall(hcap.power.reboot, {});
}
export function powerOff() {
  return api === 'idcap' ? idcapCall('idcap://power/command', { powerCommand: 'powerOff' }) : hcapCall(hcap.power.powerOff, {});
}
export function getPowerMode() {
  var p = api === 'idcap' ? idcapCall('idcap://power/powermode/get', {}) : hcapCall(hcap.power.getPowerMode, {});
  return p.then(function (r) {
    if (!r) return null;
    if (r.mode !== undefined) return typeof r.mode === 'number' ? (r.mode === 2 ? 'WARM' : 'NORMAL') : String(r.mode);
    return null;
  }, function () { return null; });
}
export function setPowerMode(mode) {
  var m = String(mode).toUpperCase() === 'WARM' ? 'WARM' : 'NORMAL';
  return api === 'idcap' ? idcapCall('idcap://power/powermode/set', { mode: m }) : hcapCall(hcap.power.setPowerMode, { mode: hcap.power.PowerMode[m] });
}
export function launchApp(id, params) {
  return api === 'idcap' ? idcapCall('idcap://application/launch', { id: id, params: params || {} }) : hcapCall(hcap.application.launchApplication, { id: id, parameters: params || {} });
}
export function reloadApp() {
  var p = api === 'idcap' ? idcapCall('idcap://procentric/application/launch', {}) : hcapCall(hcap.system.launchHcapHtmlApplication, {});
  return p.then(null, function () { window.location.reload(); });
}
export function checkout() {
  return api === 'idcap' ? idcapCall('idcap://tv/checkout/request', {}) : hcapCall(hcap.checkout && hcap.checkout.request, {});
}
// Screenshot: resolves {uri} (IDCAP) or whatever HCAP returns; caller uploads.
export function screenshot() {
  if (api === 'idcap') return idcapCall('idcap://utility/screen/capture', {}, 10000);
  return hcapCall(hcap.system.requestScreenCaptureImage, {}, 10000).then(function () { return hcapCall(hcap.system.getScreenCaptureImage, {}, 10000); });
}
export function displayResolution() {
  return getProperty('display_resolution').then(function (v) {
    var m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(v || ''));
    return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
  });
}
