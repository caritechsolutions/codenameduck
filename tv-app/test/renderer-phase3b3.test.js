'use strict';
// Phase 3 B3: apps — the set reports application/list at register, draws the group's enabled
// apps as tiles, LEFT/RIGHT/OK launch with noSplash, and going to the background pauses the
// picture while coming back resumes it and re-claims the remote keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const fakeIdcap = require('./fake-idcap');
const { startStack, launchChromium, sleep } = require('./harness');

let browser;
test.before(async () => { browser = await launchChromium(); });
test.after(async () => { if (browser) await browser.close(); });

const KEY = { RIGHT: 0x27, LEFT: 0x25, ENTER: 0x0D, DOWN: 0x28 };

async function setup(t) {
  const stack = await startStack(); t.after(stack.close);
  const cookie = await stack.login();
  const clip = { number: 9, name: 'Clip', type: 'ip', params: { url: `${stack.base}/fixtures/tiny.webm`, mimeType: 'video/webm' } };
  const chId = (await stack.api('POST', '/api/admin/channels', clip, cookie)).json.id;
  const lu = (await stack.api('POST', '/api/admin/lineups', { name: 'Main', channel_ids: [chId] }, cookie)).json;
  const layout = { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [
    { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 },
    { id: 'apps', type: 'apps', x: 80, y: 820, w: 1760, h: 220, layout: 'row', style: { fontSize: 30, highlight: '#ffd166', tileSize: 200 } },
    { id: 'menu', type: 'menu', x: 80, y: 120, w: 480, h: 300, items: [{ label: 'Netflix', action: 'launch_app', app_id: 'netflix' }] },
  ], screens: [{ id: 'home', zones: ['tv', 'apps', 'menu'] }] };
  const l = (await stack.api('POST', '/api/admin/layouts', { name: 'L', json: layout }, cookie)).json;
  const g = (await stack.api('POST', '/api/admin/groups', { name: 'G' }, cookie)).json;
  await stack.api('PUT', `/api/admin/groups/${g.id}/layout`, { layout_id: l.id }, cookie);
  await stack.api('PUT', `/api/admin/groups/${g.id}/lineup`, { lineup_id: lu.id }, cookie);
  await stack.api('PATCH', '/api/admin/tenant', { default_layout_id: l.id, default_lineup_id: lu.id }, cookie);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(fakeIdcap('305MAXX1Z123', { __appAuth: {} }));   // everything activated (B3b hides un-activated apps)
  // let the test flip document.hidden
  await page.addInitScript(`Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return !!window.__hidden; } });
    window.__setHidden = function (h) { window.__hidden = h; document.dispatchEvent(new Event('visibilitychange')); };`);
  await page.goto(stack.url);
  await page.waitForFunction(() => window.__cc && window.__cc.state.setId, null, { timeout: 10000 });
  const set = (await stack.api('GET', '/api/admin/sets', undefined, cookie)).json[0];
  const key = (code) => page.evaluate((c) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => c }); document.dispatchEvent(e); }, code);
  const fake = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake)));
  return { stack, cookie, page, key, fake, set, g };
}

