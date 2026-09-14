'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('../testlib/helpers');
const { validateChannel, parseCsv, toCsv } = require('../src/channels');

test('channel validation: ip multicast, ip url, rf, and errors', () => {
  let r = validateChannel({ number: 5, name: 'CNN', type: 'ip', params: { ip: '239.1.1.10', port: 5000 } });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.channel.params, { ipBroadcastType: 'udp', ip: '239.1.1.10', port: 5000 });
  r = validateChannel({ number: 6, name: 'HLS', type: 'ip', params: { url: 'http://x/stream.m3u8' } });
  assert.deepEqual(r.channel.params, { url: 'http://x/stream.m3u8', mimeType: 'application/x-mpegURL' });
  r = validateChannel({ number: 7, name: 'RF', type: 'rf', params: { rfBroadcastType: 'terrestrial', frequency: 63000000, programNumber: 1, majorNumber: 7, minorNumber: '' } });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.channel.params, { rfBroadcastType: 'terrestrial', frequency: 63000000, programNumber: 1, majorNumber: 7 });
  r = validateChannel({ number: 'x', name: '', type: 'ip', params: { ip: '999.1.1.1', port: 70000 } });
  assert.ok(r.errors.some((e) => /number/.test(e)) && r.errors.some((e) => /name/.test(e)) && r.errors.some((e) => /ip must/.test(e)) && r.errors.some((e) => /port/.test(e)));
  r = validateChannel({ number: 1, name: 'x', type: 'rf', params: { rfBroadcastType: 'moon', frequency: -1, programNumber: 'a' } });
  assert.equal(r.errors.length, 3);
});

test('csv round trip', () => {
  const csv = 'number,name,type,ip,port\n1,"News, 24",ip,239.1.1.1,5000\n2,Bad,ip,nope,1\n3,RF One,rf,,,\n';
  const { rows, errors } = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'News, 24');
  assert.equal(errors.length, 2);
  const out = toCsv([{ number: 1, name: 'News, 24', type: 'ip', logo_url: null, params: { ip: '239.1.1.1', port: 5000, ipBroadcastType: 'udp' } }]);
  assert.match(out, /"News, 24"/);
  assert.equal(parseCsv(out).rows.length, 1);
});

