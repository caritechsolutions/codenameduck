'use strict';
// Step 3 renderer tests: video zone tuning, channel list, remote keys, commands.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const LAYOUT = {
  schema: 1, canvas: { w: 1920, h: 1080, background: '#000' },
  zones: [
    { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675, source: 'lineup', startChannel: 'first' },
    { id: 'chlist', type: 'channel_list', x: 80, y: 240, w: 480, h: 560, style: { fontSize: 28, highlight: '#ffd166' } },
    { id: 'menu', type: 'menu', x: 80, y: 60, w: 400, h: 160, items: [{ label: 'Full screen', action: 'fullscreen_tv' }, { label: 'Info page', action: 'show_page', page: 'info' }] },
    { id: 'info', type: 'html', x: 200, y: 200, w: 800, h: 400, hidden: true, html: '<b>Hotel info page</b>' },
    { id: 'clock', type: 'clock', x: 1600, y: 980, w: 240, h: 60 },
  ],
  keys: { PORTAL: 'toggle_menu', BACK: 'close_page' },
  screens: [{ id: 'home', zones: ['tv', 'chlist', 'menu', 'clock'] }, { id: 'fullscreen', zones: ['tv'] }],
};

async function setup(t) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const chan = async (n, name, params = { ip: `239.1.1.${n}`, port: 5000 }, type = 'ip') => (await stack.api('POST', '/api/admin/channels', { number: n, name, type, params }, cookie)).json;
  const c5 = await chan(5, 'News'), c7 = await chan(7, 'Sports'), c9 = await chan(9, 'Movies HLS', { url: 'http://media.test/m.m3u8' });
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: [c5.id, c7.id, c9.id] }, cookie)).json;
  const g = (await stack.api('POST', '/api/admin/groups', { name: 'G' }, cookie)).json;
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: LAYOUT }, cookie)).json;
  await stack.api('PUT', `/api/admin/groups/${g.id}/layout`, { layout_id: l.id }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/lineup`, { lineup_id: lu.id }, cookie);
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, default_lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[coopcentric]')) logs.push(t.slice(14)); });
  await page.addInitScript(fakeIdcap('305MAXX1Z123'));
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__fake && window.__fake.channel && window.__fake.videoSize, null, { timeout: 10000 });
  await sleep(300);
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const current = () => page.$eval('#zone-chlist .chrow.current', (e) => e.textContent).catch(() => null);
  const setRow = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  return { stack, cookie, page, logs, fake, key, current, set: setRow, channels: { c5, c7, c9 }, layout: l };
}

test('video zone: tunes first channel, places video after channel_changed, claims keys, channel list highlights', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  const f = await s.fake();
  assert.deepEqual(f.channel, { channelType: 'ip', ip: '239.1.1.5', port: 5000, ipBroadcastType: 'udp' });
  assert.deepEqual(f.videoSize, { x: 640, y: 120, width: 1200, height: 675 }, 'video/size/set matches the zone at 1920x1080 OSD');
  assert.equal(f.keys.CH_UP, 1); assert.equal(f.keys.NUM_5, 1); assert.equal(f.keys.PORTAL, 1);
  assert.equal(f.keys.VOL_UP, undefined, 'volume keys left to the TV');
  assert.match(await s.current(), /5\s*News/);
  const calls = f.calls.map((c) => c.uri);
  assert.ok(calls.indexOf('idcap://tv/channel/change/request') < calls.lastIndexOf('idcap://video/size/set'), 'size set after channel change');
  await s.page.close();
});

test('remote keys: CH+/- walk the lineup, digits tune by number, PORTAL toggles fullscreen, menu + BACK', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  await s.key(0x1AB); // CH_UP
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.7', null, { timeout: 5000 });
  assert.match(await s.current(), /7\s*Sports/);
  await s.key(0x1AB); // → 9 = HLS url → HTML5 <video> first; unreachable here → platform media fallback
  await s.page.waitForFunction(() => window.__fake.media && window.__fake.media.url === 'http://media.test/m.m3u8', null, { timeout: 20000 });
  let f = await s.fake();
  assert.equal(f.media.mimeType, 'application/x-mpegURL');
  const uris = f.calls.map((c) => c.uri);
  assert.ok(uris.includes('idcap://tv/media/startup') && uris.includes('idcap://tv/media/create') && uris.includes('idcap://tv/media/control'));
  assert.ok(await s.page.$('#videohost video.urlvideo'), 'the single video element lives in the persistent host');
  assert.ok(s.logs.some((l) => /ERROR media: HTML5 video failed/.test(l)), 'HTML5 failure reported');
  await s.key(0x1AB); // wraps to 5 → media must be torn down before tuning
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.5' && window.__fake.media === null, null, { timeout: 5000 });
  f = await s.fake();
  const after = f.calls.map((c) => c.uri + (c.p.command ? ':' + c.p.command : ''));
  const i = after.lastIndexOf('idcap://tv/channel/change/request');
  assert.ok(after.slice(0, i).includes('idcap://tv/media/destroy') && after.slice(0, i).includes('idcap://tv/media/shutdown'), 'destroy+shutdown before channel change');
  await s.key(0x1AC); // CH_DOWN wraps to 9
  await s.page.waitForFunction(() => window.__fake.media && window.__fake.media.url, null, { timeout: 20000 });

  // digits: "7" then wait → tunes 7; shows digits overlay meanwhile
  await s.key(0x37);
  assert.equal(await s.page.$eval('.digits', (e) => e.textContent), '7');
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.7', null, { timeout: 5000 });
  assert.match(await s.page.$eval('.banner', (e) => e.textContent), /7\s+Sports/);
  // ENTER commits immediately; unknown number shows a banner and keeps channel
  await s.key(0x31); await s.key(0x0D);
  await sleep(200);
  assert.match(await s.page.$eval('.banner', (e) => e.textContent), /no such channel/);
  assert.equal((await s.fake()).channel.ip, '239.1.1.7');

  // PORTAL → fullscreen screen: only the video zone stays; PORTAL again → home
  await s.key(0x25A);
  await sleep(150);
  assert.deepEqual(await s.page.$$eval('#stage .zone', (els) => els.map((e) => e.id)), ['zone-tv']);
  assert.deepEqual(await s.page.$eval('#zone-tv', (e) => [e.style.left, e.style.top, e.style.width, e.style.height]), ['0px', '0px', '1920px', '1080px'], 'fullscreen screen expands the video zone');
  assert.deepEqual((await s.fake()).videoSize, { x: 0, y: 0, width: 1920, height: 1080 }, 'tuner video repositioned to full OSD');
  await s.key(0x25A);
  await sleep(150);
  assert.ok((await s.page.$$eval('#stage .zone', (els) => els.map((e) => e.id))).includes('zone-chlist'));
  assert.deepEqual((await s.fake()).videoSize, { x: 640, y: 120, width: 1200, height: 675 });
  // menu: DOWN focuses second item, ENTER opens the hidden html page, BACK closes it
  await s.key(0x28); await s.key(0x28);
  assert.equal(await s.page.$eval('#zone-menu .menuitem.focused', (e) => e.textContent), 'Info page');
  await s.key(0x0D);
  await sleep(100);
  assert.equal(await s.page.$eval('#zone-info', (e) => e.textContent), 'Hotel info page');
  await s.key(0x1CD);
  await sleep(100);
  assert.equal(await s.page.$('#zone-info'), null);
  await s.page.close();
});

test('commands: tune, volume, mute, message, toast, screenshot upload, reboot, launch_app; heartbeat carries channel', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  await s.page.waitForFunction(() => /ws connected/.test(window.__lastLog || '') || true, null, { timeout: 3000 });
  await sleep(500);
  const cmd = (type, payload) => s.stack.api('POST', `/api/admin/sets/${s.set.id}/commands`, { type, payload }, s.cookie).then((r) => r.json);
  const status = async (id) => (await s.stack.api('GET', `/api/admin/sets/${s.set.id}/commands`, undefined, s.cookie)).json.find((c) => c.id === id);
  const waitAck = async (id) => { for (let i = 0; i < 40; i++) { const c = await status(id); if (c && c.status !== 'sent' && c.status !== 'queued') return c; await sleep(100); } throw new Error('no ack'); };

  let c = await cmd('tune', { channel_id: s.channels.c7.id });
  assert.equal(c.status, 'sent', 'delivered live over WS');
  assert.equal((await waitAck(c.id)).status, 'acked');
  assert.equal((await s.fake()).channel.ip, '239.1.1.7');
  c = await cmd('volume', { level: 33 }); assert.equal((await waitAck(c.id)).status, 'acked'); assert.equal((await s.fake()).volume, 33);
  c = await cmd('mute', { mute: true }); assert.equal((await waitAck(c.id)).status, 'acked'); assert.equal((await s.fake()).mute, true);
  c = await cmd('message', { text: 'Fire drill at 10:00', ttl_s: 60 }); assert.equal((await waitAck(c.id)).status, 'acked');
  assert.equal(await s.page.$eval('.popup.show', (e) => e.textContent), 'Fire drill at 10:00');
  const pr = await s.page.$eval('.popup.show', (e) => { const r = e.getBoundingClientRect(); return [r.top >= 0, r.bottom <= window.innerHeight, r.width > 0]; });
  assert.deepEqual(pr, [true, true, true], 'popup is inside the viewport');
  c = await cmd('toast', { text: 'hi' }); assert.equal((await waitAck(c.id)).status, 'acked'); assert.deepEqual((await s.fake()).toasts, ['hi']);
  const toastCall = (await s.fake()).calls.find((x) => x.uri === 'idcap://utility/toastmsg/create');
  assert.deepEqual(Object.keys(toastCall.p), ['msg']);
  c = await cmd('screenshot', {});
  const shot = await waitAck(c.id);
  assert.equal(shot.status, 'acked', JSON.stringify(shot.result));
  assert.ok(shot.result.bytes > 0, JSON.stringify(shot.result));
  const img = await s.stack.api('GET', `/api/admin/sets/${s.set.id}/screenshot`, undefined, s.cookie);
  assert.equal(img.status, 200);
  await s.stack.api('PATCH', '/api/admin/tenant', { settings: { netflix_hotel_id: 'HOTEL-1' } }, s.cookie);   // B3c: Netflix needs a hotel id
  await sleep(300);
  c = await cmd('launch_app', { app_id: 'netflix' }); assert.equal((await waitAck(c.id)).status, 'acked'); assert.equal((await s.fake()).launched[0].id, 'netflix');
  c = await cmd('reboot', {}); assert.equal((await waitAck(c.id)).status, 'acked'); assert.equal((await s.fake()).rebooted, 1);
  c = await cmd('tune', { number: 999 }); assert.equal((await waitAck(c.id)).status, 'failed');
  // heartbeat reflects channel + volume from the platform
  const row = s.stack.db.prepare('SELECT channel, volume FROM sets WHERE id = ?').get(s.set.id);
  assert.equal(row.channel, '7');
  // lineup save pushes live: removing channel 7 retunes to first
  await s.stack.api('PUT', `/api/admin/lineups/${(await s.stack.api('GET', '/api/admin/lineups', undefined, s.cookie)).json[0].id}`, { channel_ids: [s.channels.c5.id] }, s.cookie);
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.5', null, { timeout: 5000 });
  assert.equal(await s.page.$$eval('#zone-chlist .chrow', (els) => els.length), 1);
  await s.page.close();
});
