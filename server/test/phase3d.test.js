'use strict';
// Phase 3 Part D: remote-deploy bundles (app.zip with renderer + media + state.json), server-managed
// xait versions that bump only on content change, mode switch, CORS + X-CC-Tenant for the bundled
// app, /admin/status, origin/bundle reporting at register.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { startServer, makeTenantsDir } = require('../testlib/helpers');
const { readZip } = require('../src/xlsx');
const { xaitVersions, nextVersion } = require('../src/bundle');

const DIST = path.resolve(__dirname, '..', '..', 'tv-app', 'dist');
function tenantsWithRenderer() {
  const dir = makeTenantsDir();
  const app = path.join(dir, 'hoteldemo', 'procentric', 'application');
  if (fs.existsSync(DIST) && fs.existsSync(path.join(DIST, 'index.html'))) fs.cpSync(DIST, app, { recursive: true });
  else {   // minimal stand-in when tv-app was not built
    fs.writeFileSync(path.join(app, 'index.html'), '<html><script src="./app.0123456789ab.js"></script></html>');
    fs.writeFileSync(path.join(app, 'app.0123456789ab.js'), 'console.log(1)');
    fs.mkdirSync(path.join(app, 'lib'), { recursive: true }); fs.writeFileSync(path.join(app, 'lib', 'idcap.js'), '//');
    fs.mkdirSync(path.join(app, 'fonts'), { recursive: true }); fs.writeFileSync(path.join(app, 'fonts', 'fonts.css'), '/**/');
    fs.writeFileSync(path.join(app, 'zones.css'), '/**/'); fs.writeFileSync(path.join(app, 'version.txt'), 'test-build\n');
  }
  fs.mkdirSync(path.join(app, 'media', 'thumbs'), { recursive: true });
  fs.writeFileSync(path.join(app, 'media', 'logo.png'), Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
  fs.writeFileSync(path.join(app, 'media', 'thumbs', 'logo.jpg'), 'thumb');
  return { dir, app };
}

test('nextVersion wraps at 65535', () => { assert.equal(nextVersion(0), 1); assert.equal(nextVersion(41), 42); assert.equal(nextVersion(65535), 1); });

test('bundle: contents, state.json snapshot, xait forms, version bumps only on content change, mode switch, status, admin routes', async (t) => {
  const { dir, app } = tenantsWithRenderer();
  const s = await startServer({ tenantsDir: dir }); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { display_name: 'Hotel Demo', settings: { netflix_hotel_id: 'H-1', checkout_message: 'Bye' } } });
  const L = (await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Main', json: { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 900, h: 80, text: 'Welcome {{guest}}' }], pages: [{ id: 'home', name: 'Home', zones: ['t'] }], home: 'home' } } })).json;
  const ch = (await s.call('POST', '/api/admin/channels', { cookie, body: { number: 5, name: 'Five', type: 'ip', params: { url: 'http://cdn.example/five.m3u8', mimeType: 'application/x-mpegURL' } } })).json;
  const lu = (await s.call('POST', '/api/admin/lineups', { cookie, body: { name: 'Main', channel_ids: [ch.id] } })).json;
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { default_layout_id: L.id, default_lineup_id: lu.id } });
  await s.call('POST', '/api/admin/licences', { cookie, body: { files: [{ filename: 'NETFLIX_x.lic', content: 'TkZYLXRva2VuLWZvci1idW5kbGUtdGVzdA==' }] } });
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Std' } })).json;
  await s.call('PUT', `/api/admin/groups/${g.id}/layout`, { cookie, body: { layout_id: L.id } });

  // status before anything: run mode, no bundle
  let st = (await s.call('GET', '/api/admin/deployment', { cookie })).json;
  assert.equal(st.mode, 'run'); assert.equal(st.bundle_version, 0); assert.equal(st.zip_bytes, null); assert.equal(st.xait.url, 'http://hoteldemo.caritech.net/procentric/application/index.html');
  const d0 = (await s.call('GET', '/api/admin/deployment/diff', { cookie })).json;
  assert.equal(d0.bump, true); assert.equal(d0.next_version, 1); assert.ok(d0.added.includes('index.html') && d0.added.includes('media/logo.png') && d0.added.some((f) => /^app\.[0-9a-f]+\.js$/.test(f)) && d0.added.some((f) => f.startsWith('lib/')) && d0.added.some((f) => f.startsWith('fonts/')));
  assert.ok(!d0.added.some((f) => f.includes('thumbs')), 'thumbnails stay out');
  // first publish (still run mode): app.zip + state.json + bundle.json, version 1, xait untouched
  const p1 = await s.call('POST', '/api/admin/deployment/publish', { cookie, body: {} });
  assert.equal(p1.status, 200, p1.text + '\n' + s.logs.filter((l) => /ERROR/.test(l)).join('\n')); assert.equal(p1.json.version, 1); assert.equal(p1.json.bumped, true);
  const zipPath = path.join(app, 'app.zip');
  assert.ok(fs.existsSync(zipPath));
  const get = readZip(fs.readFileSync(zipPath));
  const idx = get('index.html'); assert.ok(idx && /<html/i.test(idx), 'index.html in the zip');
  assert.ok(get('media/logo.png') != null, 'media in the zip'); assert.equal(get('media/thumbs/logo.jpg'), null);
  assert.ok(get('zones.css') != null && get('fonts/fonts.css') != null && get('lib/idcap.js') != null);
  const stateJson = JSON.parse(get('state.json'));
  assert.equal(stateJson.tenant_host, 'hoteldemo.caritech.net'); assert.equal(stateJson.default_layout_id, L.id); assert.equal(stateJson.layouts[L.id].name, 'Main');
  assert.deepEqual(stateJson.lineups[lu.id].channels.map((c) => c.number), [5]);
  assert.equal(stateJson.groups[0].layout_id, L.id); assert.equal(stateJson.context.hotel, 'Hotel Demo'); assert.equal(stateJson.context.netflix_hotel_id, 'H-1'); assert.equal(stateJson.checkout_message, 'Bye');
  assert.deepEqual(stateJson.activation.tokenList.map((x) => x.id), ['netflix']); assert.equal(stateJson.bundle.version, 1);
  assert.equal(JSON.parse(get('bundle.json')).version, 1);
  assert.equal(xaitVersions(fs.readFileSync(path.join(app, 'xait.xml'), 'utf8')).versionNumber, 0, 'run mode: xait not rewritten by a publish');
  // publish again with nothing changed → same version; a layout change → state refreshed, no bump
  const p2 = (await s.call('POST', '/api/admin/deployment/publish', { cookie, body: {} })).json;
  assert.equal(p2.version, 1); assert.equal(p2.bumped, false);
  await s.call('PUT', `/api/admin/layouts/${L.id}`, { cookie, body: { name: 'Main', json: { ...stateJson.layouts[L.id], zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 900, h: 80, text: 'Hello {{guest}}' }] } } });
  const d1 = (await s.call('GET', '/api/admin/deployment/diff', { cookie })).json;
  assert.equal(d1.bump, false); assert.equal(d1.state_changed, true); assert.deepEqual([d1.added, d1.changed, d1.removed], [[], [], []]);
  const p3 = (await s.call('POST', '/api/admin/deployment/publish', { cookie, body: {} })).json;
  assert.equal(p3.version, 1); assert.equal(p3.bumped, false);
  assert.match(readZip(fs.readFileSync(zipPath))('state.json'), /Hello \{\{guest\}\}/, 'state.json refreshed');
  // a media change → bump to 2
  fs.writeFileSync(path.join(app, 'media', 'hero.jpg'), 'ffd8ffe0');
  const d2 = (await s.call('GET', '/api/admin/deployment/diff', { cookie })).json;
  assert.equal(d2.bump, true); assert.deepEqual(d2.added, ['media/hero.jpg']); assert.equal(d2.next_version, 2);
  const p4 = (await s.call('POST', '/api/admin/deployment/publish', { cookie, body: {} })).json;
  assert.equal(p4.version, 2); assert.equal(p4.bumped, true);
  // a renderer change → 3
  fs.writeFileSync(path.join(app, 'zones.css'), '/* v2 */');
  assert.equal((await s.call('POST', '/api/admin/deployment/publish', { cookie, body: {} })).json.version, 3);
  // switch to deploy: xait gets the app.zip form with applicationStructure and the bundle version
  const m1 = await s.call('PUT', '/api/admin/deployment/mode', { cookie, body: { mode: 'deploy' } });
  assert.equal(m1.status, 200, m1.text); assert.equal(m1.json.mode, 'deploy'); assert.equal(m1.json.version, 3);
  const xait = fs.readFileSync(path.join(app, 'xait.xml'), 'utf8');
  assert.match(xait, /<url>http:\/\/hoteldemo\.caritech\.net\/procentric\/application\/app\.zip<\/url>/);
  assert.match(xait, /<applicationStructure>\s*<baseDirectory>\/<\/baseDirectory>\s*<classpathExtension>\/<\/classpathExtension>\s*<initialClass>index\.html<\/initialClass>\s*<\/applicationStructure>/);
  assert.deepEqual([xaitVersions(xait).versionNumber, xaitVersions(xait).version], [3, 3]);
  assert.match(xait, /<controlCode>AUTOSTART<\/controlCode>/); assert.match(xait, /<type>Hcap-h<\/type>/);
  // the tenant registry still reads the hostname from the deploy-form xait
  assert.equal((await s.call('GET', '/api/admin/tenant', { cookie })).json.hostname, 'hoteldemo.caritech.net');
  // in deploy mode a content change bumps the xait too
  fs.writeFileSync(path.join(app, 'zones.css'), '/* v3 */');
  assert.equal((await s.call('POST', '/api/admin/deployment/publish', { cookie, body: {} })).json.version, 4);
  assert.equal(xaitVersions(fs.readFileSync(path.join(app, 'xait.xml'), 'utf8')).version, 4);
  assert.equal((await s.call('PUT', '/api/admin/deployment/mode', { cookie, body: { mode: 'nope' } })).status, 400);
  // sets report their bundle; pending = not on the current version
  const a = await s.registerSet('A', { bundle_version: 4, origin: 'file://' });
  const b = await s.registerSet('B', { bundle_version: 3, origin: 'http://hoteldemo.caritech.net' });
  st = (await s.call('GET', '/api/admin/deployment', { cookie })).json;
  assert.equal(st.mode, 'deploy'); assert.equal(st.bundle_version, 4); assert.deepEqual(st.pending_sets.map((x) => x.serial), ['B']);
  const sets = (await s.call('GET', '/api/admin/sets', { cookie })).json;
  assert.equal(sets.find((x) => x.serial === 'A').origin, 'file://'); assert.equal(sets.find((x) => x.serial === 'A').bundle_version, 4);
  assert.ok(s.logs.some((l) => /(NEW set|register) serial=B .*origin=http:\/\/hoteldemo\.caritech\.net bundle=v3/.test(l)), 'origin logged: ' + s.logs.filter((l) => /serial=B/.test(l)).join(' / '));
  // /admin/status (no auth) shows the build
  const status = await s.call('GET', '/admin/status');
  assert.equal(status.status, 200); assert.equal(status.json.mode, 'deploy'); assert.equal(status.json.bundle_version, 4); assert.equal(status.json.pending_sets, 1); assert.ok(status.json.build);
  // back to run: xait url index.html with a higher version than the TVs hold
  const m2 = (await s.call('PUT', '/api/admin/deployment/mode', { cookie, body: { mode: 'run' } })).json;
  assert.equal(m2.mode, 'run'); assert.equal(m2.version, 5);
  const x2 = fs.readFileSync(path.join(app, 'xait.xml'), 'utf8');
  assert.match(x2, /index\.html<\/url>/); assert.ok(!/applicationStructure/.test(x2)); assert.equal(xaitVersions(x2).versionNumber, 5);
  void a; void b;
});

