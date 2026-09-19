'use strict';
// D4b: (1) a "fail" from application/register without internet is never a licence failure, and the
// registration re-runs the moment network_event_received says the internet is back; (2) the TV's own
// channel-change banner is suppressed per group setting (BANNER_SELECT / osd_lock) with the value
// read back in tv_boot.
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
  await stack.api('POST', '/api/admin/licences', { files: [{ filename: 'NETFLIX_caritech.lic', content: TOK('netflix') }] }, cookie);
  await stack.api('PATCH', '/api/admin/tenant', { settings: { netflix_hotel_id: 'HOTEL-1' } }, cookie);
  const layout = { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', x: 0, y: 0, w: 800, h: 80, text: 'x' }, { id: 'a', type: 'apps', x: 0, y: 200, w: 1200, h: 300 }], pages: [{ id: 'home', name: 'Home', zones: ['t', 'a'] }], home: 'home' };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id }, cookie);
  // one browser context per test so localStorage (the renderer's cache) survives page.close() → next boot
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); t.after(() => ctx.close());
  const open = async (serial, overrides) => {
    const page = await ctx.newPage();
    await page.addInitScript(fakeIdcap(serial, overrides));
    await page.goto(stack.url);
    await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
    return page;
  };
  const fake = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  const setDetail = async (serial) => { const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json.find((x) => x.serial === serial); return (await stack.api('GET', `/api/admin/sets/${set.id}`, undefined, cookie)).json; };
  const licence = async () => (await stack.api('GET', '/api/admin/licences', undefined, cookie)).json.licences[0];
  return { stack, cookie, open, fake, setDetail, licence };
}
const regCalls = (f) => f.calls.filter((c) => c.uri === 'idcap://application/register').length;

test('no internet at boot: nothing is registered, the reason says so, and network_event_received triggers status → register → re-read', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const page = await s.open('D4B0001', { __internet: false, __appAuth: { netflix: 'unregistered' } });
  await page.waitForFunction(() => window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 10000 });
  await sleep(400);
  let f = await s.fake(page);
  assert.equal(regCalls(f), 0, 'no application/register without internet');
  let d = await s.setDetail('D4B0001');
  const boot = d.events.find((e) => e.type === 'tv_boot');
  assert.equal(boot.payload.internet, false);
  const reason = d.events.find((e) => e.type === 'tv_apps_registration_reason' && e.payload.trigger === 'boot');
  assert.ok(reason, 'boot reason event');
  assert.match(reason.payload.skipped, /no internet connection/); assert.deepEqual(reason.payload.postponed, ['netflix']); assert.equal(reason.payload.internet, false);
  assert.equal((await s.licence()).failed, null, 'licence untouched');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.apps .tile, .app-tile, [data-app-id]').length), 0, 'apps zone empty while Netflix is not authorised');
  // the internet comes back
  await page.evaluate(() => { window.__fake.internet = true; window.__fakeEvent('idcap::network_event_received', {}); });
  await page.waitForFunction(() => (window.__fake.registered || []).length >= 1, null, { timeout: 10000 });
  await page.waitForFunction(() => !window.__cc.state.registering && !window.__cc.state.appsHold, null, { timeout: 10000 });
  await sleep(400);
  f = await s.fake(page);
  assert.equal(regCalls(f), 1, 'exactly one application/register after the network came back');
  assert.equal(f.appAuth.netflix, 'registered');
  d = await s.setDetail('D4B0001');
  const net = d.events.find((e) => e.type === 'tv_network'); assert.ok(net && net.payload.internet === true && net.payload.was === false, 'tv_network event');
  const r2 = d.events.find((e) => e.type === 'tv_apps_registration_reason' && e.payload.trigger === 'network_restored');
  assert.ok(r2, 'reason logged with trigger network_restored'); assert.deepEqual(r2.payload.sending, ['netflix']);
  const reg = d.events.find((e) => e.type === 'tv_apps_registration'); assert.equal(reg.payload.trigger, 'network_restored'); assert.equal(reg.payload.ok, true);
  assert.equal((await s.licence()).failed, null);
  // a second network event with everything authorised registers nothing more
  await page.evaluate(() => { window.__fake.internet = false; });
  await page.evaluate(() => window.__fakeEvent('idcap::network_event_received', {}));
  await sleep(300);
  await page.evaluate(() => { window.__fake.internet = true; window.__fakeEvent('idcap::network_event_received', {}); });
  await sleep(1200);
  f = await s.fake(page);
  assert.equal(regCalls(f), 1, 'authorised app is never re-registered');
  await page.close();
});

