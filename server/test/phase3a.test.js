'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../testlib/helpers');
const { validateLayout, ZONE_TYPES } = require('../src/layout');
const SHARED = require('../../shared/zone-types.json');

test('validator accepts every shared zone type; renderer, editor and validator share one list', () => {
  assert.deepEqual(ZONE_TYPES, SHARED);
  const zones = SHARED.map((t, i) => ({ id: `z${i}`, type: t, x: 0, y: 0, w: 100, h: 50 }));
  const r = validateLayout({ schema: 1, zones, screens: [] });
  assert.deepEqual(r.errors, [], r.errors.join('; '));
  assert.equal(r.doc.zones.length, SHARED.length);
  // the renderer registers a drawer for exactly these types (RENDERERS keys in tv-app/src/main.js)
  const src = fs.readFileSync(path.resolve(__dirname, '../../tv-app/src/main.js'), 'utf8');
  const block = src.slice(src.indexOf('var RENDERERS = {'), src.indexOf('\n};', src.indexOf('var RENDERERS = {')));
  const keys = [...block.matchAll(/^  (\w+): function/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), [...SHARED].sort());
  // the admin editor lists the same
  const geometry = fs.readFileSync(path.resolve(__dirname, '../../admin/src/editor/geometry.js'), 'utf8');
  assert.match(geometry, /zone-types\.json/);
  const schema = fs.readFileSync(path.resolve(__dirname, '../../admin/src/layoutSchema.js'), 'utf8');
  assert.match(schema, /zone-types\.json/);
});

test('instant_power is a visible set_property command: group save, group assignment, register', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Lobby' } })).json;
  const a = await s.registerSet('A', { instant_power: 0 });
  const b = await s.registerSet('B', { instant_power: 0 });
  await s.call('PATCH', `/api/admin/sets/${a.json.set_id}`, { cookie, body: { group_id: g.id } });
  // no power mode on the group → nothing queued
  let cmdsA = (await s.call('GET', `/api/admin/sets/${a.json.set_id}/commands`, { cookie })).json;
  assert.equal(cmdsA.length, 0);
  // group save → queued for every set in the group
  const upd = await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: 2 } });
  assert.equal(upd.json.instant_power_queued, 1);
  cmdsA = (await s.call('GET', `/api/admin/sets/${a.json.set_id}/commands`, { cookie })).json;
  assert.equal(cmdsA.length, 1); assert.equal(cmdsA[0].type, 'set_property'); assert.deepEqual(cmdsA[0].payload, { key: 'instant_power', value: '2' }, 'sent as a string'); assert.equal(cmdsA[0].status, 'queued');
  // assigning another set to the group queues it too; re-saving does not duplicate
  await s.call('PATCH', `/api/admin/sets/${b.json.set_id}`, { cookie, body: { group_id: g.id } });
  let cmdsB = (await s.call('GET', `/api/admin/sets/${b.json.set_id}/commands`, { cookie })).json;
  assert.equal(cmdsB.length, 1); assert.equal(cmdsB[0].payload.value, '2');
  await s.call('PATCH', `/api/admin/groups/${g.id}`, { cookie, body: { instant_power: 2 } });
  assert.equal((await s.call('GET', `/api/admin/sets/${b.json.set_id}/commands`, { cookie })).json.length, 1, 'deduped while queued');
  // the TV picks it up on poll, acks failure → command failed with the TV's reason, visible in the drawer and the journal
  const poll = (await s.call('GET', `/api/tv/poll?set_id=${b.json.set_id}&token=${b.json.token}`)).json;
  assert.equal(poll.commands[0].payload.key, 'instant_power');
  await s.call('POST', `/api/tv/ack?set_id=${b.json.set_id}&token=${b.json.token}`, { body: { command_id: poll.commands[0].id, ok: false, result: { error: 'TV kept instant_power=0 after set 1 (tried number and string)' } } });
  cmdsB = (await s.call('GET', `/api/admin/sets/${b.json.set_id}/commands`, { cookie })).json;
  assert.equal(cmdsB[0].status, 'failed'); assert.match(cmdsB[0].result.error, /kept instant_power/);
  assert.ok(s.logs.some((l) => /set_property FAILED on set/.test(l)));
  // a set that registers reporting the wrong value while in a WARM group gets the command again
  await s.call('POST', `/api/tv/ack?set_id=${a.json.set_id}&token=${a.json.token}`, { body: { command_id: cmdsA[0].id, ok: true } });
  const again = await s.registerSet('A', { instant_power: 0 });
  assert.equal(again.json.commands.filter((c) => c.payload.key === 'instant_power').length, 1);
  const ok = await s.registerSet('A', { instant_power: 2 });
  assert.equal(ok.json.commands.filter((c) => c.payload.key === 'instant_power' && c.status === 'queued').length, 0, 'no new command when the set already agrees');
});
