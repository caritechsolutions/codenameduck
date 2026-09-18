'use strict';
// Phase 3 B3c: licence tokens registered at boot when the set is not authorised, Netflix launch
// parameters per LG's SI doc (reason launcher / hotKey / boot + hotel_id), the NETFLIX remote key,
// and the service-country preflight reported at register.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const KEY = { ENTER: 0x0D, DOWN: 0x28, NETFLIX: 0x40D };
const TOKEN = 'TkZYLTEyMy1uZXRmbGl4LXRva2VuLWZvci10ZXN0cw';

async function setup(t) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const lic = await stack.api('POST', '/api/admin/licences', { files: [{ filename: 'NETFLIX_caritech.lic', content: TOKEN + '\n' }] }, cookie);
  assert.equal(lic.status, 200, JSON.stringify(lic.json));
  await stack.api('PATCH', '/api/admin/tenant', { settings: { netflix_hotel_id: 'HOTEL-1' } }, cookie);
  const layout = { schema: 2, canvas: { w: 1920, h: 1080 }, home: 'home', zones: [
    { id: 'menu', type: 'menu', x: 80, y: 120, w: 480, h: 300, items: [{ label: 'Netflix', action: 'launch_app', app_id: 'netflix' }, { label: 'YouTube', action: 'launch_app', app_id: 'youtube.leanback.v4' }] },
  ], pages: [{ id: 'home', name: 'Home', zones: ['menu'] }] };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  assert.ok(l.id, JSON.stringify(l));
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id }, cookie);
  return { stack, cookie };
}
async function open(s, serial, overrides) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap(serial, overrides));
  await page.goto(s.stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  return { page, key, fake };
}

test('licence tokens: registered at boot only for apps whose register/status is not authorised; authorised sets never register', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  // first boot: Netflix is in application/list and reports "unregistered" (as the 43UM670H0UA does)
  const p1 = await open(s, 'B3C0001', {});
  await p1.page.waitForFunction(() => (window.__fake.registered || []).length >= 1, null, { timeout: 10000 });
  await sleep(600);
  let f = await p1.fake();
  assert.equal(f.registered.length, 1, 'registered exactly once at boot (server command and boot path never double up)');
  assert.deepEqual(f.registered[0], { tokenList: [{ id: 'netflix', token: TOKEN }] });
  assert.equal(f.keys.NETFLIX, 1, 'NETFLIX key claimed');
  assert.ok(f.calls.some((c) => c.uri === 'idcap://configuration/servicecountry/get'), 'service country read');
  const lists = f.calls.filter((c) => c.uri === 'idcap://application/list').length;
  assert.ok(lists >= 2, 'application/list re-read after registration: ' + lists);
  await sleep(300);
  let apps = (await s.stack.api('GET', '/api/admin/apps', undefined, s.cookie)).json;
  const nf = apps.find((a) => a.app_id === 'netflix');
  assert.ok(nf, 'netflix known: ' + apps.map((a) => a.app_id));
  assert.equal(nf.activation, 'activated');
  assert.equal(nf.licensed, true);
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'B3C0001');
  let detail = (await s.stack.api('GET', `/api/admin/sets/${set.id}`, undefined, s.cookie)).json;
  const types = detail.events.map((e) => e.type);
  for (const n of ['tv_apps_registration', 'tv_apps_registration_reason', 'tv_apps_list', 'tv_apps_status', 'tv_service_country']) assert.ok(types.includes(n), n + ' event in ' + types.join(','));
  const reason = detail.events.find((e) => e.type === 'tv_apps_registration_reason' && e.payload.trigger !== 'server_register');
  assert.ok(reason, 'renderer reason event');
  assert.deepEqual(reason.payload.sending, ['netflix']);
  assert.equal(reason.payload.apps[0].in_list, true); assert.equal(reason.payload.apps[0].status.auth, false); assert.equal(reason.payload.apps[0].activated, false);
  const regEv = detail.events.find((e) => e.type === 'tv_apps_registration');
  assert.equal(regEv.payload.ok, true); assert.deepEqual(regEv.payload.results.map((r) => [r.id, r.tokenResult]), [['netflix', 'success']]);
  assert.ok(!types.includes('tv_error'), 'no error for service country NL: ' + JSON.stringify(detail.events.filter((e) => e.type === 'tv_error')));
  const results = (await s.stack.api('GET', '/api/admin/apps/activation', undefined, s.cookie)).json.results;
  assert.equal(results.length, 1); assert.equal(results[0].ok, true);
  await p1.page.close();

  // second boot with the app now authorised (as after a real activation): nothing is registered,
  // by the renderer or by the server — that is what kept resetting the Netflix sign-in
  const p2 = await open(s, 'B3C0001', { __appAuth: {} });
  await sleep(1500);
  f = await p2.fake();
  assert.equal((f.registered || []).length, 0, 'authorised: no application/register on the second boot');
  detail = (await s.stack.api('GET', `/api/admin/sets/${set.id}`, undefined, s.cookie)).json;
  assert.equal(detail.commands.filter((c) => c.type === 'register_apps').length, 0, 'the server never needed to queue a command: the set registers on its own at boot');
  await p2.page.close();

  // a brand-new set that is already authorised: no registration at all, no command
  const p3 = await open(s, 'B3C0002', { __appAuth: {} });
  await sleep(1500);
  f = await p3.fake();
  assert.equal((f.registered || []).length, 0);
  const set2 = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'B3C0002');
  const d2 = (await s.stack.api('GET', `/api/admin/sets/${set2.id}`, undefined, s.cookie)).json;
  assert.equal(d2.commands.filter((c) => c.type === 'register_apps').length, 0);
  await p3.page.close();
});

