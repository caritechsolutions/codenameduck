'use strict';
// Phase 3 Part D: offline-first renderer. Boots from the cached register answer (or the bundled
// state.json) with the server unreachable, tunes and navigates, then syncs when the server is back.
// A bundled app on another origin talks to the tenant host cross-origin with X-CC-Tenant.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const KEY = { ENTER: 0x0D, DOWN: 0x28, BACK: 0x1CD, CH_UP: 0x1AB };

async function setup(t) {
  const stack = await startStack({ serveTenantDir: true }); t.after(stack.close);
  const cookie = await stack.login();
  const clip = { number: 9, name: 'Clip', type: 'ip', params: { url: `${stack.base}/fixtures/tiny.webm`, mimeType: 'video/webm' } };
  const mc = { number: 10, name: 'Multicast', type: 'ip', params: { ip: '239.1.1.1', port: 1234, ipBroadcastType: 'udp' } };
  const c1 = (await stack.api('POST', '/api/admin/channels', clip, cookie)).json;
  const c2 = (await stack.api('POST', '/api/admin/channels', mc, cookie)).json;
  assert.ok(c1.id && c2.id, JSON.stringify([c1, c2]));
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: [c1.id, c2.id] }, cookie)).json;
  const layout = { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [
    { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 },
    { id: 'hello', type: 'text', x: 80, y: 60, w: 500, h: 80, text: 'Hotel {{hotel}} room {{room}}', style: { fontSize: 40, color: '#fff' } },
    { id: 'logo', type: 'image', x: 80, y: 900, w: 300, h: 100, src: '/procentric/application/media/logo.png' },
    { id: 'btn', type: 'button', x: 80, y: 400, w: 300, h: 80, label: 'Info', action: { type: 'goto_page', page: 'info' } },
    { id: 'infotext', type: 'text', x: 100, y: 100, w: 1000, h: 200, text: 'INFO PAGE', style: { fontSize: 40, color: '#fff' } },
  ], pages: [{ id: 'home', name: 'Home', zones: ['tv', 'hello', 'logo', 'btn'] }, { id: 'info', name: 'Info', zones: ['infotext'] }], home: 'home' };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'Main', json: layout }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { display_name: 'Demo', default_layout_id: l.id, default_lineup_id: lu.id, settings: { netflix_hotel_id: 'H-1' } }, cookie);
  await stack.api('POST', '/api/admin/licences', { files: [{ filename: 'NETFLIX_x.lic', content: 'TkZYLXRva2VuLWZvci1vZmZsaW5lLXRlc3Q=' }] }, cookie);
  require('fs').mkdirSync(require('path').join(stack.appDir, 'media'), { recursive: true });
  require('fs').writeFileSync(require('path').join(stack.appDir, 'media', 'logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const pub = await stack.api('POST', '/api/admin/deployment/publish', {}, cookie);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  return { stack, cookie, layoutId: l.id };
}
const key = (page, code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
const fake = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));

test('server unreachable: boots from the cached state, tunes, navigates pages; syncs when the server returns', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(fakeIdcap('D0001', { __appAuth: {} }));
  // 1. online boot → registers, caches
  await page.goto(s.stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.online === true && window.__cc.state.setId, null, { timeout: 10000 });
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'D0001');
  await s.stack.api('PATCH', `/api/admin/sets/${set.id}`, { room_number: '101' }, s.cookie);
  await page.waitForFunction(() => /room 101/.test(document.getElementById('zone-hello').textContent), null, { timeout: 5000 });
  await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('cc_state')).context.room === '101'; } catch (e) { return false; } }, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('cc_state')).tenant_host), null, 'same origin: no tenant host needed');
  assert.equal(await page.evaluate(() => window.__cc.api.bundleVersion), 1, 'bundle.json read');
  // 2. server gone → reload → portal from cache
  s.stack.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__cc && window.__cc.state.layout && window.__cc.state.source === 'cache', null, { timeout: 10000 });
  assert.equal(await page.$eval('#zone-hello', (e) => e.textContent), 'Hotel Demo room 101');
  assert.ok(await page.$('#zone-tv'), 'video zone drawn');
  await page.waitForFunction(() => window.__cc.state.online === false, null, { timeout: 10000 });
  assert.equal(await page.$eval('#status', (e) => e.className), '', 'status overlay hidden: the guest sees the portal');
  // tuning works from the cached lineup (HTML5 clip then the multicast channel via IDCAP)
  await page.waitForFunction(() => window.__cc.state.channel && window.__cc.state.channel.number === 9, null, { timeout: 10000 });
  await key(page, KEY.CH_UP);
  await page.waitForFunction(() => window.__cc.state.channel && window.__cc.state.channel.number === 10, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.1', null, { timeout: 5000 });   // the IDCAP request is async
  let f = await fake(page);
  assert.ok(f.channel && f.channel.ip === '239.1.1.1', 'IDCAP channel change with the server down: ' + JSON.stringify(f.channel));
  // page navigation + BACK
  await key(page, KEY.DOWN); await key(page, KEY.ENTER);
  await page.waitForFunction(() => document.getElementById('zone-infotext'), null, { timeout: 5000 });
  await key(page, KEY.BACK);
  await page.waitForFunction(() => !document.getElementById('zone-infotext') && document.getElementById('zone-hello'), null, { timeout: 5000 });
  // Netflix activation still knows the tokens (from the cache)
  assert.deepEqual(await page.evaluate(() => (window.__cc.state.activation || {}).tokenList.map((x) => x.id)), ['netflix']);
  // 3. server back → the next retry registers, state syncs, WS connects
  s.stack.setOffline(false);
  await page.evaluate(() => window.__cc.registerNow());
  await page.waitForFunction(() => window.__cc.state.online === true && window.__cc.state.ws && window.__cc.state.ws.readyState === 1, null, { timeout: 15000 });
  await s.stack.api('PATCH', '/api/admin/tenant', { display_name: 'Demo Two' }, s.cookie);
  await page.waitForFunction(() => /Hotel Demo Two/.test(document.getElementById('zone-hello').textContent), null, { timeout: 5000 });
  await sleep(300);
  const detail = (await s.stack.api('GET', `/api/admin/sets/${set.id}`, undefined, s.cookie)).json;
  const types = detail.events.map((e) => e.type);
  assert.ok(types.includes('tv_offline') && types.includes('tv_online'), 'offline/online events reached the server: ' + types.join(','));
  assert.ok(detail.events.some((e) => e.type === 'tv_boot' && e.payload.source === 'cache'));
  await ctx.close();
});

