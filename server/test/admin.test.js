'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../testlib/helpers');

test('superadmin is seeded once and its password is logged once', async (t) => {
  const s = await startServer(); t.after(s.close);
  assert.equal(s.seeded.username, 'admin');
  assert.ok(s.seeded.password.length >= 16);
  assert.equal(s.logs.filter((l) => l.includes('INITIAL SUPERADMIN CREATED')).length, 1);
  // second boot on the same DB seeds nothing
  const { createServer } = require('../src/app');
  const again = createServer({ db: s.db, tenantsDir: s.tenantsDir, log: () => {} });
  assert.equal(again.seeded, null);
  again.hub.closeAll();
});

test('login / me / logout and tenant confinement', async (t) => {
  const s = await startServer({ extraTenants: [['hotelb', 'hotelb.caritech.net']] }); t.after(s.close);
  const noauth = await s.call('GET', '/api/admin/me');
  assert.equal(noauth.status, 401);
  const bad = await s.login('admin', 'wrong');
  assert.equal(bad.status, 401);
  const ok = await s.login();
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.role, 'superadmin');
  assert.match(ok.headers['set-cookie'][0], /HttpOnly/);
  const me = await s.call('GET', '/api/admin/me', { cookie: ok.cookie });
  assert.equal(me.json.tenant.name, 'hoteldemo');
  // superadmin can use the other tenant's host with the same session
  const meB = await s.call('GET', '/api/admin/me', { cookie: ok.cookie, host: 'hotelb.caritech.net' });
  assert.equal(meB.json.tenant.name, 'hotelb');

  // tenant-admin for hotelb cannot act on hoteldemo
  const { hashPassword } = require('../src/auth');
  const hotelb = s.db.prepare("SELECT id FROM tenants WHERE name = 'hotelb'").get().id;
  s.db.prepare("INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, 'bob', ?, 'tenant-admin')").run(hotelb, hashPassword('pw'));
  const bobOnDemo = await s.login('bob', 'pw');
  assert.equal(bobOnDemo.status, 401, 'bob does not exist on hoteldemo host');
  const bob = await s.login('bob', 'pw', 'hotelb.caritech.net');
  assert.equal(bob.status, 200);
  const cross = await s.call('GET', '/api/admin/sets', { cookie: bob.cookie });
  assert.equal(cross.status, 403);
  const own = await s.call('GET', '/api/admin/sets', { cookie: bob.cookie, host: 'hotelb.caritech.net' });
  assert.equal(own.status, 200);

  const out = await s.call('POST', '/api/admin/logout', { cookie: ok.cookie });
  assert.equal(out.status, 200);
  const after = await s.call('GET', '/api/admin/me', { cookie: ok.cookie });
  assert.equal(after.status, 401);
});

