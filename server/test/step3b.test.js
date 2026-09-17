'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../testlib/helpers');

test('TV events over WS and HTTP land in the log; last_error surfaces in admin', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const reg = await s.registerSet('S1');
  // HTTP batch while ws is down
  const r = await s.call('POST', `/api/tv/events?set_id=${reg.json.set_id}&token=${reg.json.token}`, { body: { events: [
    { name: 'ws', payload: { kind: 'close', code: 1006 }, at: '2026-09-15T10:00:00Z' },
    { name: 'error', payload: { kind: 'media', message: 'HTML5 video failed for http://x/h265.m3u8: video element error 4' } },
  ] } });
  assert.equal(r.json.recorded, 2);
  assert.equal((await s.call('POST', `/api/tv/events?set_id=${reg.json.set_id}&token=bad`, { body: { events: [] } })).status, 401);
  let detail = (await s.call('GET', `/api/admin/sets/${reg.json.set_id}`, { cookie })).json;
  assert.equal(detail.last_error.kind, 'media');
  assert.match(detail.last_error.message, /h265/);
  assert.ok(detail.events.some((e) => e.type === 'tv_ws' && e.payload.code === 1006));
  assert.ok(s.logs.some((l) => /TV ERROR set \d+: \[media\]/.test(l)), 'error reached the journal');
  // over WS
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${reg.json.set_id}&token=${reg.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  await new Promise((res) => ws.once('open', res));
  ws.send(JSON.stringify({ type: 'event', name: 'error', payload: { kind: 'tune', message: 'channel 9 Movies: channel change timeout' } }));
  await new Promise((res) => setTimeout(res, 60));
  const list = (await s.call('GET', '/api/admin/sets', { cookie })).json;
  assert.equal(list[0].last_error.kind, 'tune');
  ws.close();
});

test('group instant_power (0/1/2/10) flows into the TV state and pushes', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Lobby' } })).json;
  assert.equal((await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: 3 } })).status, 400);
  const reg = await s.registerSet('S1');
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { group_id: g.id } });
  let poll = (await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`)).json;
  assert.equal(poll.instant_power, null);
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${reg.json.set_id}&token=${reg.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((res) => ws.once('open', res));
  const upd = await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: 2 } });
  assert.equal(upd.json.instant_power, 2);
  await new Promise((res) => setTimeout(res, 80));
  const layoutMsg = msgs.find((m) => m.type === 'layout');
  assert.ok(layoutMsg && layoutMsg.instant_power === 2, 'instant_power change pushed with the layout');
  const cmd = msgs.find((m) => m.type === 'command');
  assert.ok(cmd && cmd.command.type === 'set_property' && cmd.command.payload.value === '2', 'command carries the value as a string');
  poll = (await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`)).json;
  assert.equal(poll.instant_power, 2);
  assert.equal((await s.call('GET', '/api/admin/groups', { cookie })).json[0].instant_power, 2);
  for (const v of [10, 1, 0]) assert.equal((await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: v } })).json.instant_power, v);
  assert.equal((await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: null } })).json.instant_power, null);
  ws.close();
});