test('channels + lineups API, resolution precedence, live push', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const mk = (n, name, params = { ip: `239.1.1.${n}`, port: 5000 }, type = 'ip') => s.call('POST', '/api/admin/channels', { cookie, body: { number: n, name, type, params } });
  const c1 = (await mk(1, 'One')).json, c2 = (await mk(2, 'Two')).json, c3 = (await mk(3, 'Three', { rfBroadcastType: 'cable', frequency: 57000000, programNumber: 3 }, 'rf')).json;
  assert.equal((await mk(1, 'Dup')).status, 409);
  assert.equal((await mk(9, 'Bad', { ip: 'x', port: 1 })).status, 400);
  const list = (await s.call('GET', '/api/admin/channels', { cookie })).json;
  assert.deepEqual(list.map((c) => c.number), [1, 2, 3]);
  assert.equal(list[2].params.rfBroadcastType, 'cable');

  // edit keeps params when omitted, disable hides from lineups
  const ed = await s.call('PUT', `/api/admin/channels/${c2.id}`, { cookie, body: { name: 'Two!' } });
  assert.equal(ed.json.name, 'Two!'); assert.equal(ed.json.params.ip, '239.1.1.2');

  // lineup with ordering
  const lu = (await s.call('POST', '/api/admin/lineups', { cookie, body: { name: 'Main', channel_ids: [c3.id, c1.id, c2.id] } })).json;
  assert.deepEqual(lu.items.map((c) => c.number), [3, 1, 2]);
  assert.equal((await s.call('PUT', `/api/admin/lineups/${lu.id}`, { cookie, body: { channel_ids: [999] } })).status, 400);

  // set gets nothing until assigned; group assignment → lineup; override wins; default fallback
  const reg = await s.registerSet('S1');
  const poll = () => s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`).then((r) => r.json);
  assert.deepEqual((await poll()).lineup, []);
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'G' } })).json;
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { group_id: g.id } });
  await s.call('PUT', `/api/admin/groups/${g.id}/lineup`, { cookie, body: { lineup_id: lu.id } });
  let st = await poll();
  assert.deepEqual(st.lineup.map((c) => c.number), [3, 1, 2]);
  assert.equal(st.lineup_id, lu.id);
  assert.equal(st.lineup[1].params.port, 5000);
  const groups = (await s.call('GET', '/api/admin/groups', { cookie })).json;
  assert.equal(groups[0].lineup_name, 'Main');
  // disabled channel disappears
  await s.call('PUT', `/api/admin/channels/${c1.id}`, { cookie, body: { enabled: false } });
  assert.deepEqual((await poll()).lineup.map((c) => c.number), [3, 2]);
  // override
  const lu2 = (await s.call('POST', '/api/admin/lineups', { cookie, body: { name: 'Suite', channel_ids: [c2.id] } })).json;
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { lineup_override_id: lu2.id } });
  assert.deepEqual((await poll()).lineup.map((c) => c.number), [2]);
  assert.equal((await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { lineup_override_id: 12345 } })).status, 400);
  // tenant default for a set with no group
  const reg2 = await s.registerSet('S2');
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { default_lineup_id: lu.id } });
  const st2 = (await s.call('GET', `/api/tv/poll?set_id=${reg2.json.set_id}&token=${reg2.json.token}`)).json;
  assert.deepEqual(st2.lineup.map((c) => c.number), [3, 2]);
  const lus = (await s.call('GET', '/api/admin/lineups', { cookie })).json;
  assert.equal(lus.find((l) => l.id === lu.id).is_default, true);
  assert.equal(lus.find((l) => l.id === lu.id).group_count, 1);
  // delete channel cascades out of lineups
  await s.call('DELETE', `/api/admin/channels/${c3.id}`, { cookie });
  assert.deepEqual((await s.call('GET', `/api/admin/lineups/${lu.id}`, { cookie })).json.items.map((c) => c.number), [1, 2], 'disabled channel stays listed for admin, deleted one is gone');
  // csv import
  const imp = await s.call('POST', '/api/admin/channels/import', { cookie, body: { csv: 'number,name,type,ip,port\n2,Two renamed,ip,239.1.1.2,6000\n50,Fifty,ip,239.1.1.50,5000\n' } });
  assert.equal(imp.json.created, 1); assert.equal(imp.json.updated, 1);
  const after = (await s.call('GET', '/api/admin/channels', { cookie })).json;
  assert.equal(after.find((c) => c.number === 2).params.port, 6000);
  const csv = await s.call('GET', '/api/admin/channels.csv', { cookie });
  assert.match(csv.text, /^number,name,type/);
});

test('bulk commands and screenshot upload', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-data-'));
  const s = await startServer({ dataDir }); t.after(s.close);
  const { cookie } = await s.login();
  const a = await s.registerSet('A'), b = await s.registerSet('B');
  const bulk = await s.call('POST', '/api/admin/commands', { cookie, body: { type: 'message', payload: { text: 'Fire drill 10:00' }, all: true } });
  assert.equal(bulk.json.targets, 2); assert.equal(bulk.json.queued, 2);
  assert.equal((await s.call('POST', '/api/admin/commands', { cookie, body: { type: 'reboot' } })).status, 400);
  const pollA = (await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`)).json;
  assert.equal(pollA.commands[0].type, 'message');

  // screenshot: raw png upload acks the command, admin can fetch it
  const shot = (await s.call('POST', `/api/admin/sets/${b.json.set_id}/commands`, { cookie, body: { type: 'screenshot' } })).json;
  assert.equal((await s.call('GET', `/api/admin/sets/${b.json.set_id}/screenshot`, { cookie })).status, 404);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = await s.call('POST', `/api/tv/upload?set_id=${b.json.set_id}&token=${b.json.token}&command_id=${shot.id}`, { raw: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 200); assert.equal(up.json.bytes, png.length);
  const img = await s.call('GET', `/api/admin/sets/${b.json.set_id}/screenshot`, { cookie });
  assert.equal(img.status, 200); assert.match(img.headers['content-type'], /image\/png/);
  const detail = (await s.call('GET', `/api/admin/sets/${b.json.set_id}`, { cookie })).json;
  assert.equal(detail.commands[0].status, 'acked'); assert.ok(detail.screenshot_at);
  // data_url variant
  const up2 = await s.call('POST', `/api/tv/upload?set_id=${b.json.set_id}&token=${b.json.token}`, { body: { data_url: 'data:image/png;base64,' + png.toString('base64') } });
  assert.equal(up2.status, 200);
  assert.equal((await s.call('POST', `/api/tv/upload?set_id=${b.json.set_id}&token=${b.json.token}`, { body: { data_url: 'nope' } })).status, 400);
});
