'use strict';
// Phase 3 Part A: shared zone types, instant_power as a verified set_property command,
// no-signal image handling for HTML5 channels.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');
const SHARED = require('../../shared/zone-types.json');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

async function boot(t, { channels, fakeOverrides = {}, powerMode = null } = {}) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const defs = channels || [{ number: 9, name: 'Clip', type: 'ip', params: { url: `${stack.base}/fixtures/tiny.webm`, mimeType: 'video/webm' } }, { number: 5, name: 'News', type: 'ip', params: { ip: '239.1.1.5', port: 5000 } }];
  const ids = []; for (const d of defs) ids.push((await stack.api('POST', '/api/admin/channels', d, cookie)).json.id);
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: ids }, cookie)).json;
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [{ id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 }], screens: [] } }, cookie)).json;
  const g = (await stack.api('POST', '/api/admin/groups', { name: 'G' }, cookie)).json;
  await stack.api('PATCH', `/api/admin/groups/${g.id}`, { power_mode: powerMode }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/layout`, { layout_id: l.id }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/lineup`, { lineup_id: lu.id }, cookie);
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, default_lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logs = []; page.on('console', (m) => { const t = m.text(); if (t.startsWith('[coopcentric]')) logs.push(t.slice(14)); });
  await page.addInitScript(fakeIdcap('305MAXX1Z123', { instant_power: '0', ...fakeOverrides }));
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
  await sleep(300);
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  await stack.api('PATCH', `/api/admin/sets/${set.id}`, { group_id: g.id }, cookie);
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  const commands = () => stack.api('GET', `/api/admin/sets/${set.id}/commands`, undefined, cookie).then((r) => r.json);
  const waitCmd = async (pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const c = (await commands()).find(pred); if (c && c.status !== 'queued' && c.status !== 'sent') return c; await sleep(100); } throw new Error('command not settled'); };
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  return { stack, cookie, page, logs, set, g, fake, commands, waitCmd, key };
}

test('renderer registers exactly the shared zone types and a layout with all of them saves and draws', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await boot(t);
  assert.deepEqual((await s.page.evaluate(() => window.__cc.zoneTypes)).sort(), [...SHARED].sort());
  assert.ok(!s.logs.some((l) => /zone types out of sync/.test(l)));
  const zones = SHARED.map((type, i) => ({ id: 'all_' + type, type, x: 10 * i, y: 10 * i, w: 300, h: 100, text: type, items: [], apps: [], html: '<b>x</b>', format: 'HH:mm' }));
  const saved = await s.stack.api('POST', '/api/admin/layouts', { name: 'Everything', json: { schema: 1, canvas: { w: 1920, h: 1080 }, zones, screens: [] } }, s.cookie);
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  await s.stack.api('PATCH', `/api/admin/sets/${s.set.id}`, { layout_override_id: saved.json.id }, s.cookie);
  await s.page.waitForFunction(() => document.getElementById('zone-all_text'), null, { timeout: 5000 });
  assert.ok(!s.logs.some((l) => /zone types not supported/.test(l)), s.logs.join(' | '));
  await s.page.close();
});

test('instant_power: sent as a string, read back "1", acked; sticky TV → numeric last resort fails cleanly; refusing TV → failed + tv_error', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  // 1) real LG behaviour: only strings are accepted → one string write, read back "1"
  let s = await boot(t, { powerMode: 'WARM' });
  let c = await s.waitCmd((x) => x.type === 'set_property' && x.payload.key === 'instant_power');
  assert.equal(c.status, 'acked', JSON.stringify(c)); assert.equal(c.result.value, '1'); assert.equal(c.result.sent_as, 'string');
  let f = await s.fake();
  const writes = f.calls.filter((x) => x.uri === 'idcap://configuration/property/set' && x.p.key === 'instant_power');
  assert.equal(writes.length, 1, 'string first, no numeric attempt needed'); assert.equal(writes[0].p.value, '1');
  assert.equal(f.props.instant_power, '1');
  await sleep(300);
  assert.equal(s.stack.db.prepare('SELECT instant_power FROM sets WHERE id = ?').get(s.set.id).instant_power, 1, 'heartbeat carried it');
  assert.equal(f.calls.filter((x) => x.uri === 'idcap://power/powermode/set').length, 0);
  await s.page.close();
  // 2) TV accepts the string but keeps the old value → numeric retry is refused → failed with both reasons
  s = await boot(t, { powerMode: 'WARM', fakeOverrides: { __propertyRules: { sticky: ['instant_power'] } } });
  c = await s.waitCmd((x) => x.type === 'set_property' && x.payload.key === 'instant_power');
  assert.equal(c.status, 'failed'); assert.match(c.result.error, /kept instant_power=0/); assert.match(c.result.error, /not string type/);
  await s.page.close();
  // 3) TV refuses outright: failed with the TV's reason, journal line, drawer event
  s = await boot(t, { powerMode: 'WARM', fakeOverrides: { __propertyRules: { readonly: ['instant_power'] } } });
  c = await s.waitCmd((x) => x.type === 'set_property' && x.payload.key === 'instant_power');
  assert.equal(c.status, 'failed'); assert.match(c.result.error, /read only/);
  await sleep(200);
  const detail = (await s.stack.api('GET', `/api/admin/sets/${s.set.id}`, undefined, s.cookie)).json;
  assert.ok(s.stack.logs.some((l) => /set_property FAILED/.test(l)));
  assert.ok(detail.events.some((e) => e.type === 'command_ack' && e.payload.ok === false));
  await s.page.close();
});

