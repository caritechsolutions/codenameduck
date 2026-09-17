'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { startServer } = require('../testlib/helpers');
const { validateChannel, parseCsv, toCsv } = require('../src/channels');
const { validateLayout } = require('../src/layout');

test('channel model: plpId, sourceAddress, videoStreamType', () => {
  let r = validateChannel({ number: 1, name: 'SSM', type: 'ip', params: { ip: '239.1.1.1', port: 5000, ipBroadcastType: 'rtp', sourceAddress: '10.0.0.9', videoStreamType: 'HEVC' } });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.channel.params, { ipBroadcastType: 'rtp', ip: '239.1.1.1', port: 5000, sourceAddress: '10.0.0.9', videoStreamType: 'HEVC' });
  r = validateChannel({ number: 2, name: 'T2', type: 'rf', params: { rfBroadcastType: 'terrestrial_2', frequency: 490000000, programNumber: 4, plpId: 1, videoStreamType: 'HEVC' } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.channel.params.plpId, 1); assert.equal(r.channel.params.videoStreamType, 'HEVC');
  r = validateChannel({ number: 3, name: 'bad', type: 'ip', params: { ip: '239.1.1.1', port: 5000, sourceAddress: 'nope', videoStreamType: 'VP9' } });
  assert.equal(r.errors.length, 2);
  const csv = toCsv([r.channel = validateChannel({ number: 1, name: 'SSM', type: 'ip', params: { ip: '239.1.1.1', port: 5000, sourceAddress: '10.0.0.9', videoStreamType: 'HEVC' } }).channel]);
  assert.match(csv, /sourceAddress/);
  const back = parseCsv(csv);
  assert.equal(back.rows[0].params.sourceAddress, '10.0.0.9'); assert.equal(back.rows[0].params.videoStreamType, 'HEVC');
});

test('layout: banner/digits/popup placement zones, at most one each', () => {
  const ok = validateLayout({ schema: 1, zones: [{ id: 'b', type: 'banner', x: 0, y: 900, w: 800, h: 90 }, { id: 'd', type: 'digits' }, { id: 'p', type: 'popup' }] });
  assert.deepEqual(ok.errors, []);
  const dup = validateLayout({ schema: 1, zones: [{ id: 'b', type: 'banner' }, { id: 'b2', type: 'banner' }] });
  assert.ok(dup.errors.some((e) => /at most one banner/.test(e)));
});

test('instant_power: group value → state, set reports the real value (0/1/2/10) via register and heartbeat', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Lobby' } })).json;
  const reg = await s.registerSet('S1', { instant_power: '0' });
  assert.equal(reg.json.instant_power, null, 'no group → leave the set alone');
  let row = s.db.prepare('SELECT instant_power FROM sets WHERE id = ?').get(reg.json.set_id);
  assert.equal(row.instant_power, 0);
  await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: 2 } });
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { group_id: g.id } });
  let poll = (await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`)).json;
  assert.equal(poll.instant_power, 2);
  await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: 0 } });
  poll = (await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`)).json;
  assert.equal(poll.instant_power, 0);
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${reg.json.set_id}&token=${reg.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  await new Promise((res) => ws.once('open', res));
  ws.send(JSON.stringify({ type: 'hb', instant_power: '10' }));
  await new Promise((res) => setTimeout(res, 60));
  row = s.db.prepare('SELECT instant_power FROM sets WHERE id = ?').get(reg.json.set_id);
  assert.equal(row.instant_power, 10, 'real value stored, not coerced to 1');
  ws.send(JSON.stringify({ type: 'hb', instant_power: 7 }));
  await new Promise((res) => setTimeout(res, 60));
  assert.equal(s.db.prepare('SELECT instant_power FROM sets WHERE id = ?').get(reg.json.set_id).instant_power, 10, 'unknown values ignored');
  const api = (await s.call('GET', `/api/admin/sets/${reg.json.set_id}`, { cookie })).json;
  assert.equal(api.instant_power, 10);
  ws.close();
});