test('cold boot with no cache: the bundled state.json gives the default layout and lineup', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  s.stack.setOffline(true);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(fakeIdcap('D0002', { __appAuth: {}, room_number: '202' }));
  await page.goto(s.stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.layout && window.__cc.state.source === 'bundle', null, { timeout: 10000 });
  assert.equal(await page.$eval('#zone-hello', (e) => e.textContent), 'Hotel Demo room 202', 'room from the TV property, hotel from state.json');
  await page.waitForFunction(() => window.__cc.state.channel && window.__cc.state.channel.number === 9, null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__cc.state.lineup.length), 2);
  assert.deepEqual(await page.evaluate(() => (window.__cc.state.activation || {}).tokenList.map((x) => x.id)), ['netflix'], 'licences ride in state.json');
  assert.equal(await page.evaluate(() => window.__cc.state.setId), null, 'never registered');
  s.stack.setOffline(false);
  await page.evaluate(() => window.__cc.registerNow());
  await page.waitForFunction(() => window.__cc.state.online === true && window.__cc.state.setId, null, { timeout: 15000 });
  await ctx.close();
});

test('bundled app on another origin: talks to the tenant host cross-origin, media from the bundle first, origin recorded', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const other = await s.stack.startOtherOrigin(); t.after(other.close);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript(fakeIdcap('D0003', { __appAuth: {} }));
  await page.goto(other.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.online === true && window.__cc.state.setId, null, { timeout: 15000 });
  const api = await page.evaluate(() => JSON.parse(JSON.stringify(window.__cc.api)));
  assert.equal(api.base, s.stack.base, 'server address from state.json tenant_host'); assert.equal(api.tenant, `127.0.0.1:${s.stack.port}`); assert.equal(api.bundled, true);
  assert.ok(requests.some((u) => u === `${s.stack.base}/api/tv/register`), 'register went cross-origin to the tenant host');
  await page.waitForFunction(() => window.__cc.state.ws && window.__cc.state.ws.readyState === 1, null, { timeout: 10000 });
  // media: the logo is loaded from the bundle's own origin, not the server
  const logoSrc = await page.$eval('#zone-logo img', (i) => i.getAttribute('src'));
  assert.equal(logoSrc, './media/logo.png');
  assert.equal(await page.$eval('#zone-logo img', (i) => i.naturalWidth), 1, 'and it loaded');
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'D0003');
  assert.equal(set.origin, other.url.replace(/\/procentric.*$/, '')); assert.equal(set.bundle_version, 1);
  const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_state')));
  assert.equal(cache.tenant_host, `127.0.0.1:${s.stack.port}`, 'the cache remembers the tenant host for the next offline boot');
  await ctx.close();
});

