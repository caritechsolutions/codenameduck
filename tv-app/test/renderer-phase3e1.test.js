'use strict';
// Phase 3 E1: the channel list is navigable with the arrow keys (highlight separate from the
// playing channel, window scrolls with the highlight, OK tunes, LEFT/RIGHT leave the zone),
// UP/DOWN zap in full screen, OK in full screen shows the banner, and the key claim at boot is
// reported with LG's per-key replies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const KEY = { LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, ENTER: 0x0D, BACK: 0x1CD, PORTAL: 0x25A, CH_UP: 0x1AB, CH_DOWN: 0x1AC };

// Four rows fit in the list (fontSize 30 → 48 px rows, 200 px tall); the lineup has six channels.
const LAYOUT = { schema: 2, canvas: { w: 1920, h: 1080, background: '#123456' }, zones: [
  { id: 'tv', type: 'video', x: 1000, y: 100, w: 800, h: 450 },
  { id: 'list', type: 'channel_list', x: 80, y: 100, w: 600, h: 200, style: { fontSize: 30 } },
  { id: 'btn', type: 'button', x: 80, y: 600, w: 300, h: 80, label: 'Info', action: { type: 'goto_page', page: 'home' } },
], pages: [{ id: 'home', name: 'Home', zones: ['tv', 'list', 'btn'], inherit: true }], home: 'home', keys: {},
  focus: { color: '#00ff00', width: 8, radius: 20 } };

async function setup(t) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const ids = [];
  for (let n = 1; n <= 6; n++) ids.push((await stack.api('POST', '/api/admin/channels', { number: n, name: 'Ch ' + n, type: 'ip', params: { ip: '239.1.1.' + n, port: 5000 } }, cookie)).json.id);
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: ids }, cookie)).json;
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: LAYOUT }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, default_lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('305MAXX1Z123'));
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId && window.__cc.state.channel && document.querySelector('#zone-list .chrow'), null, { timeout: 10000 });
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const focusedRow = () => page.evaluate(() => { const e = document.querySelector('#zone-list .chrow.focused'); return e ? Number(e.getAttribute('data-index')) : null; });
  const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('#zone-list .chrow[data-index]')).map((e) => Number(e.getAttribute('data-index'))));
  const playing = () => page.evaluate(() => window.__cc.state.channel && window.__cc.state.channel.number);
  const fakeChannel = () => page.evaluate(() => window.__fake.channel && window.__fake.channel.ip);
  return { stack, cookie, page, key, focusedRow, rows, playing, fakeChannel, set: (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0] };
}

test('E1: arrow keys walk the channel list, OK tunes, CH± still zap directly', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  assert.equal(await s.playing(), 1);
  assert.deepEqual(await s.rows(), [0, 1, 2, 3], 'four rows visible, window at the top');
  // first DOWN picks the top-left target: the first row of the list
  await s.key(KEY.DOWN);
  assert.equal(await s.focusedRow(), 0);
  // moving the highlight does not tune
  await s.key(KEY.DOWN); await s.key(KEY.DOWN); await s.key(KEY.DOWN);
  assert.equal(await s.focusedRow(), 3);
  assert.equal(await s.playing(), 1, 'highlight moved, channel unchanged');
  // past the visible window: the list scrolls with the highlight
  await s.key(KEY.DOWN);
  assert.equal(await s.focusedRow(), 4);
  assert.deepEqual(await s.rows(), [2, 3, 4, 5], 'window scrolled');
  await s.key(KEY.DOWN);
  assert.equal(await s.focusedRow(), 5);
  // at the last row DOWN falls through to spatial navigation and lands on the button below
  await s.key(KEY.DOWN);
  assert.equal(await s.focusedRow(), null);
  assert.equal(await s.page.evaluate(() => { const e = document.querySelector('#stage .zone.focused'); return e && e.getAttribute('data-zone-id'); }), 'btn');
  // back up into the list (nearest row from below), OK tunes the highlighted channel
  await s.key(KEY.UP);
  const row = await s.focusedRow();
  assert.ok(row >= 2 && row <= 5, 'UP from the button lands on a visible row, got ' + row);
  await s.key(KEY.ENTER);
  await s.page.waitForFunction((n) => window.__cc.state.channel && window.__cc.state.channel.number === n, row + 1, { timeout: 5000 });
  await s.page.waitForFunction((ip) => window.__fake.channel && window.__fake.channel.ip === ip, '239.1.1.' + (row + 1), { timeout: 5000 });
  assert.equal(await s.fakeChannel(), '239.1.1.' + (row + 1), 'tune request went to LG');
  // the playing channel is marked current, the highlight stays separate
  const marks = await s.page.evaluate(() => ({ current: Number(document.querySelector('#zone-list .chrow.current').getAttribute('data-index')), focused: Number(document.querySelector('#zone-list .chrow.focused').getAttribute('data-index')) }));
  assert.equal(marks.current, row); assert.equal(marks.focused, row);
  // CH+ still zaps directly, independent of the highlight
  await s.key(KEY.CH_UP);
  await s.page.waitForFunction((n) => window.__cc.state.channel.number === n, (row + 1) % 6 + 1, { timeout: 5000 });
  assert.equal(await s.focusedRow(), row, 'zapping does not move the highlight (focus=' + JSON.stringify(await s.page.evaluate(() => window.__cc.state.focus)) + ')');
  // LEFT/RIGHT leave the zone to the nearest other focusable element (here the only one, the button)
  await s.key(KEY.LEFT);
  assert.equal(await s.focusedRow(), null);
  assert.equal(await s.page.evaluate(() => window.__cc.state.focus.zone), 'btn');
  await s.key(KEY.UP);
  assert.notEqual(await s.focusedRow(), null, 'UP from the button returns to the list');
});

test('E1: full screen — UP/DOWN zap, OK shows the banner', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  await s.key(KEY.PORTAL);
  assert.equal(await s.page.evaluate(() => window.__cc.state.fullscreen), true);
  await s.key(KEY.UP);
  await s.page.waitForFunction(() => window.__cc.state.channel.number === 2, null, { timeout: 5000 });
  await s.key(KEY.DOWN);
  await s.page.waitForFunction(() => window.__cc.state.channel.number === 1, null, { timeout: 5000 });
  await s.key(KEY.ENTER);
  const shown = await s.page.evaluate(() => { const b = document.querySelector('#overlay .banner'); return b && /show/.test(b.className) && b.textContent; });
  assert.match(String(shown), /Ch 1/);
  await s.key(KEY.PORTAL);
  assert.equal(await s.page.evaluate(() => window.__cc.state.fullscreen), false);
});

test('E1: the boot key claim is reported with per-key results', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  await sleep(500);
  const detail = (await s.stack.api('GET', '/api/admin/sets/' + s.set.id, undefined, s.cookie)).json;
  const keys = (detail.events || []).filter((e) => e.type === 'tv_keys');
  assert.ok(keys.length >= 1, 'tv_keys event recorded; got ' + (detail.events || []).map((e) => e.type).join(','));
  const p = keys[0].payload;
  assert.equal(p.attribute, 1);
  assert.ok(p.results.some((r) => r.key === 'CH_UP' && r.ok === true), JSON.stringify(p.results).slice(0, 200));
});
