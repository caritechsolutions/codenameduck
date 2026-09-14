'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../testlib/helpers');

function connect(s, setId, token, host = 'hoteldemo.caritech.net') {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${setId}&token=${encodeURIComponent(token)}`, { headers: { Host: host } });
  const queue = []; const waiters = [];
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); const w = waiters.shift(); if (w) w(m); else queue.push(m); });
  const next = (timeout = 2000) => new Promise((resolve, reject) => {
    if (queue.length) return resolve(queue.shift());
    const t = setTimeout(() => reject(new Error('timeout waiting for ws message')), timeout);
    waiters.push((m) => { clearTimeout(t); resolve(m); });
  });
  const open = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('unexpected-response', (_r, res) => reject(new Error('HTTP ' + res.statusCode))); });
  return { ws, next, open, send: (o) => ws.send(JSON.stringify(o)) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('ws: rejects bad token, accepts good one, heartbeat updates the set', async (t) => {
  const s = await startServer(); t.after(s.close);
  const reg = await s.registerSet('S1');
  await assert.rejects(connect(s, reg.json.set_id, 'bad').open, /HTTP 401/);
  await assert.rejects(connect(s, reg.json.set_id, reg.json.token, 'nobody.example.com').open, /HTTP 401/);

  const c = connect(s, reg.json.set_id, reg.json.token);
  await c.open;
  const hello = await c.next();
  assert.equal(hello.type, 'hello');
  assert.equal(s.hub.isConnected(reg.json.set_id), true);
  c.send({ type: 'hb', channel: '5', volume: 12, muted: false, uptime: 3600, power_mode: 'WARM', app_version: 'v1' });
  await sleep(50);
  const row = s.db.prepare('SELECT * FROM sets WHERE id = ?').get(reg.json.set_id);
  assert.equal(row.channel, '5'); assert.equal(row.volume, 12); assert.equal(row.muted, 0);
  assert.equal(row.uptime_s, 3600); assert.equal(row.power_mode, 'WARM'); assert.ok(row.last_hb);
  const { cookie } = await s.login();
  const api = await s.call('GET', `/api/admin/sets/${reg.json.set_id}`, { cookie });
  assert.equal(api.json.ws, true);
  c.ws.close();
  await sleep(50);
  assert.equal(s.hub.isConnected(reg.json.set_id), false);
});

test('ws: layout save and group assignment push immediately; room change delivers command; ack recorded', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const reg = await s.registerSet('S1');
  const c = connect(s, reg.json.set_id, reg.json.token);
  await c.open; await c.next(); // hello

  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'G' } })).json;
  const l = (await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'L1' } })).json;
  await s.call('PUT', `/api/admin/groups/${g.id}/layout`, { cookie, body: { layout_id: l.id } });

  // putting the set into the group pushes the group's layout
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { group_id: g.id } });
  let m = await c.next();
  assert.equal(m.type, 'layout'); assert.equal(m.layout.id, l.id); assert.equal(m.layout.version, 1);
  assert.equal(m.group.name, 'G');

  // saving the layout publishes v2 to the connected set
  const saved = await s.call('PUT', `/api/admin/layouts/${l.id}`, { cookie, body: { json: { ...l.json, zones: [{ id: 'x', type: 'clock', x: 0, y: 0, w: 100, h: 50 }], screens: [] } } });
  assert.equal(saved.json.pushed, 1);
  m = await c.next();
  assert.equal(m.type, 'layout'); assert.equal(m.layout.version, 2); assert.equal(m.layout.zones[0].id, 'x');

  // room change: layout context updates AND set_property command arrives, ack closes it
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { room_number: '305' } });
  const got = [await c.next(), await c.next()];
  const cmd = got.find((x) => x.type === 'command');
  const lay = got.find((x) => x.type === 'layout');
  assert.ok(cmd && lay);
  assert.equal(cmd.command.type, 'set_property');
  assert.equal(lay.context.room, '305');
  let row = s.db.prepare('SELECT status FROM commands WHERE id = ?').get(cmd.command.id);
  assert.equal(row.status, 'sent');
  c.send({ type: 'ack', command_id: cmd.command.id, ok: true, result: { done: 1 } });
  await sleep(50);
  row = s.db.prepare('SELECT status, result_json FROM commands WHERE id = ?').get(cmd.command.id);
  assert.equal(row.status, 'acked');
  assert.deepEqual(JSON.parse(row.result_json), { done: 1 });

  // preview pushes an unsaved layout
  const pv = await s.call('POST', `/api/admin/sets/${reg.json.set_id}/preview`, { cookie, body: { json: { schema: 1, zones: [{ id: 'p', type: 'text', text: 'preview' }] } } });
  assert.equal(pv.status, 200);
  m = await c.next(); assert.equal(m.preview, true); assert.equal(m.layout.zones[0].text, 'preview');

  // queued command while offline is delivered on reconnect
  c.ws.close(); await sleep(50);
  const q = s.commands.queue({ id: 1, name: 'hoteldemo' }, { id: reg.json.set_id, serial: 'S1' }, 'reboot');
  assert.equal(q.status, 'queued');
  const c2 = connect(s, reg.json.set_id, reg.json.token);
  await c2.open; await c2.next();
  m = await c2.next(); assert.equal(m.type, 'command'); assert.equal(m.command.type, 'reboot');
  assert.equal(s.db.prepare('SELECT status FROM commands WHERE id = ?').get(q.id).status, 'sent');
  c2.ws.close();
});