test('internet drops during registration: the "fail" is reported with internet:false, not counted, no backoff; retried on network_event_received', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const page = await s.open('D4B0002', { __internetDropsOnRegister: true, __appAuth: { netflix: 'unregistered' } });
  await page.waitForFunction(() => window.__cc.state.bootRegistered && !window.__cc.state.appsHold, null, { timeout: 15000 });
  await sleep(500);
  let f = await s.fake(page);
  assert.equal(regCalls(f), 1, 'one attempt at boot');
  assert.equal(f.internet, false);
  let d = await s.setDetail('D4B0002');
  const reg = d.events.find((e) => e.type === 'tv_apps_registration');
  assert.ok(reg, 'registration reported'); assert.equal(reg.payload.internet, false); assert.equal(reg.payload.offline, true); assert.equal(reg.payload.ok, null);
  assert.equal(reg.payload.results[0].tokenResult, 'fail'); assert.equal(reg.payload.results[0].offline, true); assert.equal(reg.payload.results[0].ok, null);
  assert.ok(!d.events.some((e) => e.type === 'tv_error' && e.payload.kind === 'app_registration'), 'no tv_error for a fail without internet');
  assert.equal((await s.licence()).failed, null, 'licence not marked failed');
  assert.ok(s.stack.logs.some((l) => /"fail" on .* while the set had no internet — not counted/.test(l)), s.stack.logs.filter((l) => /licences/.test(l)).join('\n'));
  // network back → one more register, success
  await page.evaluate(() => { window.__fake.internet = true; window.__fakeEvent('idcap::network_event_received', {}); });
  await page.waitForFunction(() => (window.__fake.registered || []).length >= 2, null, { timeout: 10000 });
  await page.waitForFunction(() => !window.__cc.state.registering, null, { timeout: 10000 });
  await sleep(400);
  f = await s.fake(page);
  assert.equal(regCalls(f), 2); assert.equal(f.appAuth.netflix, 'registered');
  d = await s.setDetail('D4B0002');
  assert.ok(d.events.some((e) => e.type === 'tv_apps_registration' && e.payload.trigger === 'network_restored' && e.payload.ok === true));
  assert.equal((await s.licence()).failed, null);
  await page.close();
});

