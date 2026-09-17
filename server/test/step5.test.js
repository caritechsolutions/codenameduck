'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../testlib/helpers');
const WebSocket = require('ws');

const fakeWeather = async (url) => { if (/latitude=51/.test(url)) return { current: { temperature_2m: 17.6, weather_code: 61, wind_speed_10m: 12.2, relative_humidity_2m: 80 } }; throw new Error('boom'); };

test('tenant settings, weather, assets', async (t) => {
  const s = await startServer({ weatherFetch: fakeWeather }); t.after(s.close);
  const { cookie } = await s.login();
  let w = await s.call('GET', '/api/admin/weather', { cookie });
  assert.equal(w.json.ok, false);
  const bad = await s.call('PATCH', '/api/admin/tenant', { cookie, body: { settings: { weather: { lat: 100, lon: 0 } } } });
  assert.equal(bad.status, 400);
  const upd = await s.call('PATCH', '/api/admin/tenant', { cookie, body: { display_name: 'Hotel Demo', settings: { timezone: 'Europe/Amsterdam', weather: { lat: 51.5, lon: 4.2, units: 'metric' }, guest_placeholder: 'Guest' } } });
  assert.equal(upd.json.display_name, 'Hotel Demo');
  assert.equal(upd.json.settings.weather.lat, 51.5);
  w = await s.call('GET', '/api/admin/weather', { cookie });
  assert.equal(w.json.ok, true); assert.equal(w.json.temp_c, 18); assert.equal(w.json.text, 'Light rain'); assert.equal(w.json.temp_f, 64);
  // TV side gets the same, cached
  const reg = await s.registerSet('S1');
  const tw = await s.call('GET', `/api/tv/weather?set_id=${reg.json.set_id}&token=${reg.json.token}`);
  assert.equal(tw.json.temp_c, 18);
  assert.equal(s.weather._cache.size, 1);
  assert.equal(reg.json.context.guest, '', 'Part C: {{guest}} is blank while the room is vacant (the placeholder is no longer used)');
  // failing location → graceful
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { settings: { weather: { lat: 10, lon: 10 } } } });
  w = await s.call('GET', '/api/admin/weather', { cookie });
  assert.equal(w.json.ok, false);

  // assets: raw upload as logo, json upload, list, delete, bad name
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const logo = await s.call('POST', '/api/admin/assets?as=logo', { cookie, raw: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(logo.status, 201); assert.equal(logo.json.url, '/procentric/application/assets/logo.png');
  assert.ok(fs.existsSync(path.join(s.tenantsDir, 'hoteldemo/procentric/application/assets/logo.png')));
  const me = await s.call('GET', '/api/admin/tenant', { cookie });
  assert.equal(me.json.settings.logo_url, '/procentric/application/assets/logo.png');
  const a2 = await s.call('POST', '/api/admin/assets', { cookie, body: { name: 'Bg Image.PNG', data_url: 'data:image/png;base64,' + png.toString('base64') } });
  assert.equal(a2.json.name, 'bg-image.png');
  assert.equal((await s.call('POST', '/api/admin/assets', { cookie, body: { name: '../evil.png', data_url: 'data:image/png;base64,' + png.toString('base64') } })).status, 400);
  const list = (await s.call('GET', '/api/admin/assets', { cookie })).json;
  assert.deepEqual(list.map((a) => a.name), ['bg-image.png', 'logo.png']);
  assert.equal((await s.call('DELETE', '/api/admin/assets/bg-image.png', { cookie })).status, 200);
  assert.equal((await s.call('DELETE', '/api/admin/assets/bg-image.png', { cookie })).status, 404);
  // context carries logo
  const poll = await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`);
  assert.equal(poll.json.context.logo, '/procentric/application/assets/logo.png');
});

test('messages: targeting, expiry, live push, checkout clears set messages', async (t) => {
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const a = await s.registerSet('A'), b = await s.registerSet('B');
  const g = (await s.call('POST', '/api/admin/groups', { cookie, body: { name: 'G' } })).json;
  await s.call('PATCH', `/api/admin/sets/${b.json.set_id}`, { cookie, body: { group_id: g.id } });
  // connect A over WS to see the push
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${a.json.set_id}&token=${a.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  await new Promise((r) => setTimeout(r, 50));

  const all = await s.call('POST', '/api/admin/messages', { cookie, body: { text: 'Pool closed today', target_type: 'all' } });
  assert.equal(all.status, 201); assert.equal(all.json.pushed, 1);
  await new Promise((r) => setTimeout(r, 50));
  const pushed = msgs.find((m) => m.type === 'messages');
  assert.ok(pushed && pushed.messages[0].text === 'Pool closed today');
  const grp = (await s.call('POST', '/api/admin/messages', { cookie, body: { text: 'Group only', target_type: 'group', target_id: g.id } })).json;
  const forB = (await s.call('POST', '/api/admin/messages', { cookie, body: { text: 'Your taxi is here', target_type: 'set', target_id: b.json.set_id, ttl_minutes: 30 } })).json;
  assert.ok(forB.expires_at);
  const expired = (await s.call('POST', '/api/admin/messages', { cookie, body: { text: 'old', target_type: 'all', expires_at: '2020-01-01T00:00:00Z' } })).json;
  assert.equal((await s.call('POST', '/api/admin/messages', { cookie, body: { text: 'x', target_type: 'set', target_id: 999 } })).status, 400);

  const pollA = (await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`)).json;
  assert.deepEqual(pollA.messages.map((m) => m.text), ['Pool closed today']);
  let pollB = (await s.call('GET', `/api/tv/poll?set_id=${b.json.set_id}&token=${b.json.token}`)).json;
  assert.deepEqual(pollB.messages.map((m) => m.text), ['Your taxi is here', 'Group only', 'Pool closed today']);
  const list = (await s.call('GET', '/api/admin/messages', { cookie })).json;
  assert.equal(list.find((m) => m.id === expired.id).expired, true);
  assert.equal(list.find((m) => m.id === grp.id).target_name, 'G');

  // checkout: set-targeted messages removed, checkout command queued, event logged
  const co = await s.call('POST', `/api/admin/sets/${b.json.set_id}/checkout`, { cookie });
  assert.equal(co.status, 200);
  pollB = (await s.call('GET', `/api/tv/poll?set_id=${b.json.set_id}&token=${b.json.token}`)).json;
  assert.deepEqual(pollB.messages.map((m) => m.text), ['Group only', 'Pool closed today']);
  assert.equal(pollB.commands[0].type, 'checkout');
  const detail = (await s.call('GET', `/api/admin/sets/${b.json.set_id}`, { cookie })).json;
  assert.ok(detail.events.some((e) => e.type === 'checkout'));
  await s.call('DELETE', `/api/admin/messages/${all.json.id}`, { cookie });
  assert.equal((await s.call('GET', `/api/tv/poll?set_id=${a.json.set_id}&token=${a.json.token}`)).json.messages.length, 0);
  ws.close();
});