test('a layout pushed live is drawn on the next offline boot; a newer bundle overrides an older cache', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(fakeIdcap('D0004', { __appAuth: {} }));
  await page.goto(s.stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.online === true && window.__cc.state.ws && window.__cc.state.ws.readyState === 1, null, { timeout: 15000 });
  const v0 = await page.evaluate(() => window.__cc.state.stateVersion);
  assert.ok(v0 >= 1, 'register carries state_version');
  // live push: edit the layout text → WS layout message → cache merged with a newer version
  const cur = (await s.stack.api('GET', `/api/admin/layouts/${s.layoutId}`, undefined, s.cookie)).json;
  const edited = { ...cur.json, zones: cur.json.zones.map((z) => (z.id === 'hello' ? { ...z, text: 'PUSHED {{hotel}}' } : z)) };
  await s.stack.api('PUT', `/api/admin/layouts/${s.layoutId}`, { name: cur.name, json: edited }, s.cookie);
  await page.waitForFunction(() => /^PUSHED/.test(document.getElementById('zone-hello').textContent), null, { timeout: 5000 });
  const cacheAfterPush = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_state')));
  assert.match(cacheAfterPush.layout.zones.find((z) => z.id === 'hello').text, /^PUSHED/, 'cache merged the push');
  assert.ok(cacheAfterPush.state_version > v0, `cache version advanced: ${cacheAfterPush.state_version} > ${v0}`);
  // server gone, reload: the pushed layout is what the set draws (the bundle's state.json is older)
  s.stack.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__cc && window.__cc.state.layout && window.__cc.state.source === 'cache', null, { timeout: 10000 });
  assert.match(await page.$eval('#zone-hello', (e) => e.textContent), /^PUSHED Demo/);
  // a bundle with a newer state_version overrides an older cache: publish a new snapshot with
  // another edit, then age the cache (as LG's app-update wipe or a stale cache would) and reboot
  s.stack.setOffline(false);
  await page.evaluate(() => window.__cc.registerNow());   // do not wait for the 5/10/20 s retry schedule
  const edited2 = { ...edited, zones: edited.zones.map((z) => (z.id === 'hello' ? { ...z, text: 'BUNDLED {{hotel}}' } : z)) };
  await s.stack.api('PUT', `/api/admin/layouts/${s.layoutId}`, { name: cur.name, json: edited2 }, s.cookie);
  await page.waitForFunction(() => /^BUNDLED/.test(document.getElementById('zone-hello').textContent), null, { timeout: 5000 });
  const pub = await s.stack.api('POST', '/api/admin/deployment/publish', {}, s.cookie);
  assert.equal(pub.status, 200);
  const bundledVersion = JSON.parse(require('fs').readFileSync(require('path').join(s.stack.appDir, 'state.json'), 'utf8')).state_version;
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('cc_state')); c.state_version = 1; c.layout.zones.find((z) => z.id === 'hello').text = 'STALE {{hotel}}'; localStorage.setItem('cc_state', JSON.stringify(c)); });
  s.stack.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__cc && window.__cc.state.layout && window.__cc.state.source === 'bundle', null, { timeout: 10000 });
  assert.match(await page.$eval('#zone-hello', (e) => e.textContent), /^BUNDLED Demo/, 'the newer bundle wins over the stale cache');
  assert.equal(await page.evaluate(() => window.__cc.state.stateVersion), bundledVersion);
  // the boot event says which source and version were used
  s.stack.setOffline(false);
  await page.evaluate(() => window.__cc.registerNow());
  await page.waitForFunction(() => window.__cc.state.online === true, null, { timeout: 15000 });
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'D0004');
  let boots = [];
  // the very first online boot also pre-rendered from the (older) bundle; wait for the boot that used the new one
  const isNew = (b) => b.payload.state_source === 'bundle' && b.payload.state_version === bundledVersion;
  for (let i = 0; i < 80 && !boots.some(isNew); i++) { await sleep(250); boots = (await s.stack.api('GET', `/api/admin/sets/${set.id}`, undefined, s.cookie)).json.events.filter((e) => e.type === 'tv_boot'); }
  const bundleBoot = boots.find(isNew);
  assert.ok(bundleBoot, 'the offline boot event reached the server once it was back: ' + JSON.stringify(boots.map((b) => b.payload.state_source)));
  assert.equal(bundleBoot.payload.state_version, bundledVersion); assert.equal(bundleBoot.payload.cache_version, 1); assert.ok(bundleBoot.payload.origin && bundleBoot.payload.protocol);
  assert.ok(boots.some((b) => b.payload.state_source === 'server' || b.payload.state_source === 'none' || b.payload.state_source === 'cache'));
  await ctx.close();
});