test('bundled app: CORS preflight on /api/tv, X-CC-Tenant resolves the tenant, WS tenant query', async (t) => {
  const s = await startServer({ extraTenants: [['hotelb', 'hotelb.example']] }); t.after(s.close);
  const pre = await s.call('OPTIONS', '/api/tv/register', { host: '10.0.0.5', headers: { Origin: 'file://', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-cc-tenant' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers['access-control-allow-origin'], '*'); assert.match(pre.headers['access-control-allow-headers'], /X-CC-Tenant/i);
  // Host is the bare server address; the header names the tenant
  const r = await s.call('POST', '/api/tv/register', { host: '10.0.0.5', headers: { 'X-CC-Tenant': 'hotelb.example', Origin: 'file://' }, body: { serial_number: 'S1', api: 'idcap', model_name: 'M', origin: 'file://' } });
  assert.equal(r.status, 200, r.text); assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal((await s.call('GET', '/api/admin/sets', { cookie: (await s.login('admin', undefined, 'hotelb.example')).cookie, host: 'hotelb.example' })).json[0].serial, 'S1');
  assert.equal((await s.call('POST', '/api/tv/register', { host: '10.0.0.5', body: { serial_number: 'S2' } })).status, 404, 'no header, unknown host → 404');
  assert.equal((await s.call('GET', '/api/admin/dashboard', { host: '10.0.0.5', headers: { 'X-CC-Tenant': 'hotelb.example' } })).status, 404, 'the header is honoured on the TV API only');
  // poll with the header and the token
  const p = await s.call('GET', `/api/tv/poll?set_id=${r.json.set_id}&token=${r.json.token}`, { host: '10.0.0.5', headers: { 'X-CC-Tenant': 'hotelb.example' } });
  assert.equal(p.status, 200);
  // WS: tenant named in the query, Host arbitrary
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${r.json.set_id}&token=${r.json.token}&tenant=hotelb.example`, { headers: { Host: '10.0.0.5' } });
  const hello = await new Promise((resolve, reject) => { ws.once('message', (m) => resolve(JSON.parse(m.toString()))); ws.once('error', reject); });
  assert.equal(hello.type, 'hello');
  ws.close();
  const bad = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${r.json.set_id}&token=${r.json.token}`, { headers: { Host: '10.0.0.5' } });
  const err = await new Promise((resolve) => { bad.once('error', (e) => resolve(e.message)); bad.once('open', () => resolve('opened')); });
  assert.match(err, /401/);
});