test('users and roles', async (t) => {
  const s = await startServer({ extraTenants: [['hotelb', 'hotelb.caritech.net']] }); t.after(s.close);
  const { cookie } = await s.login();
  const hotelb = s.db.prepare("SELECT id FROM tenants WHERE name = 'hotelb'").get().id;
  assert.equal((await s.call('POST', '/api/admin/users', { cookie, body: { username: 'Bad Name', password: 'password1' } })).status, 400);
  assert.equal((await s.call('POST', '/api/admin/users', { cookie, body: { username: 'short', password: 'abc' } })).status, 400);
  const bob = await s.call('POST', '/api/admin/users', { cookie, body: { username: 'bob', password: 'password1', role: 'tenant-admin', tenant_id: hotelb } });
  assert.equal(bob.status, 201); assert.equal(bob.json.tenant_name, 'hotelb');
  const carol = (await s.call('POST', '/api/admin/users', { cookie, body: { username: 'carol', password: 'password1' } })).json;
  assert.equal(carol.tenant_id, s.db.prepare("SELECT id FROM tenants WHERE name = 'hoteldemo'").get().id, 'defaults to the host tenant');
  assert.equal((await s.call('POST', '/api/admin/users', { cookie, body: { username: 'bob', password: 'password1', tenant_id: hotelb } })).status, 409);
  let users = (await s.call('GET', '/api/admin/users', { cookie })).json;
  assert.deepEqual(users.map((u) => u.username), ['admin', 'bob', 'carol']);

  // bob (tenant-admin of hotelb) sees only hotelb users, cannot create superadmins, cannot delete admin
  const bobLogin = await s.login('bob', 'password1', 'hotelb.caritech.net');
  const bobUsers = (await s.call('GET', '/api/admin/users', { cookie: bobLogin.cookie, host: 'hotelb.caritech.net' })).json;
  assert.deepEqual(bobUsers.map((u) => u.username), ['bob']);
  assert.equal((await s.call('POST', '/api/admin/users', { cookie: bobLogin.cookie, host: 'hotelb.caritech.net', body: { username: 'evil', password: 'password1', role: 'superadmin' } })).status, 403);
  assert.equal((await s.call('DELETE', `/api/admin/users/${users[0].id}`, { cookie: bobLogin.cookie, host: 'hotelb.caritech.net' })).status, 404);
  assert.equal((await s.call('GET', '/api/admin/tenants', { cookie: bobLogin.cookie, host: 'hotelb.caritech.net' })).status, 403);
  // bob changes own password; old session cookie stays valid, wrong current rejected
  assert.equal((await s.call('POST', '/api/admin/me/password', { cookie: bobLogin.cookie, host: 'hotelb.caritech.net', body: { current: 'nope', next: 'password2' } })).status, 400);
  assert.equal((await s.call('POST', '/api/admin/me/password', { cookie: bobLogin.cookie, host: 'hotelb.caritech.net', body: { current: 'password1', next: 'password2' } })).status, 200);
  assert.equal((await s.login('bob', 'password1', 'hotelb.caritech.net')).status, 401);
  assert.equal((await s.login('bob', 'password2', 'hotelb.caritech.net')).status, 200);
  // superadmin resets bob's password, promotes carol, cannot delete self or last superadmin
  assert.equal((await s.call('PATCH', `/api/admin/users/${bob.json.id}`, { cookie, body: { password: 'password3' } })).status, 200);
  assert.equal((await s.login('bob', 'password3', 'hotelb.caritech.net')).status, 200);
  assert.equal((await s.call('DELETE', `/api/admin/users/${users[0].id}`, { cookie })).status, 400);
  const promoted = await s.call('PATCH', `/api/admin/users/${carol.id}`, { cookie, body: { role: 'superadmin' } });
  assert.equal(promoted.json.role, 'superadmin'); assert.equal(promoted.json.tenant_id, null);
  assert.equal((await s.call('DELETE', `/api/admin/users/${bob.json.id}`, { cookie })).status, 200);
  users = (await s.call('GET', '/api/admin/users', { cookie })).json;
  assert.ok(users[0].last_login, 'admin last_login recorded');
});

