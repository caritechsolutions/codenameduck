'use strict';
// Step 3c: persistent video across screen switches, start channel, stop/replay when hidden,
// overlay placement zones, instant_power handling.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

function layout(extraZones = [], screens) {
  return { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [
    { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 }, { id: 'chlist', type: 'channel_list', x: 80, y: 240, w: 480, h: 560 }, ...extraZones],
    screens: screens || [{ id: 'home', zones: ['tv', 'chlist'] }, { id: 'fullscreen', zones: ['tv'] }, { id: 'info', zones: ['chlist'] }] };
}
async function setup(t, { zones, screens, channels, groupInstantPower = null, instantPower = '0' } = {}) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const defs = channels || [{ number: 5, name: 'News', type: 'ip', params: { ip: '239.1.1.5', port: 5000 } }, { number: 9, name: 'Clip', type: 'ip', params: { url: `${stack.base}/fixtures/tiny.webm`, mimeType: 'video/webm' } }];
  const ids = [];
  for (const d of defs) ids.push((await stack.api('POST', '/api/admin/channels', d, cookie)).json.id);
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: ids }, cookie)).json;
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout(zones, screens) }, cookie)).json;
  const g = (await stack.api('POST', '/api/admin/groups', { name: 'G' }, cookie)).json;
  await stack.api('PATCH', `/api/admin/groups/${g.id}`, { instant_power: groupInstantPower }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/layout`, { layout_id: l.id }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/lineup`, { lineup_id: lu.id }, cookie);
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, default_lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logs = []; page.on('console', (m) => { const t = m.text(); if (t.startsWith('[coopcentric]')) logs.push(t.slice(14)); });
  await page.addInitScript(fakeIdcap('305MAXX1Z123', { instant_power: instantPower }));
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__fake && window.__fake.channel, null, { timeout: 10000 });
  await sleep(300);
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  await stack.api('PATCH', `/api/admin/sets/${set.id}`, { group_id: g.id }, cookie);
  await sleep(400);
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  const calls = async (uri) => (await fake()).calls.filter((c) => c.uri === uri).length;
  return { stack, cookie, page, logs, key, fake, calls, set, g, ids };
}

test('HTML5 video survives PORTAL: same element instance, still playing, only geometry changes', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  await s.key(0x1AB);   // → 9 = WebM clip via <video>
  await s.page.waitForFunction(() => { const v = document.getElementById('urlvideo'); return v && !v.paused && v.readyState >= 2 && v.currentTime > 0; }, null, { timeout: 15000 });
  assert.ok(s.logs.some((l) => /tuned 9 Clip \(html5\)/.test(l)), s.logs.join(' | '));
  await s.page.evaluate(() => { window.__v = document.getElementById('urlvideo'); window.__v.__marker = 'same-instance'; });
  const before = await s.page.evaluate(() => ({ src: window.__v.currentSrc, t: window.__v.currentTime, host: document.getElementById('videohost').getBoundingClientRect().width }));
  await s.key(0x25A);   // fullscreen
  await sleep(500);
  const during = await s.page.evaluate(() => { const v = document.getElementById('urlvideo'); const h = document.getElementById('videohost').getBoundingClientRect();
    return { same: v === window.__v && v.__marker === 'same-instance', paused: v.paused, t: v.currentTime, inHost: v.parentNode === document.getElementById('videohost'), w: h.width, h: h.height, x: h.left, y: h.top }; });
  assert.equal(during.same, true, 'same <video> instance after screen switch');
  assert.equal(during.paused, false, 'still playing in fullscreen');
  assert.deepEqual([during.x, during.y, during.w, during.h], [0, 0, 1920, 1080], 'host box is the whole canvas');
  await sleep(400);
  const later = await s.page.evaluate(() => window.__v.currentTime);
  assert.ok(later > during.t, 'time keeps advancing');
  await s.key(0x25A);   // back home
  await sleep(300);
  const after = await s.page.evaluate(() => { const v = document.getElementById('urlvideo'); const h = document.getElementById('videohost').getBoundingClientRect(); return { same: v === window.__v, paused: v.paused, w: h.width, x: h.left }; });
  assert.deepEqual(after, { same: true, paused: false, w: 1200, x: 640 });
  // no media pipeline calls and no re-tune happened during the switches
  assert.equal(await s.calls('idcap://tv/media/create'), 0);
  assert.equal(await s.calls('idcap://tv/channel/change/request'), 1, 'only the initial tune of channel 5');
  await s.page.close();
});

