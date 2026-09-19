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
  assert.ok(Number.isInteger(stateJson.state_version) && stateJson.state_version >= 1, 'state.json carries the tenant state_version');
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

test('state_version: monotonic per tenant, in register/poll answers, WS pushes and the snapshot', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const a = await s.registerSet('V1');
  const v0 = a.json.state_version;
  assert.ok(Number.isInteger(v0) && v0 >= 1);
  const L = (await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Main', json: { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 900, h: 80, text: 'one' }], pages: [{ id: 'home', name: 'Home', zones: ['t'] }], home: 'home' } } })).json;
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { default_layout_id: L.id } });
  const p1 = (await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`)).json;
  assert.ok(p1.state_version > v0, 'a tenant change advances the version');
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${a.json.set_id}&token=${a.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  const msgs = []; ws.on('message', (m) => msgs.push(JSON.parse(m.toString())));
  await new Promise((r) => ws.once('open', r)); await new Promise((r) => setTimeout(r, 100));
  await s.call('PUT', `/api/admin/layouts/${L.id}`, { cookie, body: { name: 'Main', json: { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 900, h: 80, text: 'two' }], pages: [{ id: 'home', name: 'Home', zones: ['t'] }], home: 'home' } } });
  await new Promise((r) => setTimeout(r, 200));
  const push = msgs.filter((m) => m.type === 'layout').pop();
  assert.ok(push && push.state_version > p1.state_version, 'the push carries a newer version than the last poll');
  const p2 = (await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`)).json;
  assert.ok(p2.state_version >= push.state_version);
  ws.close();
});

// ---- Part D4: the activation payload (tokens + status_ids) on every path, and why tokens can be missing ----

const NFX = 'TkZYLXRva2VuLWZvci1kNC10ZXN0LTAxMjM0NTY3ODk=';