test('superadmin tenants page: list and create via the tenant CLI', async (t) => {
  const calls = [];
  const s = await startServer({ tenantCommand: async (args) => { calls.push(args);
    if (args[1] === 'fail') throw new Error('nginx -t failed\nsomething');
    const { addTenantDir } = require('../testlib/helpers'); addTenantDir(s.tenantsDir, args[1], args[2]); return 'created'; } });
  t.after(s.close);
  const { cookie } = await s.login();
  await s.registerSet('S1');
  let list = (await s.call('GET', '/api/admin/tenants', { cookie })).json;
  assert.equal(list.length, 1); assert.equal(list[0].set_count, 1); assert.equal(list[0].online_count, 1);
  assert.equal((await s.call('POST', '/api/admin/tenants', { cookie, body: { name: 'Bad Name', hostname: 'x.example.com' } })).status, 400);
  assert.equal((await s.call('POST', '/api/admin/tenants', { cookie, body: { name: 'ok', hostname: 'nodots' } })).status, 400);
  assert.equal((await s.call('POST', '/api/admin/tenants', { cookie, body: { name: 'hoteldemo', hostname: 'other.example.com' } })).status, 409);
  const fail = await s.call('POST', '/api/admin/tenants', { cookie, body: { name: 'fail', hostname: 'fail.example.com' } });
  assert.equal(fail.status, 500); assert.match(fail.json.error, /nginx -t failed/);
  const ok = await s.call('POST', '/api/admin/tenants', { cookie, body: { name: 'hotelc', hostname: 'hotelc.caritech.net', display_name: 'Hotel C' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.equal(ok.json.display_name, 'Hotel C');
  assert.deepEqual(calls[1], ['new', 'hotelc', 'hotelc.caritech.net']);
  // the new tenant resolves immediately
  const reg = await s.call('POST', '/api/tv/register', { host: 'hotelc.caritech.net', body: { serial_number: 'C1' } });
  assert.equal(reg.status, 200); assert.equal(reg.json.context.hotel, 'Hotel C');
  list = (await s.call('GET', '/api/admin/tenants', { cookie })).json;
  assert.equal(list.length, 2);
  const ren = await s.call('PATCH', `/api/admin/tenants/${ok.json.id}`, { cookie, body: { display_name: 'Hotel C Grand' } });
  assert.equal(ren.json.display_name, 'Hotel C Grand');
});
