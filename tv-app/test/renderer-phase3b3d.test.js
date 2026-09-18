'use strict';
// B3d: token registration is driven by register/status only. Two boots with every app authorised
// → zero application/register calls. An unauthorised app gets only its own token. A "fail" marks
// the licence and stops retries. A boot channel_changed failure without a tuner channel is not
// an error.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const TOK = (s) => Buffer.from(`token-for-${s}-0123456789`).toString('base64');
const FILE = { netflix: 'NETFLIX_caritech.lic', amazon: 'AMAZON_caritech.lic', airplay: 'AirPlay_caritech.lic' };
async function setup(t, ids = ['netflix', 'amazon', 'airplay']) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const lic = await stack.api('POST', '/api/admin/licences', { files: ids.map((id) => ({ filename: FILE[id], content: TOK(id) })) }, cookie);
  assert.equal(lic.status, 200, JSON.stringify(lic.json));
  await stack.api('PATCH', '/api/admin/tenant', { settings: { netflix_hotel_id: 'HOTEL-1' } }, cookie);
  const layout = { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 800, h: 80, text: 'x' }], pages: [{ id: 'home', name: 'Home', zones: ['t'] }], home: 'home' };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id }, cookie);
  const open = async (serial, overrides) => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.addInitScript(fakeIdcap(serial, overrides));
    await page.goto(stack.url);
    await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
    return page;
  };
  const fake = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  const setDetail = async (serial) => { const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json.find((x) => x.serial === serial); return (await stack.api('GET', `/api/admin/sets/${set.id}`, undefined, cookie)).json; };
  return { stack, cookie, open, fake, setDetail };
}

test('controlled app absent from the list: status asked by licensed id, registered exactly once, then two more boots register nothing', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t, ['netflix', 'amazon']);
  // boot 1: Netflix is not in application/list (LG hides controlled apps until registered) and
  // register/status says auth:false; amazon is listed and authorised
  let page = await s.open('B3D0001', { __hideUntilRegistered: ['netflix'] });
  await page.waitForFunction(() => (window.__fake.registered || []).length >= 1, null, { timeout: 10000 });
  await page.waitForFunction(() => !window.__cc.state.appsHold, null, { timeout: 10000 });
  let f = await s.fake(page);
  assert.equal(f.calls.filter((c) => c.uri === 'idcap://application/register').length, 1, 'exactly one application/register');
  assert.deepEqual(f.registered[0], { tokenList: [{ id: 'netflix', token: TOK('netflix') }] }, 'one token per call, only the unauthorised app');
  const asked = f.calls.filter((c) => c.uri === 'idcap://application/register/status').map((c) => c.p.id);
  assert.deepEqual([...new Set(asked)].sort(), ['amazon', 'netflix'], 'status asked for licensed ids only, never the other apps: ' + asked);
  // order: status was asked before the register call, and list + status re-read after it
  const idx = (uri, fromEnd) => { const xs = f.calls.map((c, i) => [c.uri, i]).filter(([u]) => u === uri).map(([, i]) => i); return fromEnd ? xs[xs.length - 1] : xs[0]; };
  assert.ok(idx('idcap://application/register/status') < idx('idcap://application/register'), 'status before register');
  assert.ok(idx('idcap://application/list', true) > idx('idcap://application/register'), 'list re-read after register');
  assert.ok(idx('idcap://application/register/status', true) > idx('idcap://application/register'), 'status re-read after register');
  assert.equal(f.appAuth.netflix, 'registered');
  await sleep(300);
  let d = await s.setDetail('B3D0001');
  const statusEv = d.events.filter((e) => e.type === 'tv_apps_status');
  assert.ok(statusEv.length >= 2, 'status reported before and after');
  for (const e of statusEv) assert.deepEqual(Object.keys(e.payload.status).sort(), ['amazon', 'netflix'], 'tv_apps_status carries licensed ids only');
  const reason = d.events.find((e) => e.type === 'tv_apps_registration_reason');
  assert.deepEqual(reason.payload.sending, ['netflix']);
  const nf = reason.payload.apps.find((a) => a.id === 'netflix');
  assert.deepEqual([nf.in_list, nf.activated, nf.status.auth], [false, false, false], 'evidence: absent from the list, status says auth:false');
  assert.deepEqual(reason.payload.apps.find((a) => a.id === 'amazon').activated, true);
  const reg = d.events.find((e) => e.type === 'tv_apps_registration');
  assert.deepEqual(reg.payload.results, [{ id: 'netflix', tokenResult: 'success', ok: true }]);
  assert.equal(statusEv[0].payload.status.netflix.auth, true, 'after registration the set says auth:true (events are newest first)');
  assert.equal(statusEv[statusEv.length - 1].payload.status.netflix.auth, false, 'the first report said auth:false');
  const apps = (await s.stack.api('GET', '/api/admin/apps', undefined, s.cookie)).json;
  assert.equal(apps.find((a) => a.app_id === 'netflix').activation, 'activated');
  await page.close();
  // boots 2 and 3: the set remembers the activation (auth:true) → no application/register at all
  for (let boot = 2; boot <= 3; boot++) {
    page = await s.open('B3D0001', { __appAuth: { netflix: 'registered' } });
    await page.waitForFunction(() => window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 10000 });
    await sleep(800);
    f = await s.fake(page);
    assert.equal(f.calls.filter((c) => c.uri === 'idcap://application/register').length, 0, `boot ${boot}: no application/register`);
    assert.deepEqual([...new Set(f.calls.filter((c) => c.uri === 'idcap://application/register/status').map((c) => c.p.id))].sort(), ['amazon', 'netflix']);
    await page.close();
  }
  d = await s.setDetail('B3D0001');
  assert.equal(d.commands.filter((c) => c.type === 'register_apps').length, 0, 'server queued nothing');
  assert.equal(d.events.filter((e) => e.type === 'tv_apps_registration').length, 1, 'one registration in total');
});