test('Netflix launch params: launcher from a menu, hotKey from the remote in NORMAL, boot in WARM, refused without a hotel id', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const p = await open(s, 'B3C0003', { __appAuth: {} });
  await sleep(300);
  const expect = (reason, extra) => ({ reason, params: Object.assign({ hotel_id: 'HOTEL-1', launcher_version: '1.0' }, extra || {}) });
  // menu item → launcher, noSplash false for Netflix
  await p.key(KEY.DOWN);
  assert.equal(await p.page.$eval('#zone-menu .menuitem.focused', (e) => e.textContent), 'Netflix');
  await p.key(KEY.ENTER); await sleep(150);
  let f = await p.fake();
  assert.deepEqual(f.launched[f.launched.length - 1], { id: 'netflix', params: expect('launcher'), noSplash: false });
  // other apps are untouched: default params, noSplash true
  await p.key(KEY.DOWN); await p.key(KEY.ENTER); await sleep(150);
  f = await p.fake();
  assert.deepEqual(f.launched[f.launched.length - 1], { id: 'youtube.leanback.v4', params: {}, noSplash: true });
  // remote hot key while ON
  await p.key(KEY.NETFLIX); await sleep(200);
  f = await p.fake();
  assert.deepEqual(f.launched[f.launched.length - 1], { id: 'netflix', params: expect('hotKey'), noSplash: false });
  // remote hot key while the set is in WARM standby → boot with params.reason netflix
  await p.page.evaluate(() => { window.__fake.powerMode = 'WARM'; });
  await p.key(KEY.NETFLIX); await sleep(200);
  f = await p.fake();
  assert.deepEqual(f.launched[f.launched.length - 1], { id: 'netflix', params: expect('boot', { reason: 'netflix' }), noSplash: false });
  assert.ok(f.calls.filter((c) => c.uri === 'idcap://power/powermode/get').length >= 2, 'power mode checked on the hot key');
  // a launch_app command from admin → launcher
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'B3C0003');
  await s.stack.api('POST', '/api/admin/commands', { set_ids: [set.id], type: 'launch_app', payload: { app_id: 'netflix' } }, s.cookie);
  await p.page.waitForFunction((n) => window.__fake.launched.length > n, f.launched.length, { timeout: 5000 });
  f = await p.fake();
  assert.deepEqual(f.launched[f.launched.length - 1].params, expect('launcher'));
  // no hotel id → refused with an on-screen note, nothing launched
  const before = f.launched.length;
  await p.page.evaluate(() => { window.__cc.state.context.netflix_hotel_id = ''; window.__cc.doAction({ type: 'launch_app', app_id: 'netflix' }); });
  await sleep(200);
  f = await p.fake();
  assert.equal(f.launched.length, before, 'not launched without a hotel id');
  assert.match(await p.page.$eval('#overlay .popup.show', (e) => e.textContent), /not enabled/i);
  await p.page.close();
});

test('service country "Others" is reported as a tv_error at register', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const p = await open(s, 'B3C0004', { __appAuth: {}, __serviceCountry: 'Others' });
  await sleep(500);
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, s.cookie)).json.find((x) => x.serial === 'B3C0004');
  const detail = (await s.stack.api('GET', `/api/admin/sets/${set.id}`, undefined, s.cookie)).json;
  const err = detail.events.find((e) => e.type === 'tv_error');
  assert.ok(err, 'tv_error recorded: ' + detail.events.map((e) => e.type));
  assert.match(err.payload.message, /service country is "Others"/);
  assert.match(JSON.stringify(detail.last_error || detail), /Others/);
  await p.page.close();
});
