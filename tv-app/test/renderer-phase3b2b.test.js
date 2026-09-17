'use strict';
// Phase 3 B2b: pages + element actions on the set — spatial navigation between focusable
// zones, OK runs the action, BACK pops the page stack, focus ring from the layout, global
// zones inherited from home, toggle action, preview opens on the requested page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const KEY = { LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28, ENTER: 0x0D, BACK: 0x1CD, PORTAL: 0x25A };
const btn = (id, label, x, y, action) => ({ id, type: 'button', x, y, w: 300, h: 80, label, action, style: { fontSize: 30, background: 'rgba(255,255,255,0.15)' }, focusStyle: { background: '#ff0000' } });

// Home: a 2x2 grid of buttons + a clock (global) + text with an action; "Info" page inherits
// the clock and has one button back.
const LAYOUT = { schema: 2, canvas: { w: 1920, h: 1080, background: '#123456' }, zones: [
  { id: 'tv', type: 'video', x: 1200, y: 100, w: 640, h: 360 },
  { id: 'clock', type: 'clock', x: 1600, y: 980, w: 240, h: 60, format: 'HH:mm' },
  { id: 'title', type: 'text', x: 80, y: 40, w: 800, h: 60, text: 'Welcome {{guest_first}}' },
  btn('b_info', 'Hotel info', 80, 200, { type: 'goto_page', page: 'info' }),
  btn('b_tv', 'Watch TV', 480, 200, { type: 'fullscreen_tv' }),
  btn('b_panel', 'Toggle panel', 80, 400, { type: 'toggle', zone: 'panel' }),
  btn('b_tune', 'Tune 5', 480, 400, { type: 'tune', number: 5 }),
  { id: 'panel', type: 'text', x: 80, y: 600, w: 700, h: 200, text: 'Extra panel', style: { background: '#333' } },
  { id: 'infotext', type: 'html', x: 80, y: 200, w: 1000, h: 500, html: '<h1>Info page</h1>' },
  btn('b_back', 'Back home', 80, 800, { type: 'back' }),
  { id: 'link', type: 'text', x: 1200, y: 800, w: 400, h: 60, text: 'Go to info →', action: { type: 'goto_page', page: 'info' } },
], pages: [
  { id: 'home', name: 'Home', zones: ['tv', 'clock', 'title', 'b_info', 'b_tv', 'b_panel', 'b_tune', 'link'], inherit: true },
  { id: 'info', name: 'Hotel info', zones: ['infotext', 'b_back'], inherit: true },
  { id: 'nofocus', name: 'Static', zones: ['title'], inherit: false },
], home: 'home', keys: {}, focus: { color: '#00ff00', width: 8, radius: 20 }, back_on_home: 'fullscreen_tv' };

async function setup(t, layout = LAYOUT) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const defs = [{ number: 1, name: 'One', type: 'ip', params: { ip: '239.1.1.1', port: 5000 } }, { number: 5, name: 'Five', type: 'ip', params: { ip: '239.1.1.5', port: 5000 } }];
  const ids = [];
  for (const d of defs) ids.push((await stack.api('POST', '/api/admin/channels', d, cookie)).json.id);
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: ids }, cookie)).json;
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, default_lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('305MAXX1Z123'));
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId && document.getElementById('zone-b_info'), null, { timeout: 10000 });
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const focused = () => page.evaluate(() => { const e = document.querySelector('#stage .zone.focused, #stage .menuitem.focused, #stage .apptile.focused'); return e ? (e.closest('.zone') || e).getAttribute('data-zone-id') : null; });
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  return { stack, cookie, page, key, focused, fake, set, l };
}

