'use strict';
// Step 5 renderer tests: weather zone, messages bar, app launcher, checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

test('weather zone, persistent messages, app launcher, checkout command', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const stack = await startStack({ weatherFetch: async () => ({ current: { temperature_2m: 21.4, weather_code: 2, wind_speed_10m: 5, relative_humidity_2m: 50 } }) }); t.after(stack.close);
  const cookie = await stack.login();
  await stack.api('PATCH', '/api/admin/tenant', { display_name: 'Hotel Demo', settings: { weather: { lat: 51.5, lon: 4.2, units: 'metric' } } }, cookie);
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'W', json: { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [
    { id: 'wx', type: 'weather', x: 0, y: 0, w: 500, h: 100, style: { fontSize: 40 } },
    { id: 'apps', type: 'app_launcher', x: 0, y: 200, w: 800, h: 200, apps: [{ label: 'Netflix', app_id: 'netflix' }, { label: 'YouTube', app_id: 'youtube.leanback.v4' }] },
    { id: 'logo', type: 'image', x: 1500, y: 0, w: 300, h: 100, src: '{{logo}}' },
  ], screens: [] } }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('305MAXX1Z123'));
  await page.goto(stack.url);
  await page.waitForFunction(() => /21°C/.test(document.body.textContent), null, { timeout: 8000 });
  assert.match(await page.$eval('#zone-wx', (e) => e.textContent), /⛅.*21°C.*Partly cloudy/);
  // {{logo}} resolves to the tenant logo url once one is uploaded
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await stack.api('POST', '/api/admin/assets?as=logo', { data_url: 'data:image/png;base64,' + png.toString('base64') }, cookie);
  await page.waitForFunction(() => { const i = document.querySelector('#zone-logo img'); return i && /assets\/logo\.png/.test(i.getAttribute('src')); }, null, { timeout: 5000 });
  // message to all appears as the red bar, deleting it removes the bar
  const m = (await stack.api('POST', '/api/admin/messages', { text: 'Fire alarm test 15:00', target_type: 'all' }, cookie)).json;
  await page.waitForFunction(() => document.querySelector('.message.show') && /Fire alarm/.test(document.querySelector('.message.show').textContent), null, { timeout: 5000 });
  await stack.api('DELETE', `/api/admin/messages/${m.id}`, undefined, cookie);
  await page.waitForFunction(() => !document.querySelector('.message.show'), null, { timeout: 5000 });
  // app launcher: DOWN focuses first, DOWN second, ENTER launches YouTube
  const key = (c) => page.evaluate((code) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => code }); document.dispatchEvent(e); }, c);
  await key(0x28); await key(0x28); await key(0x0D);
  await page.waitForFunction(() => window.__fake.launched.length === 1, null, { timeout: 5000 });
  assert.equal((await page.evaluate(() => window.__fake.launched[0].id)), 'youtube.leanback.v4');
  // checkout from admin: platform checkout called, ack recorded
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  await stack.api('PATCH', '/api/admin/tenant', { settings: { checkout_message: 'Thank you for staying with us' } }, cookie);
  const co = (await stack.api('POST', `/api/admin/sets/${set.id}/checkout`, undefined, cookie)).json;
  assert.equal(co.command.status, 'sent');
  await page.waitForFunction(() => window.__fake.checkedOut === true, null, { timeout: 5000 });
  // Part C: the renderer reloads itself after the checkout; the message is shown after the reload
  await page.waitForFunction(() => window.__fake.launched.some((x) => x.reload), null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.getItem('cc_checkout_note')), 'Thank you for staying with us');
  await sleep(200);
  const cmds = (await stack.api('GET', `/api/admin/sets/${set.id}/commands`, undefined, cookie)).json;
  assert.equal(cmds.find((c) => c.type === 'checkout').status, 'acked');
  await page.close();
});
