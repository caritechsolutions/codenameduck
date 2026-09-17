// Fake LG IDCAP middleware injected into headless Chromium before the renderer loads.
// Mirrors the request/callback shape of idcap.js and the DOM events LG documents
// (idcap::channel_changed after tv/channel/change/request). State lives on window.__fake so
// tests can inspect calls and mutate properties.
module.exports = function fakeIdcap(serial = '305MAXX1Z123', overrides = {}) {
  return `
  window.__fake = {
    props: Object.assign({ idpn: '306', serial_number: ${JSON.stringify(serial)}, model_name: '43UM670H0UA', platform_version: '8.3.0',
      firmware_version: '03.25.80', webos_version: '8.3.0', room_number: '[TV]' + ${JSON.stringify(serial)}, display_resolution: '1920x1080' }, ${JSON.stringify(overrides)}),
    calls: [], channel: null, media: null, videoSize: null, keys: {}, volume: 20, mute: false, powerMode: 'NORMAL', toasts: [], launched: [], rebooted: 0, noSignal: 'default', propertyRules: ${JSON.stringify(overrides.__propertyRules || {})}, input: ${JSON.stringify(overrides.__input || { type: 'TV', index: 0 })}, appList: ${JSON.stringify(overrides.__appList || null)}, appAuth: ${JSON.stringify(overrides.__appAuth || { netflix: 'unregistered' })}, serviceCountry: ${JSON.stringify(overrides.__serviceCountry === undefined ? 'NL' : overrides.__serviceCountry)}, hideUntilRegistered: ${JSON.stringify(overrides.__hideUntilRegistered || [])}
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
        case 'idcap://configuration/property/set': {
          var rules = f.propertyRules || {};
          if (typeof p.value !== 'string') { fail("'value' is not string type"); break; }   // real LG behaviour (43UM670H0UA)
          if ((rules.readonly || []).indexOf(p.key) >= 0) { fail('property is read only'); break; }
          if ((rules.sticky || []).indexOf(p.key) >= 0) { ok(); break; }   // TV accepts the call but keeps the old value
          f.props[p.key] = p.value; ok(); break;
        }
        case 'idcap://configuration/servicecountry/get': ok({ country: f.serviceCountry }); break;
        case 'idcap://configuration/servicecountry/set': f.serviceCountry = p.country; ok(); break;
        case 'idcap://externalinput/get': ok({ type: f.input.type, index: f.input.index }); break;
        case 'idcap://externalinput/set': f.input = { type: p.type, index: p.index }; f.inputSets = (f.inputSets || 0) + 1; ok(); break;
        case 'idcap://system/nosignalimage/set': f.noSignal = p.mode; ok(); break;
        case 'idcap://system/nosignalimage/get': ok({ mode: f.noSignal || 'default' }); break;
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
        case 'idcap://application/register/status': ok({ id: p.id, status: (f.appAuth || {})[p.id] || 'registered' }); break;
        case 'idcap://application/register': {
          f.registered = (f.registered || []).concat([p]);
          if (p.tokenList) p.tokenList.forEach(function (t) { f.appAuth = f.appAuth || {}; f.appAuth[t.id] = 'registered'; });
          if (p.accountNumber) { f.appAuth = {}; }
          ok();
          // LG's documented event shape (docs/lg/netflix.md): { id, tokenResult, errorMessage }
          setTimeout(function () { window.__fakeEvent('idcap::application_registration_result_received', { id: p.tokenList ? p.tokenList.map(function (t) { return t.id; }).join(',') : 'account', tokenResult: true }); }, 30);
          break;
        }
        case 'idcap://application/list': ok({ list: (f.appList || [
          { id: 'netflix', title: 'Netflix', icon: '/usr/palm/applications/netflix/icon.png', type: 'native' },
          { id: 'youtube.leanback.v4', title: 'YouTube', icon: '/usr/palm/applications/youtube/icon.png', type: 'web' },
          { id: 'amazon', title: 'Prime Video', type: 'native' },
          { id: 'com.webos.app.browser', title: 'Web Browser', type: 'web' }]).filter(function (a) { return f.hideUntilRegistered.indexOf(a.id) < 0 || (f.appAuth || {})[a.id] === 'registered'; }) }); break;
        case 'idcap://procentric/application/launch': f.launched.push({ reload: true }); ok(); break;
        case 'idcap://tv/checkout/request': f.checkedOut = true; ok(); break;
        case 'idcap://network/configuration/get': ok({ wired: { state: 'connected', ipAddress: '10.0.0.5' }, isInternetConnectionAvailable: true }); break;
        default: ok();
      }
    }, 10);
  } };`;
};
