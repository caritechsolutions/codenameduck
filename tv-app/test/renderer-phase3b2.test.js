'use strict';
// Phase 3 B2: shared drawing module on the set — {{time}}/{{date}} variables tick, bundled
// fonts and the shared stylesheet are served from the app tree, show_screen menu action.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const KEY = { DOWN: 0x28, ENTER: 0x0D, BACK: 0x1CD };

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t, type: res.headers['content-type'] })); }).on('error', reject);
  });
}

async function setup(t) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const layout = { schema: 1, canvas: { w: 1920, h: 1080, background: '#123456' }, zones: [
    { id: 'hello', type: 'text', x: 80, y: 60, w: 1200, h: 90, text: 'Room {{room}} · {{time}} · {{date}}', style: { fontSize: 48, fontFamily: 'Inter', fontWeight: 'bold', fontStyle: 'italic', shadow: 'soft' } },
    { id: 'menu', type: 'menu', x: 80, y: 200, w: 500, h: 300, items: [{ label: 'Channels', action: 'show_screen', screen: 'channels' }, { label: 'Info', action: 'show_page', page: 'info' }], style: { fontSize: 36, highlight: '#ffd166' } },
    { id: 'chlist', type: 'channel_list', x: 700, y: 200, w: 500, h: 400, style: { fontSize: 28 } },
    { id: 'info', type: 'html', x: 100, y: 600, w: 800, h: 300, hidden: true, html: '<h1>{{hotel}}</h1>' },
  ], screens: [{ id: 'home', zones: ['hello', 'menu'] }, { id: 'channels', zones: ['hello', 'chlist'] }] };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, display_name: 'Hotel Test' }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('305MAXX1Z123'));
  await page.goto(stack.url);
  await page.waitForSelector('#zone-hello', { timeout: 10000 });
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  return { stack, page, key };
}

test('shared drawers on the set: live variables, fonts + zones.css served, show_screen action', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  // stylesheet + fonts come from the app tree (same origin, cacheable)
  const css = await fetchText(`${s.stack.base}/procentric/application/zones.css`);
  assert.equal(css.status, 200); assert.match(css.text, /\.chrow\{display:flex/);
  const fonts = await fetchText(`${s.stack.base}/procentric/application/fonts/fonts.css`);
  assert.equal(fonts.status, 200); assert.match(fonts.text, /font-family:"Inter"/);
  const woff = await new Promise((resolve) => http.get(`${s.stack.base}/procentric/application/fonts/inter.woff2`, (r) => { r.resume(); resolve(r.statusCode); }));
  assert.equal(woff, 200);
  // text zone: variables substituted, {{time}} marked live, style applied via the shared applyStyle
  const hello = await s.page.$eval('#zone-hello', (e) => ({ text: e.textContent, live: e.getAttribute('data-live-text'), font: getComputedStyle(e).fontFamily, weight: getComputedStyle(e).fontWeight, style: getComputedStyle(e).fontStyle, shadow: getComputedStyle(e).textShadow }));
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  assert.ok(hello.text.startsWith('Room ') && hello.text.includes(hhmm), hello.text);
  assert.match(hello.text, /\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(hello.live, '1');
  assert.match(hello.font, /Inter/); assert.ok(hello.weight === 'bold' || hello.weight === '700'); assert.equal(hello.style, 'italic');
  assert.notEqual(hello.shadow, 'none');
  // the clock ticker rewrites live texts (force a fake "now" by calling the shared tick through the app)
  const ticked = await s.page.evaluate(() => { const e = document.getElementById('zone-hello'); const before = e.textContent; e.textContent = 'stale'; return new Promise((r) => setTimeout(() => r({ before, after: e.textContent }), 1300)); });
  assert.equal(ticked.after, ticked.before, 'tick restored the substituted text');
  // menu: DOWN focuses the first item, OK runs show_screen → channels screen with the channel list
  await s.key(KEY.DOWN);
  assert.equal(await s.page.$eval('#zone-menu .menuitem.focused', (e) => e.textContent), 'Channels');
  await s.key(KEY.ENTER);
  await s.page.waitForSelector('#zone-chlist', { timeout: 3000 });
  assert.equal(await s.page.evaluate(() => window.__cc.state.page), 'channels');
  assert.equal(await s.page.$('#zone-menu'), null);
  assert.equal(await s.page.$eval('#zone-chlist .chrow', (e) => getComputedStyle(e).display), 'flex');   // zones.css is really loaded
  // BACK pops the page stack back home; then the (migrated) info page opens
  await s.key(KEY.BACK);
  await s.page.waitForSelector('#zone-menu', { timeout: 3000 });
  assert.equal(await s.page.evaluate(() => window.__cc.state.page), 'home');
  await s.key(KEY.DOWN);   // a page change resets focus: first DOWN lands on the first item again
  assert.equal(await s.page.$eval('#zone-menu .menuitem.focused', (e) => e.textContent), 'Channels');
  await s.key(KEY.DOWN);
  assert.equal(await s.page.$eval('#zone-menu .menuitem.focused', (e) => e.textContent), 'Info');
  await s.key(KEY.ENTER);
  await s.page.waitForSelector('#zone-info', { timeout: 3000 });
  assert.equal(await s.page.$eval('#zone-info h1', (e) => e.textContent), 'Hotel Test');
  await s.page.close();
});
