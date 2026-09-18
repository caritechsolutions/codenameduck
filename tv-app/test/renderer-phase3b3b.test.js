'use strict';
// Phase 3 B3b: app activation on the set — register/status per app is reported with the
// register, an un-activated app is hidden from the apps zone, a register_apps command calls
// application/register, waits for application_registration_result_received, acks, re-reads the
// status and the tile appears.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

test('activation: status reported, un-activated app hidden, register_apps command activates it live', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const layout = { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 'apps', type: 'apps', x: 80, y: 820, w: 1760, h: 220, layout: 'row' }], pages: [{ id: 'home', name: 'Home', zones: ['apps'] }], home: 'home' };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  const g = (await stack.api('POST', '/api/admin/groups', { name: 'G' }, cookie)).json;
  await stack.api('PUT', `/api/admin/groups/${g.id}/layout`, { layout_id: l.id }, cookie);
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, settings: { netflix_hotel_id: 'HOTEL-1' } }, cookie);   // B3c: Netflix needs a hotel id
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('305MAXX1Z123'));   // fake: netflix 'unregistered', the rest 'registered'
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  // register/status was asked per discovered app and reported with the register
  let f = await fake();
  const asked = f.calls.filter((c) => c.uri === 'idcap://application/register/status').map((c) => c.p.id).sort();
  assert.deepEqual(asked, ['amazon', 'com.webos.app.browser', 'netflix', 'youtube.leanback.v4']);
  let apps = (await stack.api('GET', '/api/admin/apps', undefined, cookie)).json;
  const nf = apps.find((a) => a.app_id === 'netflix'), yt = apps.find((a) => a.app_id === 'youtube.leanback.v4');
  assert.equal(nf.activation, 'not_activated'); assert.equal(nf.auth_status, 'unregistered');
  assert.equal(yt.activation, 'activated');
  // enable both for the group: only YouTube shows on the set
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  await stack.api('PATCH', `/api/admin/sets/${set.id}`, { group_id: g.id }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/apps`, { app_ids: [nf.id, yt.id] }, cookie);
  await page.waitForFunction(() => document.querySelectorAll('#zone-apps .apptile').length === 1, null, { timeout: 5000 });
  assert.deepEqual(await page.$$eval('#zone-apps .apptile .appname', (els) => els.map((e) => e.textContent)), ['YouTube']);
  // tokens → register_apps: the set calls application/register, gets the event, acks, re-reads status
  // B3c: tokens come from the superadmin licence store (one .lic file per app)
  const lic = await stack.api('POST', '/api/admin/licences', { files: [{ filename: 'NETFLIX_caritech.lic', content: 'TkZYLTEtbmV0ZmxpeC10b2tlbg==' }] }, cookie);
  assert.equal(lic.status, 200, JSON.stringify(lic.json));
  const run = await stack.api('POST', '/api/admin/apps/activation/run', {}, cookie);
  assert.equal(run.json.queued, 1);
  await page.waitForFunction(() => document.querySelectorAll('#zone-apps .apptile').length === 2, null, { timeout: 8000 });
  assert.deepEqual(await page.$$eval('#zone-apps .apptile .appname', (els) => els.map((e) => e.textContent)), ['Netflix', 'YouTube']);
  f = await fake();
  assert.deepEqual(f.registered, [{ tokenList: [{ id: 'netflix', token: 'TkZYLTEtbmV0ZmxpeC10b2tlbg==' }] }]);
  assert.ok(f.calls.filter((c) => c.uri === 'idcap://application/register/status' && c.p.id === 'netflix').length >= 2, 'status re-read after registering');
  await sleep(200);
  const detail = (await stack.api('GET', `/api/admin/sets/${set.id}`, undefined, cookie)).json;
  const cmd = detail.commands.find((c) => c.type === 'register_apps');
  assert.equal(cmd.status, 'acked'); assert.equal(cmd.result.ok, true);
  assert.ok(detail.events.some((e) => e.type === 'tv_apps_registration'));
  assert.ok(detail.events.some((e) => e.type === 'tv_apps_status'));
  const act = (await stack.api('GET', '/api/admin/apps/activation', undefined, cookie)).json;
  assert.equal(act.results.length, 1); assert.equal(act.results[0].ok, true); assert.equal(act.results[0].result.results[0].tokenResult, 'success');   // LG's real field: the string "success"/"fail"
  apps = (await stack.api('GET', '/api/admin/apps', undefined, cookie)).json;
  assert.equal(apps.find((a) => a.app_id === 'netflix').activation, 'activated');
  await page.close();
});