test('offline boot from the bundle with authNeeded → exactly one application/register before the apps zone shows; same from the cache', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  // enable an app for a group so the apps zone has something to hold back
  const layout = (await s.stack.api('GET', `/api/admin/layouts/${s.layoutId}`, undefined, s.cookie)).json;
  const withApps = { ...layout.json, zones: [...layout.json.zones, { id: 'apps', type: 'apps', x: 80, y: 700, w: 1700, h: 180, layout: 'row' }], pages: layout.json.pages.map((p) => (p.id === 'home' ? { ...p, zones: [...p.zones, 'apps'] } : p)) };
  await s.stack.api('PUT', `/api/admin/layouts/${s.layoutId}`, { name: layout.name, json: withApps }, s.cookie);
  await s.stack.api('POST', '/api/admin/deployment/publish', {}, s.cookie);
  const stateJson = JSON.parse(require('fs').readFileSync(require('path').join(s.stack.appDir, 'state.json'), 'utf8'));
  assert.deepEqual(stateJson.activation.tokenList.map((x) => x.id), ['netflix'], 'tokens ride in state.json');
  assert.deepEqual(stateJson.activation.status_ids, ['netflix']);
  // 1. cold boot, server unreachable: netflix hidden from the list and authNeeded
  s.stack.setOffline(true);
  let ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  let page = await ctx.newPage();
  await page.addInitScript(fakeIdcap('D0005', { __hideUntilRegistered: ['netflix'] }));   // default appAuth: netflix unregistered → auth:false, authNeeded
  await page.goto(s.stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.source === 'bundle' && window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 15000 });
  let f = await fake(page);
  assert.equal(f.calls.filter((c) => c.uri === 'idcap://application/register').length, 1, 'exactly one application/register with the server down');
  assert.deepEqual(f.registered[0], { tokenList: [{ id: 'netflix', token: 'TkZYLXRva2VuLWZvci1vZmZsaW5lLXRlc3Q=' }] });
  assert.equal(f.appAuth.netflix, 'registered');
  const statusQ = f.calls.filter((c) => c.uri === 'idcap://application/register/status').map((c) => c.p.id);
  assert.deepEqual([...new Set(statusQ)], ['netflix'], 'status asked for the licensed id only, offline too');
  // order: status → register → list + status re-read, all before the hold was released
  const idx = (uri, last) => { const xs = f.calls.map((c, i) => [c.uri, i]).filter(([u]) => u === uri).map(([, i]) => i); return last ? xs[xs.length - 1] : xs[0]; };
  assert.ok(idx('idcap://application/register/status') < idx('idcap://application/register') && idx('idcap://application/list', true) > idx('idcap://application/register'));
  await ctx.close();
  // 2. cached boot: register online first (fake already authorised so nothing registers), then the
  //    set forgets its activation (LG reset) and boots offline from the cache → one registration
  s.stack.setOffline(false);
  ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await ctx.newPage();
  await page.addInitScript(fakeIdcap('D0006', { __appAuth: {} }));
  await page.goto(s.stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.online === true && window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 15000 });
  assert.equal((await fake(page)).calls.filter((c) => c.uri === 'idcap://application/register').length, 0, 'authorised: nothing registered online');
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_state')));
  assert.deepEqual(cached.activation.tokenList.map((x) => x.id), ['netflix'], 'tokens are in the cache');
  await page.close();
  page = await ctx.newPage();   // same context → same localStorage; a fresh fake that says authNeeded again
  await page.addInitScript(fakeIdcap('D0006', { __hideUntilRegistered: ['netflix'] }));
  s.stack.setOffline(true);
  await page.goto(s.stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.source === 'cache' && window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 15000 });
  f = await fake(page);
  assert.equal(f.calls.filter((c) => c.uri === 'idcap://application/register').length, 1, 'exactly one application/register from the cached boot');
  assert.deepEqual(f.registered[0].tokenList.map((x) => x.id), ['netflix']);
  // back online: the queued evidence reaches the server — reason (boot, from cache) + registration
  s.stack.setOffline(false);
  await page.evaluate(() => window.__cc.registerNow());
  await page.waitForFunction(() => window.__cc.state.online === true && window.__cc.state.ws && window.__cc.state.ws.readyState === 1, null, { timeout: 15000 });
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'D0006');
  let ev = [];
  for (let i = 0; i < 40 && !ev.some((e) => e.type === 'tv_apps_registration'); i++) { await sleep(250); ev = (await s.stack.api('GET', `/api/admin/sets/${set.id}`, undefined, s.cookie)).json.events; }
  const reg = ev.find((e) => e.type === 'tv_apps_registration');
  assert.ok(reg && reg.payload.trigger === 'boot' && reg.payload.results[0].tokenResult === 'success', JSON.stringify(reg && reg.payload));
  const boot = ev.find((e) => e.type === 'tv_boot' && e.payload.state_source === 'cache');
  assert.ok(boot && boot.payload.activation && boot.payload.activation.tokens[0] === 'netflix', 'tv_boot names the tokens the cache carried');
  assert.equal((await s.stack.api('GET', '/api/admin/apps', undefined, s.cookie)).json.find((a) => a.app_id === 'netflix').activation, 'activated');
  await ctx.close();
});