test('sets: list, factory room rule, room/group assignment, delete', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const reg = await s.registerSet('305MAXX1Z123', { room_number: '[TV]305MAXX1Z123' });
  assert.equal(reg.json.room_number, null, 'factory room pattern is never a room');
  await s.registerSet('TEST0001', { room_number: '' });
  await s.registerSet('REAL', { room_number: '101' });

  let sets = (await s.call('GET', '/api/admin/sets', { cookie })).json;
  assert.equal(sets.length, 3);
  const lg = sets.find((x) => x.serial === '305MAXX1Z123');
  assert.equal(lg.reported_room, '[TV]305MAXX1Z123');
  assert.equal(lg.reported_room_is_factory, true);
  assert.equal(lg.online, true);
  assert.equal(lg.token, undefined, 'token never leaves the server');
  assert.equal(sets.find((x) => x.serial === 'REAL').room_number, '101', 'a real reported room is adopted');

  // group + room assignment
  const g = await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'Standard rooms' } });
  assert.equal(g.status, 201);
  const patched = await s.call('PATCH', `/api/admin/sets/${lg.id}`, { cookie, body: { room_number: '204', group_id: g.json.id } });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.room_number, '204');
  assert.equal(patched.json.group_name, 'Standard rooms');
  // room change queued a set_property command the TV sees on next poll
  const poll = await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`);
  assert.equal(poll.json.commands.length, 1);
  assert.equal(poll.json.commands[0].type, 'set_property');
  assert.deepEqual(poll.json.commands[0].payload, { key: 'room_number', value: '204' });
  assert.equal(poll.json.room_number, '204');
  assert.equal(poll.json.context.room, '204');
  // TV acks via poll-mode endpoint
  const ack = await s.call('POST', `/api/tv/ack?set_id=${reg.json.set_id}&token=${reg.json.token}`, { body: { command_id: poll.json.commands[0].id, ok: true } });
  assert.equal(ack.json.ok, true);
  const detail = await s.call('GET', `/api/admin/sets/${lg.id}`, { cookie });
  assert.equal(detail.json.commands[0].status, 'acked');
  // a re-register reporting the factory room queues the fix again (admin room wins)
  await s.registerSet('305MAXX1Z123', { room_number: '[TV]305MAXX1Z123' });
  const detail2 = await s.call('GET', `/api/admin/sets/${lg.id}`, { cookie });
  assert.equal(detail2.json.room_number, '204');
  assert.equal(detail2.json.commands.filter((c) => c.status === 'queued' && c.type === 'set_property').length, 1);

  // admin command buttons: queued while offline (no WS), rejected when unknown
  const cmd = await s.call('POST', `/api/admin/sets/${lg.id}/commands`, { cookie, body: { type: 'reboot' } });
  assert.equal(cmd.status, 201); assert.equal(cmd.json.status, 'queued');
  assert.equal((await s.call('POST', `/api/admin/sets/${lg.id}/commands`, { cookie, body: { type: 'format_disk' } })).status, 400);
  const list = await s.call('GET', `/api/admin/sets/${lg.id}/commands`, { cookie });
  assert.equal(list.json[0].type, 'reboot');

  // bad group
  const badG = await s.call('PATCH', `/api/admin/sets/${lg.id}`, { cookie, body: { group_id: 999 } });
  assert.equal(badG.status, 400);

  // delete the junk set
  const junk = sets.find((x) => x.serial === 'TEST0001');
  const del = await s.call('DELETE', `/api/admin/sets/${junk.id}`, { cookie });
  assert.equal(del.status, 200);
  sets = (await s.call('GET', '/api/admin/sets', { cookie })).json;
  assert.equal(sets.length, 2);
  assert.equal((await s.call('DELETE', `/api/admin/sets/${junk.id}`, { cookie })).status, 404);

  const dash = await s.call('GET', '/api/admin/dashboard', { cookie });
  assert.equal(dash.json.sets.total, 2);
  assert.equal(dash.json.sets.online, 2);
});

test('layouts: create/validate/update/duplicate/assign/delete and default layout', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const created = await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Standard room' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.json.schema, 2);
  assert.ok(created.json.json.zones.length > 0, 'starter layout has zones');
  assert.ok(created.json.json.pages.length > 0 && created.json.json.home === 'home', 'starter layout has pages');
  const id = created.json.id;

  const invalid = await s.call('PUT', `/api/admin/layouts/${id}`, { cookie, body: { json: { schema: 1, zones: [{ id: 'a', type: 'nope' }, { id: 'a', type: 'text' }] } } });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.json.errors.some((e) => /unknown type/.test(e)));
  assert.ok(invalid.json.errors.some((e) => /duplicate zone id/.test(e)));

  const upd = await s.call('PUT', `/api/admin/layouts/${id}`, { cookie, body: { json: { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [{ id: 't', type: 'text', text: 'Hi {{room}}', x: 1, y: 2, w: 3, h: 4 }] } } });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.version, 2);
  assert.equal(upd.json.json.name, 'Standard room', 'name column is authoritative');

  const dup = await s.call('POST', `/api/admin/layouts/${id}/duplicate`, { cookie });
  assert.equal(dup.json.name, 'Standard room copy');
  const conflict = await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Standard room' } });
  assert.equal(conflict.status, 409);

  // assign to group → set in group gets it
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'G' } })).json;
  const reg = await s.registerSet('S1');
  await s.call('PATCH', `/api/admin/sets/${reg.json.set_id}`, { cookie, body: { group_id: g.id } });
  const assign = await s.call('PUT', `/api/admin/groups/${g.id}/layout`, { cookie, body: { layout_id: id } });
  assert.equal(assign.json.layout_id, id);
  let poll = await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`);
  assert.equal(poll.json.layout.id, id);
  assert.equal(poll.json.layout.zones[0].text, 'Hi {{room}}');
  const groups = (await s.call('GET', '/api/admin/groups', { cookie })).json;
  assert.equal(groups[0].layout_name, 'Standard room');
  assert.equal(groups[0].set_count, 1);

  // tenant default layout applies to ungrouped sets
  const reg2 = await s.registerSet('S2');
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { default_layout_id: dup.json.id, display_name: 'Hotel Demo' } });
  poll = await s.call('GET', `/api/tv/poll?set_id=${reg2.json.set_id}&token=${reg2.json.token}`);
  assert.equal(poll.json.layout.id, dup.json.id);
  assert.equal(poll.json.context.hotel, 'Hotel Demo');
  const list = (await s.call('GET', '/api/admin/layouts', { cookie })).json;
  assert.equal(list.find((l) => l.id === dup.json.id).is_default, true);
  assert.equal(list.find((l) => l.id === id).group_count, 1);

  // delete default → falls back to unassigned
  await s.call('DELETE', `/api/admin/layouts/${dup.json.id}`, { cookie });
  poll = await s.call('GET', `/api/tv/poll?set_id=${reg2.json.set_id}&token=${reg2.json.token}`);
  assert.equal(poll.json.layout.builtin, 'unassigned');
});