test('apps zone stays empty until the boot activation finishes; register_apps command after boot is skipped when authorised', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t, ['netflix']);
  const page = await s.open('B3D0005', { __hideUntilRegistered: ['netflix'] });
  await page.waitForFunction(() => window.__cc.state.appsHold === true || (window.__fake.registered || []).length >= 1, null, { timeout: 10000 });
  const heldEmpty = await page.evaluate(() => window.__cc.state.appsHold ? window.__cc.state.apps.length : null);
  await page.waitForFunction(() => window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 10000 });
  if (heldEmpty !== null) assert.equal(heldEmpty, 0, 'no tiles while the activation sequence runs');
  // admin "Register now" afterwards: status says auth:true → skipped, no second application/register
  const run = await s.stack.api('POST', '/api/admin/apps/activation/run', {}, s.cookie);
  assert.equal(run.status, 200, JSON.stringify(run.json));
  await sleep(1200);
  const f = await s.fake(page);
  assert.equal(f.calls.filter((c) => c.uri === 'idcap://application/register').length, 1, 'still just the boot registration');
  const d = await s.setDetail('B3D0005');
  const cmd = d.commands.find((c) => c.type === 'register_apps');
  assert.ok(cmd, 'command was queued by the explicit admin action'); assert.equal(cmd.status, 'acked'); assert.equal(cmd.result.ok, true); assert.match(String(cmd.result.skipped), /auth: true/);
  await page.close();
});

test('an unknown licensed id (airplay): status query fails → registered once → "fail" marks the licence → not retried', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t, ['netflix', 'airplay']);
  let page = await s.open('B3D0003', { __appAuth: { netflix: 'registered' }, __tokenResults: { airplay: 'fail' } });
  await page.waitForFunction(() => window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 10000 });
  await sleep(500);
  let f = await s.fake(page);
  assert.deepEqual(f.registered.map((r) => r.tokenList.map((x) => x.id)), [['airplay']], 'only airplay (netflix is auth:true)');
  let d = await s.setDetail('B3D0003');
  const reason = d.events.find((e) => e.type === 'tv_apps_registration_reason');
  const ap = reason.payload.apps.find((a) => a.id === 'airplay');
  assert.deepEqual([ap.in_list, ap.activated, ap.status.error], [false, false, 'IDCAP_RESULT_FAILURE'], 'a failed status query for a licensed id counts as not authorised');
  const bad = d.events.find((e) => e.type === 'tv_apps_registration');
  assert.equal(bad.payload.ok, false); assert.deepEqual(bad.payload.results, [{ id: 'airplay', tokenResult: 'fail', errorMessage: 'IDCAP_RESULT_FAILURE', ok: false }]);
  const lics = (await s.stack.api('GET', '/api/admin/licences', undefined, s.cookie)).json.licences;
  const row = lics.find((l) => l.app_id === 'airplay');
  assert.ok(row.failed, 'licence marked failed'); assert.equal(row.failed.model, '43UM670H0UA'); assert.equal(row.failed.message, 'IDCAP_RESULT_FAILURE');
  assert.equal(lics.find((l) => l.app_id === 'netflix').failed, null);
  await page.close();
  page = await s.open('B3D0003', { __appAuth: { netflix: 'registered' }, __tokenResults: { airplay: 'fail' } });
  await page.waitForFunction(() => window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 10000 });
  await sleep(500);
  f = await s.fake(page);
  assert.equal((f.registered || []).length, 0, 'failed licence is not retried');
  const act = await page.evaluate(() => window.__cc.state.activation);
  assert.deepEqual(act.tokenList.map((x) => x.id), ['netflix'], 'the failed token is not sent to the set');
  assert.deepEqual(act.status_ids.sort(), ['airplay', 'netflix'], 'its status is still asked so the admin sees it');
  await page.close();
  const up = await s.stack.api('PATCH', `/api/admin/licences/${row.id}`, { app_id: 'com.apple.airplay' }, s.cookie);
  assert.equal(up.status, 200); assert.equal(up.json.failed, null);
});

test('boot channel_changed failure is ignored when no tuner channel is selected', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const page = await s.open('B3D0004', { __appAuth: {} });
  await page.evaluate(() => window.__fakeEvent('idcap::channel_changed', { result: false, errorMessage: 'IDCAP_RESULT_FAILURE' }));
  await sleep(500);
  const d = await s.setDetail('B3D0004');
  assert.ok(!d.events.some((e) => e.type === 'tv_error' && e.payload.kind === 'channel_changed'), 'no tv_error');
  const ev = d.events.find((e) => e.type === 'tv_channel_event');
  assert.ok(ev && ev.payload.ignored === true && ev.payload.error === 'IDCAP_RESULT_FAILURE');
  assert.equal(d.last_error, null);
  await page.close();
});
