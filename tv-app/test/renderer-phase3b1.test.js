'use strict';
// Phase 3 B1: no tuner raster before the first HTML5 stream has frames — the url('TV:') hole
// exists only once a tuner channel is selected, and the <video> stays invisible (layout
// background underneath) until it is playing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const POLLER = `(function () {
  window.__hostHistory = [];
  setInterval(function () {
    var h = document.getElementById('videohost'); var v = document.getElementById('urlvideo');
    if (!h) return;
    var rec = { mode: h.getAttribute('data-mode'), bg: h.style.background + ' ' + h.style.backgroundImage, display: h.style.display,
      ready: v ? v.getAttribute('data-ready') : null, vis: v ? getComputedStyle(v).visibility : null, playing: !!(v && !v.paused && v.currentTime > 0) };
    var last = window.__hostHistory[window.__hostHistory.length - 1];
    if (!last || JSON.stringify(last) !== JSON.stringify(rec)) window.__hostHistory.push(rec);
  }, 10);
})();`;

async function setup(t, { firstIsClip = true } = {}) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const clip = { number: 9, name: 'Clip', type: 'ip', params: { url: `${stack.base}/fixtures/tiny.webm`, mimeType: 'video/webm' } };
  const news = { number: 5, name: 'News', type: 'ip', params: { ip: '239.1.1.5', port: 5000 } };
  const ids = [];
  for (const d of (firstIsClip ? [clip, news] : [news, clip])) ids.push((await stack.api('POST', '/api/admin/channels', d, cookie)).json.id);
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: ids }, cookie)).json;
  const layout = { schema: 1, canvas: { w: 1920, h: 1080, background: '#123456' }, zones: [{ id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 }], screens: [{ id: 'home', zones: ['tv'] }] };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, default_lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('305MAXX1Z123'));
  await page.addInitScript(POLLER);
  await page.goto(stack.url);
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const history = () => page.evaluate(() => window.__hostHistory.slice());
  return { stack, page, key, history };
}

test('boot on an HTML5 channel: no TV: hole and no visible <video> until it plays', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  await s.page.waitForFunction(() => { const v = document.getElementById('urlvideo'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 15000 });
  await sleep(100);
  const hist = await s.history();
  assert.ok(hist.length >= 2, 'poller saw the host change');
  assert.ok(!hist.some((r) => /TV:/.test(r.bg)), 'the url(TV:) hole was never created: ' + JSON.stringify(hist));
  const beforePlay = hist.filter((r) => !r.playing);
  assert.ok(beforePlay.length > 0);
  assert.ok(beforePlay.every((r) => r.vis === 'hidden' && !r.ready), 'video invisible before it has frames: ' + JSON.stringify(beforePlay));
  const last = hist[hist.length - 1];
  assert.equal(last.mode, 'html5'); assert.equal(last.ready, '1'); assert.equal(last.vis, 'visible'); assert.equal(last.playing, true);
  // the host itself stays transparent in html5 mode so the layout background is what shows
  const hostBg = await s.page.$eval('#videohost', (e) => getComputedStyle(e).backgroundColor);
  assert.equal(hostBg, 'rgba(0, 0, 0, 0)');
  // switching to a tuner channel creates the hole and hides the video element again
  await s.key(0x1AB);   // CH+ → 5 News
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.5', null, { timeout: 8000 });
  await sleep(100);
  const host = await s.page.$eval('#videohost', (e) => ({ mode: e.getAttribute('data-mode'), bg: e.style.backgroundImage }));
  assert.equal(host.mode, 'tuner'); assert.match(host.bg, /TV:/);
  assert.equal(await s.page.$eval('#urlvideo', (v) => getComputedStyle(v).visibility), 'hidden');
  await s.page.close();
});

test('boot on a tuner channel: the hole is created when the channel is selected', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t, { firstIsClip: false });
  await s.page.waitForFunction(() => window.__fake.channel && window.__fake.channel.ip === '239.1.1.5', null, { timeout: 10000 });
  await sleep(100);
  const hist = await s.history();
  assert.ok(hist.every((r) => r.mode === 'tuner' || !/TV:/.test(r.bg)), 'the hole only ever exists in tuner mode: ' + JSON.stringify(hist));
  const last = hist[hist.length - 1];
  assert.equal(last.mode, 'tuner'); assert.match(last.bg, /TV:/);
  await s.page.close();
});
