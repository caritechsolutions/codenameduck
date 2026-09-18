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
async function setup(t) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const lic = await stack.api('POST', '/api/admin/licences', { files: [
    { filename: 'NETFLIX_caritech.lic', content: TOK('netflix') }, { filename: 'AMAZON_caritech.lic', content: TOK('amazon') }, { filename: 'AirPlay_caritech.lic', content: TOK('airplay') }] }, cookie);
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

test('boot twice with all apps authorised → zero application/register calls (airplay absent from the list is no reason)', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  for (let boot = 1; boot <= 2; boot++) {
    const page = await s.open('B3D0001', { __appAuth: {} });   // netflix, youtube, amazon, browser all "registered"; airplay not in application/list
    await sleep(1800);
    const f = await s.fake(page);
    assert.equal(f.calls.filter((c) => c.uri === 'idcap://application/register').length, 0, `boot ${boot}: no application/register`);
    assert.ok(f.calls.some((c) => c.uri === 'idcap://application/register/status'), 'status was read');
    await page.close();
  }
  const d = await s.setDetail('B3D0001');
  assert.equal(d.commands.filter((c) => c.type === 'register_apps').length, 0, 'server queued nothing');
  assert.ok(!d.events.some((e) => e.type === 'tv_apps_registration'), 'no registration event');
  const reasons = d.events.filter((e) => e.type === 'tv_apps_registration_reason');
  assert.equal(reasons.length, 0, 'nothing to explain when nothing is needed');
});

test('only the unauthorised app is registered, with the reason logged; "fail" marks the licence and stops retries', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  // amazon reports unregistered; netflix is fine → only the amazon token goes out
  let page = await s.open('B3D0002', { __appAuth: { amazon: 'unregistered' } });
  await page.waitForFunction(() => (window.__fake.registered || []).length >= 1, null, { timeout: 10000 });
  await sleep(800);
  let f = await s.fake(page);
  assert.equal(f.registered.length, 1);
  assert.deepEqual(f.registered[0].tokenList.map((x) => x.id), ['amazon']);
  let d = await s.setDetail('B3D0002');
  const reason = d.events.find((e) => e.type === 'tv_apps_registration_reason' && e.payload.trigger !== 'server_register');
  assert.ok(reason, 'reason event: ' + d.events.map((e) => e.type));
  assert.deepEqual(reason.payload.sending, ['amazon']);
  // the evidence per app: whichever path won (the server's command carries only the amazon token,
  // the boot path evaluates every licence), amazon must read "in the list, not authorised"
  const byId = Object.fromEntries(reason.payload.apps.map((a) => [a.id, a]));
  assert.deepEqual([byId.amazon.in_list, byId.amazon.activated, byId.amazon.status.status], [true, false, 'unregistered']);
  if (byId.netflix) assert.deepEqual([byId.netflix.in_list, byId.netflix.activated], [true, true]);
  if (byId.airplay) assert.deepEqual([byId.airplay.in_list, byId.airplay.status, byId.airplay.activated], [false, null, null]);
  assert.ok(['boot', 'command'].includes(reason.payload.trigger));
  const reg = d.events.find((e) => e.type === 'tv_apps_registration');
  assert.equal(reg.payload.ok, true); assert.deepEqual(reg.payload.results, [{ id: 'amazon', tokenResult: 'success', ok: true }]);
  await page.close();

  // airplay is in this set's list and reports unregistered; LG answers "fail" → licence marked, no retry on the next boot
  page = await s.open('B3D0003', { __appAuth: { airplay: 'unregistered' }, __appList: [{ id: 'netflix', title: 'Netflix' }, { id: 'airplay', title: 'AirPlay' }], __tokenResults: { airplay: 'fail' } });
  await page.waitForFunction(() => (window.__fake.registered || []).length >= 1, null, { timeout: 10000 });
  await sleep(1000);
  f = await s.fake(page);
  assert.deepEqual(f.registered[0].tokenList.map((x) => x.id), ['airplay']);
  d = await s.setDetail('B3D0003');
  const bad = d.events.find((e) => e.type === 'tv_apps_registration');
  assert.equal(bad.payload.ok, false); assert.deepEqual(bad.payload.results, [{ id: 'airplay', tokenResult: 'fail', errorMessage: 'IDCAP_RESULT_FAILURE', ok: false }]);
  assert.ok(d.events.some((e) => e.type === 'tv_error' && e.payload.kind === 'app_registration') || d.commands.some((c) => c.type === 'register_apps' && c.status === 'failed'), 'failure is visible');
  const lics = (await s.stack.api('GET', '/api/admin/licences', undefined, s.cookie)).json.licences;
  const ap = lics.find((l) => l.app_id === 'airplay');
  assert.ok(ap.failed, 'licence marked failed'); assert.equal(ap.failed.model, '43UM670H0UA'); assert.equal(ap.failed.message, 'IDCAP_RESULT_FAILURE');
  assert.equal(lics.find((l) => l.app_id === 'netflix').failed, null);
  await page.close();
  page = await s.open('B3D0003', { __appAuth: { airplay: 'unregistered' }, __appList: [{ id: 'netflix', title: 'Netflix' }, { id: 'airplay', title: 'AirPlay' }], __tokenResults: { airplay: 'fail' } });
  await sleep(1800);
  f = await s.fake(page);
  assert.equal((f.registered || []).length, 0, 'failed licence is not retried');
  assert.deepEqual((await page.evaluate(() => (window.__cc.state.activation || {}).tokenList.map((x) => x.id))).sort(), ['amazon', 'netflix'], 'the failed token is not even sent to the set');
  await page.close();
  // editing the id clears the failure and the token is offered again
  const up = await s.stack.api('PATCH', `/api/admin/licences/${ap.id}`, { app_id: 'com.apple.airplay' }, s.cookie);
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
