'use strict';
// Renderer end-to-end tests: real server + built renderer in headless Chromium with the fake
// IDCAP middleware. Run: npm test (after npm run build). Skips if Chromium is unavailable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

async function openRenderer(stack, { serial = '305MAXX1Z123', query = '', fake = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[coopcentric]')) logs.push(t.slice(14)); });
  if (fake) await page.addInitScript(fakeIdcap(serial));
  await page.goto(stack.url + query);
  const zones = () => page.$$eval('#stage .zone', (els) => els.map((e) => ({ id: e.id.replace('zone-', ''), text: e.textContent, type: e.className.replace('zone zone-', '') })));
  const waitLog = (re, timeout = 8000) => page.waitForFunction((src) => !!window.__lastLog && new RegExp(src).test(window.__lastLog), re.source, { timeout }).catch(() => {});
  return { page, logs, zones, waitLog };
}

test('boots over fake IDCAP, registers, shows the unassigned screen with the serial, connects WS', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const stack = await startStack(); t.after(stack.close);
  const r = await openRenderer(stack);
  await r.page.waitForFunction(() => document.querySelectorAll('#stage .zone').length > 0, null, { timeout: 8000 });
  const z = await r.zones();
  assert.equal(z.find((x) => x.id === 'serial').text, '305MAXX1Z123');
  assert.ok(z.find((x) => x.id === 'title').text.includes('not yet assigned'));
  assert.ok(r.logs.some((l) => l === 'API: IDCAP'));
  // set registered with factory room ignored, WS connected within a couple of seconds
  await sleep(1200);
  const row = stack.db.prepare('SELECT * FROM sets WHERE serial = ?').get('305MAXX1Z123');
  assert.equal(row.room_number, null);
  assert.equal(row.reported_room, '[TV]305MAXX1Z123');
  assert.equal(row.model, '43UM670H0UA');
  assert.equal(stack.hub.isConnected(row.id), true, 'renderer connected over WebSocket');
  assert.ok(row.app_version, 'heartbeat carried app_version');
  await r.page.close();
});

test('room + group assignment pushes layout and set_property live; layout save re-renders', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const stack = await startStack(); t.after(stack.close);
  const r = await openRenderer(stack);
  await r.page.waitForFunction(() => document.querySelectorAll('#stage .zone').length > 0, null, { timeout: 8000 });
  await sleep(800);
  const cookie = await stack.login();
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  const g = (await stack.api('POST', '/api/admin/groups', { name: 'G' }, cookie)).json;
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: { schema: 1, canvas: { w: 1920, h: 1080, background: '#123' },
    zones: [{ id: 'w', type: 'text', x: 100, y: 100, w: 1000, h: 100, text: 'Room {{room}} at {{hotel}}' }, { id: 'i', type: 'image', x: 0, y: 300, w: 200, h: 100, src: '/procentric/application/nope.png' }, { id: 'c', type: 'clock', x: 1500, y: 980, w: 300, h: 60, format: 'HH:mm' }], screens: [] } }, cookie)).json;
  await stack.api('PUT', `/api/admin/groups/${g.id}/layout`, { layout_id: l.id }, cookie);
  await stack.api('PATCH', `/api/admin/sets/${set.id}`, { room_number: '204', group_id: g.id }, cookie);
  await r.page.waitForFunction(() => /Room 204/.test(document.body.textContent), null, { timeout: 5000 });
  let z = await r.zones();
  assert.equal(z.find((x) => x.id === 'w').text, 'Room 204 at e2e');
  assert.equal(z.find((x) => x.id === 'i').type, 'image');
  assert.match(z.find((x) => x.id === 'c').text, /^\d\d:\d\d$/);
  // set_property command executed on the fake middleware and acked
  await r.page.waitForFunction(() => window.__fake.props.room_number === '204', null, { timeout: 5000 });
  await sleep(300);
  const cmds = (await stack.api('GET', `/api/admin/sets/${set.id}`, undefined, cookie)).json.commands;
  assert.deepEqual(cmds.map((c) => c.type + ':' + c.status), ['set_property:acked']);
  // save layout → live redraw with v2
  await stack.api('PUT', `/api/admin/layouts/${l.id}`, { json: { ...l.json, zones: [{ ...l.json.zones[0], text: 'UPDATED {{room}}' }], pages: [{ id: 'home', name: 'Home', zones: ['w'] }] } }, cookie);
  await r.page.waitForFunction(() => /UPDATED 204/.test(document.body.textContent), null, { timeout: 5000 });
  z = await r.zones();
  assert.equal(z.length, 1);
  assert.ok(r.logs.some((x) => /layout: L v2/.test(x)), r.logs.join(' | '));
  // preview shows without saving, deleting the set makes the renderer re-register
  await stack.api('POST', `/api/admin/sets/${set.id}/preview`, { json: { schema: 1, zones: [{ id: 'p', type: 'text', text: 'PREVIEW' }] } }, cookie);
  await r.page.waitForFunction(() => /PREVIEW/.test(document.body.textContent), null, { timeout: 5000 });
  await stack.api('DELETE', `/api/admin/sets/${set.id}`, undefined, cookie);
  await r.page.waitForFunction(() => /not yet assigned/.test(document.body.textContent), null, { timeout: 8000 });
  assert.equal(stack.db.prepare('SELECT COUNT(*) n FROM sets').get().n, 1, 'set re-registered as new');
  await r.page.close();
});

test('browser mode: no middleware → local hint; ?serial= registers', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const stack = await startStack(); t.after(stack.close);
  const r = await openRenderer(stack, { fake: false, query: '?serial=BROWSER1' });
  await r.page.waitForFunction(() => { const z = document.querySelector('#zone-serial'); return z && /BROWSER1/.test(z.textContent); }, null, { timeout: 20000 });
  assert.ok(r.logs.some((l) => /browser mode/.test(l)));
  assert.equal(stack.db.prepare('SELECT COUNT(*) n FROM sets').get().n, 1);
  await r.page.close();
});
