'use strict';
// Phase 3 Part C on the set: guest variables arrive live at check-in, the checkout command runs
// LG's tv/checkout/request, wipes local state, reloads the app and the room goes vacant; the
// checkout message survives the reload (and only that).
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

test('check-in pushes guest variables, checkout wipes + reloads, message shown after reload', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  await stack.api('PATCH', '/api/admin/tenant', { settings: { timezone: 'Europe/Amsterdam', checkout_message: 'Thank you for staying with us' } }, cookie);
  const layout = { schema: 2, canvas: { w: 1920, h: 1080 }, zones: [
    { id: 'hello', type: 'text', x: 80, y: 80, w: 1700, h: 100, text: 'Hello {{guest_first}} {{guest_last}} · {{nights}} nights · out {{checkout_date}} · room {{room}}', style: { fontSize: 40, color: '#fff' } },
  ], pages: [{ id: 'home', name: 'Home', zones: ['hello'] }], home: 'home' };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('C0001', { __appAuth: {} }));
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json.find((s) => s.serial === 'C0001');
  await stack.api('PATCH', `/api/admin/sets/${set.id}`, { room_number: '101' }, cookie);
  await page.waitForFunction(() => /room 101/.test(document.getElementById('zone-hello').textContent), null, { timeout: 5000 });
  assert.equal(await page.$eval('#zone-hello', (e) => e.textContent), 'Hello   ·  nights · out  · room 101', 'vacant: blank guest variables');
  await page.evaluate(() => { localStorage.setItem('cc_last_channel', '7'); });
  // reservation for today, checked in by hand → the set shows the guest without a reboot
  const today = (await stack.api('GET', '/api/admin/pms/settings', undefined, cookie)).json.today;
  const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 3);
  const res = await stack.api('POST', '/api/admin/reservations', { room_number: '101', first_name: 'Jane', last_name: 'Doe', checkin_date: today, checkout_date: d.toISOString().slice(0, 10) }, cookie);
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const ci = await stack.api('POST', `/api/admin/reservations/${res.json.id}/checkin`, undefined, cookie);
  assert.equal(ci.status, 200, JSON.stringify(ci.json));
  await page.waitForFunction(() => /Jane Doe/.test(document.getElementById('zone-hello').textContent), null, { timeout: 5000 });
  assert.equal(await page.$eval('#zone-hello', (e) => e.textContent), `Hello Jane Doe · 3 nights · out ${d.toISOString().slice(0, 10)} · room 101`);
  assert.equal(await page.evaluate(() => window.__cc.state.context.occupied), true);
  // check-out: LG checkout call, local state wiped, note kept for after the reload, app reloads, room vacant
  const co = await stack.api('POST', `/api/admin/reservations/${res.json.id}/checkout`, undefined, cookie);
  assert.equal(co.status, 200, JSON.stringify(co.json)); assert.equal(co.json.status, 'checked_out');
  await page.waitForFunction(() => window.__fake.checkedOut === true, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__fake.launched.some((x) => x.reload), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('cc_last_channel')), null, 'localStorage wiped');
  assert.equal(await page.evaluate(() => localStorage.getItem('cc_checkout_note')), 'Thank you for staying with us');
  await page.waitForFunction(() => !/Jane/.test(document.getElementById('zone-hello').textContent), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__cc.state.context.occupied), false);
  await sleep(300);
  const detail = (await stack.api('GET', `/api/admin/sets/${set.id}`, undefined, cookie)).json;
  const cmd = detail.commands.find((c) => c.type === 'checkout');
  assert.ok(cmd, 'checkout command recorded'); assert.equal(cmd.status, 'acked'); assert.deepEqual(cmd.result, { checkout: true, reload: true });
  assert.ok(detail.events.some((e) => e.type === 'tv_checkout'), 'checkout event');
  // the real reload: nothing of the guest survives, the checkout message shows once
  await page.reload();
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
  await page.waitForFunction(() => /Thank you for staying/.test((document.querySelector('#overlay .popup.show') || {}).textContent || ''), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('cc_checkout_note')), null, 'note shown once');
  assert.equal(await page.evaluate(() => window.__cc.state.context.guest), '');
  await page.close();
});
