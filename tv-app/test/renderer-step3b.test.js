'use strict';
// Step 3b: overlay/OSD scaling on a 1280x720 set, INFO banner, digit OSD, error forwarding,
// WARM power mode, display_resolution scaling of video coordinates.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const LAYOUT = { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [
  { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 }, { id: 'chlist', type: 'channel_list', x: 80, y: 240, w: 480, h: 560 }],
  screens: [{ id: 'home', zones: ['tv', 'chlist'] }, { id: 'fullscreen', zones: ['tv'] }] };

async function setup(t, { viewport = { width: 1280, height: 720 }, osd = '1280x720', powerMode = null } = {}) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const c5 = (await stack.api('POST', '/api/admin/channels', { number: 5, name: 'News', type: 'ip', params: { ip: '239.1.1.5', port: 5000 } }, cookie)).json;
  const c7 = (await stack.api('POST', '/api/admin/channels', { number: 7, name: 'Sports', type: 'ip', params: { ip: '239.1.1.7', port: 5000 } }, cookie)).json;
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: [c5.id, c7.id] }, cookie)).json;
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: LAYOUT }, cookie)).json;
  const g = (await stack.api('POST', '/api/admin/groups', { name: 'G' }, cookie)).json;
  await stack.api('PATCH', `/api/admin/groups/${g.id}`, { power_mode: powerMode }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/layout`, { layout_id: l.id }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/lineup`, { lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport });
  const logs = []; page.on('console', (m) => { const t = m.text(); if (t.startsWith('[coopcentric]')) logs.push(t.slice(14)); });
  await page.addInitScript(fakeIdcap('305MAXX1Z123', { display_resolution: osd }));
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__fake && window.__fake.props.serial_number && document.querySelector('#stage .zone'), null, { timeout: 8000 });
  await sleep(500);
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  await stack.api('PATCH', `/api/admin/sets/${set.id}`, { group_id: g.id }, cookie);
  await page.waitForFunction(() => window.__fake.videoSize, null, { timeout: 8000 });
  await sleep(300);
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  const inView = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1; });
  return { stack, cookie, page, logs, key, fake, inView, set, g };
}

test('1280x720 set: video coords scale to display_resolution; banner, digits and popup are on screen', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const f = await s.fake();
  // 640,120,1200x675 on a 1920x1080 canvas → 2/3 on a 1280x720 OSD
  assert.deepEqual(f.videoSize, { x: 427, y: 80, width: 800, height: 450 });
  // INFO → banner with number, name and clock, inside the viewport
  await s.key(0x1C9);
  const bannerText = await s.page.$eval('.banner.show', (e) => e.textContent);
  assert.match(bannerText, /5\s+News\s+\d\d:\d\d/);
  assert.equal(await s.inView('.banner.show'), true, 'banner visible on a 720p set');
  // digits OSD top-right, visible
  await s.key(0x37);
  assert.equal(await s.page.$eval('.digits.show', (e) => e.textContent), '7');
  assert.equal(await s.inView('.digits.show'), true, 'digit OSD visible');
  const dr = await s.page.$eval('.digits.show', (e) => e.getBoundingClientRect());
  assert.ok(dr.right > 1280 * 0.75 && dr.top < 720 * 0.25, 'digits are top-right');
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.7', null, { timeout: 5000 });
  // message command popup visible; persistent message bar visible too, and they coexist
  const cmd = (await s.stack.api('POST', `/api/admin/sets/${s.set.id}/commands`, { type: 'message', payload: { text: 'Popup here', ttl_s: 60 } }, s.cookie)).json;
  await s.page.waitForFunction(() => document.querySelector('.popup.show'), null, { timeout: 5000 });
  await s.stack.api('POST', '/api/admin/messages', { text: 'Bar here', target_type: 'all' }, s.cookie);
  await s.page.waitForFunction(() => document.querySelector('.message.show'), null, { timeout: 5000 });
  assert.equal(await s.inView('.popup.show'), true); assert.equal(await s.inView('.message.show'), true);
  assert.equal(await s.page.$eval('.popup.show', (e) => e.textContent), 'Popup here');
  // fullscreen on a 720p set → full OSD rect
  await s.key(0x25A); await sleep(200);
  assert.deepEqual((await s.fake()).videoSize, { x: 0, y: 0, width: 1280, height: 720 });
  await s.page.close();
});

test('errors and ws lifecycle reach the server log; WARM group writes instant_power, never powermode/set', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t, { viewport: { width: 1920, height: 1080 }, osd: '1920x1080', powerMode: 'WARM' });
  await s.page.waitForFunction(() => String(window.__fake.props.instant_power) === '1', null, { timeout: 8000 });
  assert.equal((await s.fake()).powerMode, 'NORMAL', 'powermode/set is never called by the renderer');
  assert.equal((await s.fake()).calls.filter((c) => c.uri === 'idcap://power/powermode/set').length, 0);
  // a failing channel change is reported with kind tune
  await s.page.evaluate(() => { const orig = window.idcap.request; window.__fake.failNext = true; window.idcap.request = function (uri, o) {
    if (uri === 'idcap://tv/channel/change/request' && window.__fake.failNext) { window.__fake.failNext = false; setTimeout(function () { o.onSuccess({}); window.__fakeEvent('idcap::channel_changed', { result: false, errorMessage: 'no signal on 239.1.1.7' }); }, 10); return; }
    return orig.call(this, uri, o); }; });
  await s.key(0x1AB);
  await s.page.waitForFunction(() => /no signal/.test(document.querySelector('.banner').textContent), null, { timeout: 5000 });
  await sleep(300);
  let detail = (await s.stack.api('GET', `/api/admin/sets/${s.set.id}`, undefined, s.cookie)).json;
  assert.equal(detail.last_error.kind, 'tune');
  assert.match(detail.last_error.message, /no signal on 239\.1\.1\.7/);
  assert.ok(s.stack.logs.some((l) => /TV ERROR set/.test(l)));
  // ws lifecycle: kill the socket server-side; the close event is queued and delivered on reconnect
  s.stack.hub.send(s.set.id, { type: 'noop' });
  await s.page.evaluate(() => window.__cc.state.ws.close());
  await s.page.waitForFunction(() => window.__cc.state.ws && window.__cc.state.ws.readyState === 1, null, { timeout: 15000 });
  await sleep(300);
  detail = (await s.stack.api('GET', `/api/admin/sets/${s.set.id}`, undefined, s.cookie)).json;
  const kinds = detail.events.filter((e) => e.type === 'tv_ws').map((e) => e.payload.kind);
  assert.ok(kinds.includes('close') && kinds.includes('open'), JSON.stringify(kinds));
  assert.ok(detail.events.find((e) => e.type === 'tv_ws' && e.payload.kind === 'open' && e.payload.reconnect === true));
  await s.page.close();
});