test('spatial navigation between focusable zones, OK runs actions, BACK pops pages, focus ring, toggle', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  assert.equal(await s.page.evaluate(() => window.__cc.state.page), 'home');
  assert.equal(await s.page.evaluate(() => window.__cc.state.layout.schema), 2);
  // nothing focused until a key is pressed; the first DOWN picks the top-left target
  assert.equal(await s.focused(), null);
  await s.key(KEY.DOWN);
  assert.equal(await s.focused(), 'b_info');
  // focus ring comes from layout.focus; focusStyle applied to the focused button
  const ring = await s.page.$eval('#zone-b_info', (e) => ({ outline: getComputedStyle(e).outlineColor, width: getComputedStyle(e).outlineWidth, bg: getComputedStyle(e).backgroundColor, cls: e.className }));
  assert.equal(ring.outline, 'rgb(0, 255, 0)'); assert.equal(ring.width, '8px'); assert.equal(ring.bg, 'rgb(255, 0, 0)'); assert.match(ring.cls, /focusable/);
  await s.key(KEY.RIGHT); assert.equal(await s.focused(), 'b_tv');
  await s.key(KEY.DOWN); assert.equal(await s.focused(), 'b_tune');
  await s.key(KEY.LEFT); assert.equal(await s.focused(), 'b_panel');
  await s.key(KEY.UP); assert.equal(await s.focused(), 'b_info');
  await s.key(KEY.LEFT); assert.equal(await s.focused(), 'b_info', 'nothing to the left: focus stays');
  // the text with an action is focusable too (far right)
  await s.key(KEY.RIGHT); await s.key(KEY.RIGHT);
  assert.equal(await s.focused(), 'link');
  // toggle: shows the panel, then hides it again (LEFT from the far-right text lands on the nearer button first)
  await s.key(KEY.LEFT); assert.equal(await s.focused(), 'b_tune');
  await s.key(KEY.LEFT); assert.equal(await s.focused(), 'b_panel');
  assert.equal(await s.page.$('#zone-panel'), null);
  await s.key(KEY.ENTER);
  await s.page.waitForSelector('#zone-panel', { timeout: 2000 });
  assert.equal(await s.focused(), 'b_panel', 'the highlight survives the redraw a toggle causes');
  await s.key(KEY.ENTER);   // again → hide
  await sleep(100);
  assert.equal(await s.page.$('#zone-panel'), null);
  // tune action
  await s.key(KEY.RIGHT);
  assert.equal(await s.focused(), 'b_tune');
  await s.key(KEY.ENTER);
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.5', null, { timeout: 5000 });
  // goto_page: info page shows its own zones + the inherited clock/tv, not the home buttons
  await s.key(KEY.UP); await s.key(KEY.LEFT);
  assert.equal(await s.focused(), 'b_info');
  await s.key(KEY.ENTER);
  await s.page.waitForSelector('#zone-infotext', { timeout: 3000 });
  assert.equal(await s.page.evaluate(() => window.__cc.state.page), 'info');
  assert.ok(await s.page.$('#zone-clock'), 'clock inherited from home');
  assert.ok(await s.page.$('#zone-tv'), 'video inherited from home');
  assert.equal(await s.page.$('#zone-b_info'), null);
  await s.key(KEY.DOWN); assert.equal(await s.focused(), 'b_back');
  await s.key(KEY.ENTER);   // back action pops to home
  await s.page.waitForSelector('#zone-b_info', { timeout: 3000 });
  assert.equal(await s.page.evaluate(() => window.__cc.state.page), 'home');
  // BACK on home → back_on_home = fullscreen_tv; BACK again leaves fullscreen
  await s.key(KEY.BACK);
  await sleep(150);
  assert.equal(await s.page.evaluate(() => window.__cc.state.fullscreen), true);
  assert.equal(await s.page.$('#zone-b_info'), null);
  assert.equal(await s.page.$eval('#zone-tv', (e) => e.style.width), '1920px');
  await s.key(KEY.BACK);
  await sleep(150);
  assert.equal(await s.page.evaluate(() => window.__cc.state.fullscreen), false);
  // PORTAL toggles full-screen TV; a page with nothing focusable swallows arrows harmlessly
  await s.key(KEY.PORTAL); await sleep(100);
  assert.equal(await s.page.evaluate(() => window.__cc.state.fullscreen), true);
  await s.key(KEY.PORTAL); await sleep(100);
  assert.equal(await s.page.evaluate(() => window.__cc.state.fullscreen), false);
  await s.page.evaluate(() => window.__cc.doAction({ type: 'goto_page', page: 'nofocus' }));
  await sleep(100);
  await s.key(KEY.DOWN);
  assert.equal(await s.focused(), null);
  assert.equal(await s.page.$('#zone-clock'), null, 'inherit: false → no globals from home');
  // events: page changes reach the server
  const events = (await s.stack.api('GET', `/api/admin/sets/${s.set.id}`, undefined, s.cookie)).json.events;
  assert.ok(events.some((e) => e.type === 'tv_page' && /"page":"info"/.test(JSON.stringify(e))));
  await s.page.close();
});

test('preview on set opens on the requested page; a v1 layout still plays (migrated on the set too)', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  await s.page.waitForFunction(() => window.__cc.state.ws && window.__cc.state.ws.readyState === 1, null, { timeout: 5000 });
  const pv = await s.stack.api('POST', `/api/admin/sets/${s.set.id}/preview`, { json: LAYOUT, page: 'info' }, s.cookie);
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  await s.page.waitForSelector('#zone-infotext', { timeout: 3000 });
  assert.equal(await s.page.evaluate(() => window.__cc.state.page), 'info');
  // a v1 document pushed straight to the set is upgraded there: screens → pages, PORTAL still toggles full screen
  const v1 = { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [{ id: 'tv', type: 'video', x: 0, y: 0, w: 960, h: 540 }, { id: 'm', type: 'menu', x: 1000, y: 100, w: 400, h: 200, items: [{ label: 'Info', action: 'show_page', page: 'p' }] }, { id: 'p', type: 'html', x: 0, y: 600, w: 800, h: 300, hidden: true, html: '<b>legacy page</b>' }],
    screens: [{ id: 'home', zones: ['tv', 'm'] }, { id: 'fullscreen', zones: ['tv'] }] };
  await s.stack.api('POST', `/api/admin/sets/${s.set.id}/preview`, { json: v1 }, s.cookie);
  await s.page.waitForSelector('#zone-m', { timeout: 3000 });
  assert.deepEqual(await s.page.evaluate(() => window.__cc.state.layout.pages.map((p) => p.id)), ['home', 'p']);
  await s.key(KEY.DOWN); await s.key(KEY.ENTER);
  await s.page.waitForSelector('#zone-p', { timeout: 3000 });
  assert.equal(await s.page.evaluate(() => window.__cc.state.page), 'p');
  await s.key(KEY.BACK);
  await s.page.waitForSelector('#zone-m', { timeout: 3000 });
  await s.page.close();
});