test('apps: reported at register, tiles follow the group, OK launches with noSplash, background pause/resume', async (t) => {
  if (!browser) { t.skip('chromium unavailable'); return; }
  const s = await setup(t);
  // the register carried the LG list → Apps page knows them, models seen
  const apps = (await s.stack.api('GET', '/api/admin/apps', undefined, s.cookie)).json;
  assert.deepEqual(apps.map((a) => a.app_id).sort(), ['amazon', 'com.webos.app.browser', 'netflix', 'youtube.leanback.v4']);
  assert.deepEqual(apps.find((a) => a.app_id === 'netflix').models, ['43UM670H0UA']);
  assert.ok((await s.fake()).calls.some((c) => c.uri === 'idcap://application/list'));
  // no group yet → the apps zone is empty
  assert.equal(await s.page.$$eval('#zone-apps .apptile', (els) => els.length), 0);
  // assign the group and enable two apps: tiles are pushed live, in the chosen order
  await s.stack.api('PATCH', `/api/admin/sets/${s.set.id}`, { group_id: s.g.id }, s.cookie);
  const yt = apps.find((a) => a.app_id === 'youtube.leanback.v4'), nf = apps.find((a) => a.app_id === 'netflix');
  await s.stack.api('PATCH', `/api/admin/apps/${nf.id}`, { name_override: 'Films', icon_override: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }, s.cookie);
  await s.stack.api('PUT', `/api/admin/groups/${s.g.id}/apps`, { app_ids: [yt.id, nf.id] }, s.cookie);
  await s.page.waitForFunction(() => document.querySelectorAll('#zone-apps .apptile').length === 2, null, { timeout: 5000 });
  const tiles = await s.page.$$eval('#zone-apps .apptile', (els) => els.map((e) => ({ name: e.querySelector('.appname').textContent, img: !!e.querySelector('img'), initial: (e.querySelector('.appinitial') || {}).textContent })));
  assert.deepEqual(tiles, [{ name: 'YouTube', img: false, initial: 'Y' }, { name: 'Films', img: true, initial: undefined }]);
  assert.equal(await s.page.$eval('#zone-apps', (e) => getComputedStyle(e).display), 'flex');
  // remote: the first DOWN lands on the top-left focusable item (the menu), the next DOWN moves
  // spatially to the tiles below; RIGHT/LEFT walk the row
  await s.key(KEY.DOWN);
  assert.equal(await s.page.$eval('#zone-menu .menuitem.focused', (e) => e.textContent), 'Netflix');
  await s.key(KEY.DOWN);   // the tile nearest the menu item's centre
  assert.equal(await s.page.$eval('#zone-apps .apptile.focused .appname', (e) => e.textContent), 'Films');
  await s.key(KEY.LEFT);
  assert.equal(await s.page.$eval('#zone-apps .apptile.focused .appname', (e) => e.textContent), 'YouTube');
  await s.key(KEY.RIGHT);
  assert.equal(await s.page.$eval('#zone-apps .apptile.focused .appname', (e) => e.textContent), 'Films');
  await s.key(KEY.LEFT);
  assert.equal(await s.page.$eval('#zone-apps .apptile.focused .appname', (e) => e.textContent), 'YouTube');
  await s.key(KEY.ENTER);
  await sleep(100);
  let f = await s.fake();
  assert.deepEqual(f.launched[f.launched.length - 1], { id: 'youtube.leanback.v4', params: {}, noSplash: true });
  // the plain menu item launches too, and a launch_app command from admin
  await s.page.evaluate(() => { window.__cc.state.focus = { zone: 'menu', index: 0 }; });
  await s.key(KEY.ENTER);
  await sleep(100);
  f = await s.fake();
  assert.equal(f.launched[f.launched.length - 1].id, 'netflix'); assert.equal(f.launched[f.launched.length - 1].noSplash, true);

  // background: the HTML5 clip pauses while hidden, resumes when visible, keys are re-claimed
  await s.page.waitForFunction(() => { const v = document.getElementById('urlvideo'); return v && !v.paused && v.currentTime > 0; }, null, { timeout: 15000 });
  const keyAddsBefore = (await s.fake()).calls.filter((c) => c.uri === 'idcap://system/key/add').length;
  await s.page.evaluate(() => window.__setHidden(true));
  await sleep(150);
  assert.equal(await s.page.$eval('#urlvideo', (v) => v.paused), true, 'paused while another app is in front');
  assert.equal(await s.page.evaluate(() => window.__cc.state.videoPaused), true);
  await s.page.evaluate(() => window.__setHidden(false));
  await s.page.waitForFunction(() => { const v = document.getElementById('urlvideo'); return v && !v.paused; }, null, { timeout: 5000 });
  assert.equal(await s.page.evaluate(() => window.__cc.state.videoPaused), false);
  await sleep(200);
  const keyAddsAfter = (await s.fake()).calls.filter((c) => c.uri === 'idcap://system/key/add').length;
  assert.ok(keyAddsAfter > keyAddsBefore, 'keys claimed again after coming back');
  // events reached the server: app launch + visibility
  const events = (await s.stack.api('GET', `/api/admin/sets/${s.set.id}`, undefined, s.cookie)).json.events;
  const types = events.map((e) => e.type);
  assert.ok(types.includes('tv_app'), 'launch event ' + JSON.stringify(types));
  assert.ok(events.some((e) => e.type === 'tv_visibility' && /"resumed":true/.test(JSON.stringify(e))), 'resume event');
  await s.page.close();
});