test('D4: register/poll/WS answers carry activation tokens when the tenant comes from X-CC-Tenant (foreign origin)', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('POST', '/api/admin/licences', { cookie, body: { files: [{ filename: 'NETFLIX_caritech.lic', content: NFX }] } });
  await s.call('PUT', '/api/admin/apps/activation', { cookie, body: { accountNumber: '' } });
  // The bundled app on the 43UM670H0UA runs from http://127.0.0.1:8051 (a loopback HTTP server on
  // the TV): Host and Origin are that address, the tenant is named only by the header.
  const foreign = { host: '127.0.0.1:8051', headers: { 'X-CC-Tenant': 'hoteldemo.caritech.net', Origin: 'http://127.0.0.1:8051' } };
  const r = await s.call('POST', '/api/tv/register', { ...foreign, body: { serial_number: 'BUNDLED1', api: 'idcap', model_name: '43UM670H0UA', origin: 'http://127.0.0.1:8051', bundle_version: 3, source: 'bundle' } });
  assert.equal(r.status, 200, r.text);
  const act = r.json.activation;
  assert.ok(act, 'activation present');
  assert.deepEqual(act.tokenList, [{ id: 'netflix', token: NFX }], 'the licence token is in the register answer');
  assert.ok(act.status_ids.includes('netflix'));
  assert.equal(act.withheld, undefined, 'nothing withheld');
  // identical to the Host-resolved answer
  const viaHost = await s.call('POST', '/api/tv/register', { body: { serial_number: 'BUNDLED1', api: 'idcap', model_name: '43UM670H0UA' } });
  assert.deepEqual(viaHost.json.activation, act);
  // poll with the header
  const p = await s.call('GET', `/api/tv/poll?set_id=${r.json.set_id}&token=${viaHost.json.token}`, foreign);
  assert.equal(p.status, 200, p.text); assert.deepEqual(p.json.activation, act);
  // WS hello with the tenant in the query
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${r.json.set_id}&token=${viaHost.json.token}&tenant=hoteldemo.caritech.net`, { headers: { Host: '127.0.0.1:8051', Origin: 'http://127.0.0.1:8051' } });
  const hello = await new Promise((resolve, reject) => { ws.once('message', (m) => resolve(JSON.parse(m.toString()))); ws.once('error', reject); });
  assert.equal(hello.type, 'hello');
  ws.close();
  assert.ok(!s.logs.some((l) => /withheld/.test(l)), 'no withheld line in the journal');
});

test('D4: a failed licence is withheld for a backoff window (with the reason in the payload), not for ever; success clears it', async (t) => {
  let clock = new Date('2026-09-18T10:00:00Z');
  const s = await startServer({ now: () => clock }); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('POST', '/api/admin/licences', { cookie, body: { files: [{ filename: 'NETFLIX_caritech.lic', content: NFX }] } });
  const reg = await s.registerSet('TV1', { api: 'idcap', model_name: '43UM670H0UA' });
  let token = reg.json.token;   // every register answer issues a fresh set token
  const auth = () => `set_id=${reg.json.set_id}&token=${token}`;
  const fail = async (id) => { const r = await s.call('POST', `/api/tv/events?${auth()}`, { body: { events: [{ name: 'apps_registration', payload: { ok: false, results: [{ id, tokenResult: 'fail', errorMessage: 'IDCAP_RESULT_FAILURE', ok: false }] } }] } }); assert.equal(r.status, 200, r.text); };
  const activation = async () => { const r = await s.call('POST', '/api/tv/register', { body: { serial_number: 'TV1', api: 'idcap', model_name: '43UM670H0UA' } }); token = r.json.token; return r.json.activation; };

  await fail('netflix');
  // the symptom seen on the set: status_ids present, tokenList absent — now with the reason attached
  let a = await activation();
  assert.equal(a.tokenList, undefined); assert.deepEqual(a.status_ids, ['netflix']);
  assert.equal(a.withheld.length, 1); assert.equal(a.withheld[0].id, 'netflix');
  assert.match(a.withheld[0].reason, /failed on 43UM670H0UA at 2026-09-18T10:00:00.000Z: IDCAP_RESULT_FAILURE — retried after 2026-09-18T11:00:00.000Z/);
  assert.equal(a.withheld[0].retry_at, '2026-09-18T11:00:00.000Z');
  assert.ok(s.logs.some((l) => /hoteldemo: licence token\(s\) withheld from TV1: netflix \(failed on 43UM670H0UA/.test(l)), s.logs.join('\n'));
  let lic = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences[0];
  assert.deepEqual([lic.failed.count, lic.failed.retry_at, lic.readable], [1, '2026-09-18T11:00:00.000Z', true]);
  // 1 h later the token is offered again
  clock = new Date('2026-09-18T11:00:01Z');
  a = await activation();
  assert.deepEqual(a.tokenList, [{ id: 'netflix', token: NFX }]); assert.equal(a.withheld, undefined);
  // a second consecutive failure doubles the window (2 h)
  await fail('netflix');
  lic = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences[0];
  assert.deepEqual([lic.failed.count, lic.failed.retry_at], [2, '2026-09-18T13:00:01.000Z']);
  clock = new Date('2026-09-18T12:30:00Z'); assert.equal((await activation()).tokenList, undefined, 'still inside the 2 h window');
  clock = new Date('2026-09-18T13:00:02Z'); assert.ok((await activation()).tokenList, 'offered after the window');
  // a "success" clears the failure at once
  await fail('netflix');
  assert.equal((await activation()).tokenList, undefined);
  await s.call('POST', `/api/tv/events?${auth()}`, { body: { events: [{ name: 'apps_registration', payload: { ok: true, results: [{ id: 'netflix', tokenResult: 'success', ok: true }] } }] } });
  lic = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences[0];
  assert.equal(lic.failed, null); assert.ok((await activation()).tokenList);
  assert.ok(s.logs.some((l) => /licences: netflix registered successfully — failure cleared/.test(l)));
  // the window is capped at 24 h
  const { retryAt } = require('../src/licences');
  assert.equal(retryAt({ failed_at: '2026-09-18T10:00:00.000Z', failed_count: 9 }), '2026-09-19T10:00:00.000Z');
});

test('D4: an undecryptable licence is withheld with a "cannot decrypt" reason and flagged in the admin list', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('POST', '/api/admin/licences', { cookie, body: { files: [{ filename: 'NETFLIX_caritech.lic', content: NFX }] } });
  // simulate a secret.key change: a blob encrypted with another key
  const { createLicenceStore } = require('../src/licences');
  const other = createLicenceStore(s.db, { dataDir: null });   // fresh in-memory key, same table
  s.db.prepare("UPDATE licences SET token_enc = ? WHERE app_id = 'netflix'").run(other.encrypt(NFX));
  const a = (await s.registerSet('TV9', { api: 'idcap' })).json.activation;
  assert.equal(a.tokenList, undefined); assert.deepEqual(a.status_ids, ['netflix']);
  assert.match(a.withheld[0].reason, /cannot decrypt/);
  const lic = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences[0];
  assert.equal(lic.readable, false);
});

// ---- Part D4b: connectivity-aware licence failures, "Hide TV's own OSD" group setting ----

test('D4b: a "fail" reported without internet is recorded but never marks the licence failed', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  await s.call('POST', '/api/admin/licences', { cookie, body: { files: [{ filename: 'NETFLIX_caritech.lic', content: NFX }] } });
  const reg = await s.registerSet('NET1', { api: 'idcap', model_name: '43UM670H0UA' });
  const auth = `set_id=${reg.json.set_id}&token=${reg.json.token}`;
  // event-level flag (the renderer's apps_registration carries internet:false)
  let r = await s.call('POST', `/api/tv/events?${auth}`, { body: { events: [{ name: 'apps_registration', payload: { ok: null, internet: false, offline: true, results: [{ id: 'netflix', tokenResult: 'fail', errorMessage: 'IDCAP_RESULT_FAILURE', ok: null, offline: true }] } }] } });
  assert.equal(r.status, 200);
  let lic = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences[0];
  assert.equal(lic.failed, null, 'not counted');
  assert.ok(s.logs.some((l) => /licences: netflix "fail" on 43UM670H0UA while the set had no internet — not counted/.test(l)));
  // result-level flag alone is enough too
  await s.call('POST', `/api/tv/events?${auth}`, { body: { events: [{ name: 'apps_registration', payload: { ok: false, results: [{ id: 'netflix', tokenResult: 'fail', ok: false, offline: true }] } }] } });
  lic = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences[0];
  assert.equal(lic.failed, null);
  // with internet the same result counts
  await s.call('POST', `/api/tv/events?${auth}`, { body: { events: [{ name: 'apps_registration', payload: { ok: false, internet: true, results: [{ id: 'netflix', tokenResult: 'fail', errorMessage: 'IDCAP_RESULT_FAILURE', ok: false }] } }] } });
  lic = (await s.call('GET', '/api/admin/licences', { cookie })).json.licences[0];
  assert.equal(lic.failed.model, '43UM670H0UA');
  // the network_restored reason is stored like any other event
  await s.call('POST', `/api/tv/events?${auth}`, { body: { events: [{ name: 'apps_registration_reason', payload: { trigger: 'network_restored', sending: ['netflix'], internet: true } }] } });
  const ev = (await s.call('GET', `/api/admin/sets/${reg.json.set_id}`, { cookie })).json.events.find((e) => e.type === 'tv_apps_registration_reason');
  assert.equal(ev.payload.trigger, 'network_restored');
});

test('D4b: tv_osd — default banner/1, group setting validated, in register/poll answers, WS layout pushes and the bundle snapshot', async (t) => {
  const { dir } = tenantsWithRenderer();
  const s = await startServer({ tenantsDir: dir }); t.after(s.close);
  const { cookie } = await s.login();
  const r0 = await s.registerSet('OSD1', { api: 'idcap' });
  assert.deepEqual(r0.json.tv_osd, { mode: 'banner', banner_select: 1 }, 'sets without a group hide the banner by default');
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Std' } })).json;
  assert.equal(g.hide_tv_osd, 'banner'); assert.equal(g.banner_select, 1);
  assert.equal((await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { hide_tv_osd: 'always' } })).status, 400);
  assert.equal((await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { banner_select: 2 } })).status, 400);
  await s.call('PATCH', `/api/admin/sets/${r0.json.set_id}`, { cookie, body: { group_id: g.id } });
  // WS: the layout push carries tv_osd and a change to the group pushes again
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${r0.json.set_id}&token=${r0.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  t.after(() => ws.close());   // an open socket would keep the runner alive on a failed assertion
  const msgs = [];
  await new Promise((resolve, reject) => { ws.on('message', (m) => { const j = JSON.parse(m.toString()); msgs.push(j); if (j.type === 'hello') resolve(); }); ws.once('error', reject); });
  await new Promise((r) => setTimeout(r, 300));
  const before = msgs.filter((m) => m.type === 'layout').length;
  const gp = await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { hide_tv_osd: 'osd_lock', banner_select: 0 } });
  assert.equal(gp.status, 200); assert.equal(gp.json.hide_tv_osd, 'osd_lock'); assert.equal(gp.json.banner_select, 0);
  await new Promise((r) => setTimeout(r, 300));
  const layouts = msgs.filter((m) => m.type === 'layout');
  assert.equal(layouts.length, before + 1, 'one more layout push for the OSD change alone');
  assert.deepEqual(layouts[layouts.length - 1].tv_osd, { mode: 'osd_lock', banner_select: 0 });
  ws.close();
  const p = await s.call('GET', `/api/tv/poll?set_id=${r0.json.set_id}&token=${r0.json.token}`);
  assert.deepEqual(p.json.tv_osd, { mode: 'osd_lock', banner_select: 0 });
  // bundle snapshot: per group + default
  await s.call('POST', '/api/admin/deployment/publish', { cookie, body: {} });
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'hoteldemo', 'procentric', 'application', 'state.json'), 'utf8'));
  assert.deepEqual(st.tv_osd_default, { mode: 'banner', banner_select: 1 });
  assert.deepEqual(st.groups.find((x) => x.id === g.id).tv_osd, { mode: 'osd_lock', banner_select: 0 });
});

test('D4b: a set connecting with an older state_version (sv=) gets the current state pushed at connect', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const L = (await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'A', json: { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 900, h: 80, text: 'ONE' }], pages: [{ id: 'home', name: 'Home', zones: ['t'] }], home: 'home' } } })).json;
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { default_layout_id: L.id } });
  const r = await s.registerSet('SV1', { api: 'idcap' });
  const v0 = r.json.state_version;
  // a change lands between the register answer and the WS connect
  await s.call('PUT', `/api/admin/layouts/${L.id}`, { cookie, body: { name: 'A', json: { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 900, h: 80, text: 'TWO' }], pages: [{ id: 'home', name: 'Home', zones: ['t'] }], home: 'home' } } });
  const open = (sv) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${r.json.set_id}&token=${r.json.token}${sv == null ? '' : '&sv=' + sv}`, { headers: { Host: 'hoteldemo.caritech.net' } });
    const msgs = []; ws.on('message', (m) => msgs.push(JSON.parse(m.toString()))); ws.once('error', reject);
    setTimeout(() => { ws.close(); resolve(msgs); }, 400);
  });
  const behind = await open(v0);
  const lay = behind.find((m) => m.type === 'layout');
  assert.ok(lay, 'layout pushed at connect: ' + behind.map((m) => m.type).join(','));
  assert.equal(lay.layout.zones[0].text, 'TWO'); assert.ok(lay.state_version > v0);
  assert.ok(s.logs.some((l) => /connected with state v\d+ < v\d+ — pushing the current state/.test(l)));
  const after = (await s.call('GET', `/api/tv/poll?set_id=${r.json.set_id}&token=${r.json.token}`)).json.state_version;
  assert.equal(after, lay.state_version, 'the catch-up push does not bump the version');
  // up to date (or no sv at all, older renderer): nothing pushed at connect
  assert.ok(!(await open(after)).some((m) => m.type === 'layout'));
  assert.ok(!(await open(null)).some((m) => m.type === 'layout'));
});