test('TV OSD: default hides the banner (BANNER_SELECT=1, read back in tv_boot); osd_lock mode holds osd_lock=1, releases it for an app launch and restores it on return; off leaves the set alone', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  // no group → default {mode: banner, banner_select: 1}
  let page = await s.open('D4B0003', { __appAuth: {} });
  await page.waitForFunction(() => window.__cc.state.tvOsdResult, null, { timeout: 10000 });
  await sleep(300);
  let f = await s.fake(page);
  assert.deepEqual(f.installerSets, [{ item: 107, value: 1 }], 'Installer Menu 107 written once');
  assert.equal(f.installer['107'], 1);
  assert.equal(f.props.osd_lock, undefined, 'osd_lock untouched in banner mode');
  let d = await s.setDetail('D4B0003');
  // the boot came from the server (no cache): tv_boot has no read-back yet, the tv_osd event carries it
  const osdEv = d.events.find((e) => e.type === 'tv_osd');
  assert.ok(osdEv, 'tv_osd event'); assert.equal(osdEv.payload.mode, 'banner'); assert.deepEqual([osdEv.payload.banner_select.before, osdEv.payload.banner_select.after], [0, 1]);
  await page.close();
  // second boot: the cache carries the setting → applied before tv_boot and read back in it (already 1 → unchanged)
  page = await s.open('D4B0003', { __appAuth: {}, __installer: { 107: 1 } });
  await page.waitForFunction(() => window.__cc.state.tvOsdResult, null, { timeout: 10000 });
  await sleep(300);
  d = await s.setDetail('D4B0003');
  const boots = d.events.filter((e) => e.type === 'tv_boot');
  assert.ok(boots[0].payload.tv_osd && boots[0].payload.tv_osd.banner_select.unchanged === true && boots[0].payload.tv_osd.banner_select.after === 1, JSON.stringify(boots[0].payload.tv_osd));
  f = await s.fake(page); assert.equal(f.installerSets.length, 0, 'not rewritten when already at the wanted value');
  await page.close();

  // group with osd_lock mode and BANNER_SELECT=0
  const cookie = s.cookie;
  const g = (await s.stack.api('POST', '/api/admin/groups', { name: 'Lock' }, cookie)).json;
  const gp = await s.stack.api('PATCH', `/api/admin/groups/${g.id}`, { hide_tv_osd: 'osd_lock', banner_select: 0 }, cookie);
  assert.equal(gp.status, 200, gp.text); assert.equal(gp.json.hide_tv_osd, 'osd_lock'); assert.equal(gp.json.banner_select, 0);
  const set = (await s.stack.api('GET', '/api/admin/sets', undefined, cookie)).json.find((x) => x.serial === 'D4B0003');
  await s.stack.api('PATCH', `/api/admin/sets/${set.id}`, { group_id: g.id }, cookie);
  page = await s.open('D4B0003', { __appAuth: {}, __installer: { 107: 1 } });
  await page.waitForFunction(() => window.__cc.state.tvOsdResult && window.__cc.state.tvOsdResult.mode === 'osd_lock', null, { timeout: 10000 });
  await sleep(200);
  f = await s.fake(page);
  assert.deepEqual(f.installerSets, [{ item: 107, value: 0 }]); assert.equal(f.props.osd_lock, '1', 'osd_lock held while the portal is in front');
  // launching an app releases it; coming back restores it
  await page.evaluate(() => window.__cc.doAction({ type: 'launch_app', app_id: 'youtube.leanback.v4' }));
  await page.waitForFunction(() => window.__fake.props.osd_lock === '0', null, { timeout: 5000 });
  await page.waitForFunction(() => window.__fake.launched.length >= 1, null, { timeout: 5000 });
  f = await s.fake(page); assert.equal(f.launched.length, 1, 'app launched after the release');
  assert.ok(f.calls.findIndex((c) => c.uri === 'idcap://configuration/property/set' && c.p.key === 'osd_lock' && c.p.value === '0') < f.calls.findIndex((c) => c.uri === 'idcap://application/launch'), 'osd_lock released before the launch');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(100);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForFunction(() => window.__fake.props.osd_lock === '1', null, { timeout: 5000 });
  // on_destroy releases it
  await page.evaluate(() => window.__fakeEvent('idcap::on_destroy', {}));
  await page.waitForFunction(() => window.__fake.props.osd_lock === '0', null, { timeout: 5000 });
  await sleep(400);   // the read-back + event go out after the property flip
  d = await s.setDetail('D4B0003');
  const lockEvents = d.events.filter((e) => e.type === 'tv_osd' && e.payload.osd_lock).map((e) => e.payload.osd_lock.why);
  assert.ok(lockEvents.includes('boot') && lockEvents.includes('launch youtube.leanback.v4') && lockEvents.includes('resumed') && lockEvents.includes('on_destroy'), lockEvents.join(','));
  await page.close();

  // off: nothing written, and switching a live set back to off releases the lock
  await s.stack.api('PATCH', `/api/admin/groups/${g.id}`, { hide_tv_osd: 'off' }, cookie);
  page = await s.open('D4B0003', { __appAuth: {}, __installer: { 107: 0 } });
  await page.waitForFunction(() => window.__cc.state.tvOsdResult && window.__cc.state.tvOsdResult.mode === 'off', null, { timeout: 10000 });
  await sleep(200);
  f = await s.fake(page);
  assert.equal(f.installerSets.length, 0, 'nothing written in off mode');
  // the cache still said osd_lock → applied first, then released when the server's state says off
  assert.notEqual(f.props.osd_lock, '1'); assert.deepEqual(page.evaluate ? await page.evaluate(() => window.__cc.state.tvOsdResult.osd_lock && window.__cc.state.tvOsdResult.osd_lock.why) : null, 'setting off');
  await page.close();
});