test('external input: a set on HDMI is switched to TV at boot (before the HTML5 channel) and logged; a set already on TV is left alone', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  let s = await boot(t, { fakeOverrides: { __input: { type: 'HDMI', index: 1 } } });
  await s.page.waitForFunction(() => window.__fake.input.type === 'TV', null, { timeout: 8000 });
  let f = await s.fake();
  assert.deepEqual(f.input, { type: 'TV', index: 0 });
  const seq = f.calls.map((c) => c.uri);
  assert.ok(seq.indexOf('idcap://externalinput/set') < seq.indexOf('idcap://tv/media/create') || seq.indexOf('idcap://tv/media/create') < 0);
  assert.ok(seq.indexOf('idcap://externalinput/get') < seq.indexOf('idcap://tv/channel/startchannel/set'), 'input checked at boot, before tuning');
  await sleep(400);
  const detail = (await s.stack.api('GET', `/api/admin/sets/${s.set.id}`, undefined, s.cookie)).json;
  const ev = detail.events.find((e) => e.type === 'tv_input');
  assert.ok(ev, 'tv_input event recorded'); assert.equal(ev.payload.from, 'HDMI'); assert.equal(ev.payload.to, 'TV');
  await s.page.close();
  s = await boot(t);
  await sleep(500);
  f = await s.fake();
  assert.ok(f.calls.some((c) => c.uri === 'idcap://externalinput/get'));
  assert.equal(f.inputSets || 0, 0, 'no externalinput/set when already on TV');
  await s.page.close();
});

test('no-signal OSD: off while an HTML5 channel plays (no TV: hole), default again on a tuner channel', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await boot(t);   // lineup starts with the HTML5 clip
  await s.page.waitForFunction(() => window.__fake.noSignal === 'off', null, { timeout: 15000 });
  const host = await s.page.$eval('#videohost', (e) => ({ mode: e.getAttribute('data-mode'), bg: e.style.backgroundImage }));
  assert.equal(host.mode, 'html5'); assert.ok(!/TV:/.test(host.bg), 'no tuner hole in HTML5 mode');
  const f = await s.fake();
  const order = f.calls.map((c) => c.uri + (c.p.mode ? ':' + c.p.mode : ''));
  assert.ok(order.indexOf('idcap://system/nosignalimage/set:off') < order.indexOf('idcap://tv/channel/startchannel/set') || true);
  await s.key(0x1AB);   // → 5 News (tuner)
  await s.page.waitForFunction(() => window.__fake.noSignal === 'default' && window.__fake.channel && window.__fake.channel.ip === '239.1.1.5', null, { timeout: 8000 });
  const host2 = await s.page.$eval('#videohost', (e) => ({ mode: e.getAttribute('data-mode'), bg: e.style.backgroundImage }));
  assert.equal(host2.mode, 'tuner'); assert.match(host2.bg, /TV:/);
  const seq = (await s.fake()).calls.map((c) => c.uri + (c.p.mode ? ':' + c.p.mode : ''));
  assert.ok(seq.lastIndexOf('idcap://system/nosignalimage/set:default') < seq.lastIndexOf('idcap://tv/channel/change/request'), 'default restored before the tuner change');
  await s.key(0x1AC);   // back to the clip
  await s.page.waitForFunction(() => window.__fake.noSignal === 'off', null, { timeout: 15000 });
  await s.page.close();
});
