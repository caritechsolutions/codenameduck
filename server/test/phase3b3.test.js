'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../testlib/helpers');
const { normalizeAppList } = require('../src/apps');

const LG_LIST = { list: [
  { id: 'netflix', title: 'Netflix', icon: '/usr/palm/applications/netflix/icon.png', type: 'native' },
  { id: 'youtube.leanback.v4', title: 'YouTube', type: 'web' },
  { id: 'amazon', title: 'Prime Video' },
] };

test('normalizeAppList accepts the shapes LG might send', () => {
  assert.deepEqual(normalizeAppList(LG_LIST).map((a) => a.id), ['netflix', 'youtube.leanback.v4', 'amazon']);
  assert.deepEqual(normalizeAppList([{ appId: 'x', name: 'X', iconUrl: 'i' }]).map((a) => [a.id, a.title, a.icon]), [['x', 'X', 'i']]);
  assert.deepEqual(normalizeAppList({ applications: ['a', 'b'] }).map((a) => a.id), ['a', 'b']);
  assert.deepEqual(normalizeAppList({ apps: [{ title: 'no id' }, null, 5] }), []);
  assert.deepEqual(normalizeAppList('nonsense'), []);
  assert.equal(normalizeAppList([{ id: 'x' }])[0].raw.id, 'x');
});

test('apps: discovered at register, enabled per group, pushed to sets, overrides, forget', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  // two sets on two models report their lists; the second set knows one app more
  const a = await s.registerSet('A', { apps: LG_LIST });
  assert.equal(a.status, 200);
  assert.deepEqual(a.json.apps, [], 'no group → nothing enabled');
  await s.registerSet('B', { apps: { list: [...LG_LIST.list, { id: 'com.webos.app.browser', title: 'Web Browser' }] }, model_name: '55US662H' });
  let list = (await s.call('GET', '/api/admin/apps', { cookie })).json;
  assert.deepEqual(list.map((x) => x.app_id).sort(), ['amazon', 'com.webos.app.browser', 'netflix', 'youtube.leanback.v4']);
  const netflix = list.find((x) => x.app_id === 'netflix');
  assert.equal(netflix.name, 'Netflix'); assert.equal(netflix.icon, null, 'LG icon paths are never sent as icon');
  assert.equal(netflix.icon_url, '/usr/palm/applications/netflix/icon.png');
  assert.deepEqual(netflix.models.sort(), ['43UM670H0UA', '55US662H']); assert.equal(netflix.set_count, 2);
  assert.equal(list.find((x) => x.app_id === 'com.webos.app.browser').set_count, 1);
  assert.deepEqual(netflix.raw, LG_LIST.list[0]);
  assert.ok(s.logs.some((l) => /register serial=A .*apps=3/.test(l)) || s.logs.some((l) => /NEW set serial=A .*apps=3/.test(l)), 'journal mentions the app count');

  // enable for a group: order kept; unknown id rejected; state carries them
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Rooms' } })).json;
  await s.call('PATCH', `/api/admin/sets/${a.json.set_id}`, { cookie, body: { group_id: g.id } });
  const yt = list.find((x) => x.app_id === 'youtube.leanback.v4');
  assert.equal((await s.call('PUT', `/api/admin/groups/${g.id}/apps`, { cookie, body: { app_ids: [9999] } })).status, 400);
  assert.equal((await s.call('PUT', `/api/admin/groups/${g.id}/apps`, { cookie, body: { app_ids: 'x' } })).status, 400);
  // connect A over WS to see the push
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${a.json.set_id}&token=${a.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  await new Promise((r) => setTimeout(r, 100));
  const put = await s.call('PUT', `/api/admin/groups/${g.id}/apps`, { cookie, body: { app_ids: [yt.id, netflix.id] } });
  assert.equal(put.status, 200); assert.deepEqual(put.json.app_ids, [yt.id, netflix.id]); assert.equal(put.json.pushed, 1);
  await new Promise((r) => setTimeout(r, 150));
  const push = msgs.find((m) => m.type === 'apps');
  assert.ok(push, 'apps pushed over WS'); assert.deepEqual(push.apps.map((x) => x.id), ['youtube.leanback.v4', 'netflix']);
  const poll = await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`);
  assert.deepEqual(poll.json.apps, [{ id: 'youtube.leanback.v4', name: 'YouTube', icon: null }, { id: 'netflix', name: 'Netflix', icon: null }]);
  assert.deepEqual((await s.call('GET', `/api/admin/groups/${g.id}/apps`, { cookie })).json.map((x) => x.id), ['youtube.leanback.v4', 'netflix']);
  list = (await s.call('GET', '/api/admin/apps', { cookie })).json;
  assert.deepEqual(list.find((x) => x.app_id === 'netflix').group_ids, [g.id]);
  assert.deepEqual(list.find((x) => x.app_id === 'amazon').group_ids, []);

  // overrides reach the TV payload and are pushed
  const upd = await s.call('PATCH', `/api/admin/apps/${netflix.id}`, { cookie, body: { name_override: ' Films ', icon_override: '/procentric/application/media/x.png' } });
  assert.equal(upd.json.name, 'Films'); assert.equal(upd.json.icon, '/procentric/application/media/x.png');
  await new Promise((r) => setTimeout(r, 150));
  const push2 = msgs.filter((m) => m.type === 'apps').pop();
  assert.deepEqual(push2.apps[1], { id: 'netflix', name: 'Films', icon: '/procentric/application/media/x.png' });
  const cleared = await s.call('PATCH', `/api/admin/apps/${netflix.id}`, { cookie, body: { name_override: '' } });
  assert.equal(cleared.json.name, 'Netflix'); assert.equal(cleared.json.icon, '/procentric/application/media/x.png', 'icon untouched when omitted');

  // re-register with a shorter list keeps the row (other sets may still have it) but updates set_count
  await s.registerSet('B', { apps: { list: [{ id: 'netflix', title: 'Netflix' }] }, model_name: '55US662H' });
  list = (await s.call('GET', '/api/admin/apps', { cookie })).json;
  assert.equal(list.find((x) => x.app_id === 'com.webos.app.browser').set_count, 0);
  // forget
  const browser = list.find((x) => x.app_id === 'com.webos.app.browser');
  assert.equal((await s.call('DELETE', `/api/admin/apps/${browser.id}`, { cookie })).status, 200);
  assert.equal((await s.call('DELETE', `/api/admin/apps/${browser.id}`, { cookie })).status, 404);
  // deleting the group drops its enablement; the set gets an empty apps push
  await s.call('DELETE', `/api/admin/groups/${g.id}`, { cookie });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(msgs.filter((m) => m.type === 'apps').pop().apps, []);
  ws.close();
  // a register without apps leaves everything as is
  const c = await s.registerSet('A');
  assert.equal(c.status, 200);
  assert.equal((await s.call('GET', '/api/admin/apps', { cookie })).json.length, 3);
});
