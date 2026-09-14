// Fake LG IDCAP middleware injected into headless Chromium before the renderer loads.
// Mirrors the request/callback shape of idcap.js and the DOM events LG documents
// (idcap::channel_changed after tv/channel/change/request). State lives on window.__fake so
// tests can inspect calls and mutate properties.
module.exports = function fakeIdcap(serial = '305MAXX1Z123', overrides = {}) {
  return `
  window.__fake = {
    props: Object.assign({ idpn: '306', serial_number: ${JSON.stringify(serial)}, model_name: '43UM670H0UA', platform_version: '8.3.0',
      firmware_version: '03.25.80', webos_version: '8.3.0', room_number: '[TV]' + ${JSON.stringify(serial)}, display_resolution: '1920x1080' }, ${JSON.stringify(overrides)}),
    calls: [], channel: null, media: null, videoSize: null, keys: {}, volume: 20, mute: false, powerMode: 'NORMAL', toasts: [], launched: [], rebooted: 0
  };
  window.__fakeEvent = function (name, detail) { var ev = new Event(name); Object.assign(ev, detail || {}); document.dispatchEvent(ev); };
  window.idcap = { API_VERSION: 'fake-1.1.1', request: function (uri, o) {
    var p = (o && o.parameters) || {}; var f = window.__fake;
    f.calls.push({ uri: uri, p: p });
    var ok = function (r) { if (o && o.onSuccess) o.onSuccess(r || {}); };
    var fail = function (m) { if (o && o.onFailure) o.onFailure({ errorMessage: m }); };
    setTimeout(function () {
      switch (uri) {
        case 'idcap://configuration/property/get': (p.key in f.props) ? ok({ value: f.props[p.key] }) : fail('no such key'); break;
        case 'idcap://configuration/property/set': f.props[p.key] = p.value; ok(); break;
        case 'idcap://tv/channel/change/request': f.channel = p; f.media = null; ok(); setTimeout(function () { window.__fakeEvent('idcap::channel_changed', { result: true }); }, 30); break;
        case 'idcap://tv/channel/get': ok(Object.assign({ channelStatus: 'ok' }, f.channel || {})); break;
        case 'idcap://tv/channel/stop': case 'idcap://tv/channel/replay': ok(); break;
        case 'idcap://tv/media/startup': case 'idcap://tv/media/shutdown': case 'idcap://tv/media/destroy': ok(); break;
        case 'idcap://tv/media/create': f.media = p; f.channel = null; ok(); break;
        case 'idcap://tv/media/control': ok(); if (p.command === 'play') setTimeout(function () { window.__fakeEvent('idcap::play_start', {}); }, 20); break;
        case 'idcap://video/size/set': f.videoSize = p; ok(); break;
        case 'idcap://system/key/add': f.keys[p.virtualKeycode] = p.attribute; ok(); break;
        case 'idcap://system/key/reset': f.keys = {}; ok(); break;
        case 'idcap://audio/volumelevel/get': ok({ level: f.volume, mute: f.mute }); break;
        case 'idcap://audio/volumelevel/set': f.volume = p.level; ok(); break;
        case 'idcap://audio/mute/set': f.mute = !!p.mute; ok(); break;
        case 'idcap://utility/toastmsg/create': f.toasts.push(p.msg || p.text || JSON.stringify(p)); ok(); break;
        case 'idcap://utility/screen/capture': ok({ uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }); break;
        case 'idcap://power/command': f.rebooted++; ok(); break;
        case 'idcap://power/powermode/get': ok({ mode: f.powerMode }); break;
        case 'idcap://power/powermode/set': f.powerMode = p.mode; ok(); break;
        case 'idcap://application/launch': f.launched.push(p); ok(); break;
        case 'idcap://procentric/application/launch': f.launched.push({ reload: true }); ok(); break;
        case 'idcap://tv/checkout/request': f.checkedOut = true; ok(); break;
        case 'idcap://network/configuration/get': ok({ wired: { state: 'connected', ipAddress: '10.0.0.5' }, isInternetConnectionAvailable: true }); break;
        default: ok();
      }
    }, 10);
  } };`;
};