test('tuner channel: screen switch only calls video/size/set; hidden video → channel/stop, shown → replay; start channel programmed', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  let f = await s.fake();
  // start channel = first tuner channel (5), set once after lineup load
  const sc = f.calls.filter((c) => c.uri === 'idcap://tv/channel/startchannel/set');
  assert.equal(sc.length, 1); assert.equal(sc[0].p.ip, '239.1.1.5'); assert.equal(sc[0].p.channelType, 'ip');
  const changes = await s.calls('idcap://tv/channel/change/request');
  await s.key(0x25A); await sleep(300);          // fullscreen
  f = await s.fake();
  assert.deepEqual(f.videoSize, { x: 0, y: 0, width: 1920, height: 1080 });
  assert.equal(f.calls.filter((c) => c.uri === 'idcap://tv/channel/change/request').length, changes, 'no retune on fullscreen');
  assert.equal(await s.calls('idcap://tv/channel/stop'), 0);
  // GUIDE → toggles too; use the layout key map: switch to the "info" screen (no video zone) via a menu? use screen id directly
  await s.page.evaluate(() => window.__cc.doAction({ type: 'goto_page', page: 'info' }));   // the "info" page has no video zone
  await sleep(300);
  assert.equal(await s.calls('idcap://tv/channel/stop'), 1, 'hidden video leaves the multicast group');
  assert.equal(await s.page.$eval('#videohost', (e) => e.style.display), 'none');
  await s.page.evaluate(() => window.__cc.doAction({ type: 'back' }));
  await sleep(300);
  assert.equal(await s.calls('idcap://tv/channel/replay'), 1, 'shown again → replay, not retune');
  assert.equal(await s.calls('idcap://tv/channel/change/request'), changes);
  f = await s.fake();
  assert.deepEqual(f.videoSize, { x: 640, y: 120, width: 1200, height: 675 });
  // lineup with only URL channels → start channel disabled
  await s.stack.api('PUT', `/api/admin/lineups/${(await s.stack.api('GET', '/api/admin/lineups', undefined, s.cookie)).json[0].id}`, { channel_ids: [s.ids[1]] }, s.cookie);
  await s.page.waitForFunction(() => window.__fake.calls.filter((c) => c.uri === 'idcap://tv/channel/startchannel/set').length === 2, null, { timeout: 5000 });
  f = await s.fake();
  assert.equal(f.calls.filter((c) => c.uri === 'idcap://tv/channel/startchannel/set')[1].p.channelType, 'unknown');
  await s.page.close();
});

test('banner placement zone positions the INFO banner; instant_power written from the group, never powermode/set', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t, { zones: [{ id: 'bn', type: 'banner', x: 300, y: 40, w: 900, h: 90, style: { fontSize: 40, background: '#123456' } }], groupInstantPower: 2, instantPower: '0' });
  await s.key(0x1C9);
  const r = await s.page.$eval('.banner.show', (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, bg: getComputedStyle(e).backgroundColor, fs: getComputedStyle(e).fontSize }; });
  assert.deepEqual([r.x, r.y, r.w], [300, 40, 900]);
  assert.equal(r.bg, 'rgb(18, 52, 86)'); assert.equal(r.fs, '40px');
  // instant_power: property written to 1 and read back; powermode/set never called
  await s.page.waitForFunction(() => window.__fake.props.instant_power === '2', null, { timeout: 8000 });
  const f = await s.fake();
  assert.equal(f.calls.filter((c) => c.uri === 'idcap://power/powermode/set').length, 0);
  assert.ok(f.calls.some((c) => c.uri === 'idcap://configuration/property/set' && c.p.key === 'instant_power' && c.p.value === '2'), 'written as the string "2"');
  await sleep(300);
  const row = s.stack.db.prepare('SELECT instant_power FROM sets WHERE id = ?').get(s.set.id);
  assert.equal(row.instant_power, 2, 'heartbeat reported the new value');
  // group → NORMAL pushes 0
  await s.stack.api('PATCH', `/api/admin/groups/${s.g.id}`, { instant_power: 10 }, s.cookie);
  await s.page.waitForFunction(() => window.__fake.props.instant_power === '10', null, { timeout: 8000 });
  await s.stack.api('PATCH', `/api/admin/groups/${s.g.id}`, { instant_power: 0 }, s.cookie);
  await s.page.waitForFunction(() => window.__fake.props.instant_power === '0', null, { timeout: 8000 });
  await s.page.close();
});
