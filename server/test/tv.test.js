'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb, migrate } = require('../src/db');
const { createApp } = require('../src/app');
const { hostnameFromXait, normalizeHost } = require('../src/tenants');

function makeTenantsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tenants-'));
  const app = path.join(dir, 'hoteldemo', 'procentric', 'application');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'xait.xml'),
    '<XAIT><versionNumber>0</versionNumber><HcapDescriptor>\n  <url>http://hoteldemo.caritech.net/procentric/application/index.html</url></HcapDescriptor></XAIT>');
  fs.mkdirSync(path.join(dir, 'empty-no-xait'), { recursive: true });
  return dir;
}


// Node's fetch drops a caller-supplied Host header (forbidden header per the Fetch spec), so
// tenant resolution has to be exercised with the plain http module.
function httpJson(base, method, url, host, body, raw) {
  const http = require('http');
  const u = new URL(base + url);
  const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { Host: host, 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.8.7',
        ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text, headers: new Map(Object.entries(res.headers)) });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function startServer(tenantsDir) {
  const db = openDb(':memory:');
  migrate(db);
  const logs = [];
  const app = createApp({ db, tenantsDir, adminDist: null, pollIntervalS: 30, log: (m) => logs.push(m) });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, url, { host = 'hoteldemo.caritech.net', body, raw } = {}) => httpJson(base, method, url, host, body, raw);
  return { db, server, base, call, logs, close: () => new Promise((r) => server.close(r)) };
}

test('migrations are idempotent and create the full schema', () => {
  const db = openDb(':memory:');
  assert.ok(migrate(db) >= 2);
  assert.equal(migrate(db), 0);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const t of ['tenants', 'users', 'groups', 'sets', 'layouts', 'layout_assign', 'channels', 'lineups',
    'lineup_items', 'lineup_assign', 'messages', 'commands', 'events', 'schema_migrations', 'sessions']) {
    assert.ok(tables.includes(t), `table ${t} missing`);
  }
});

test('hostnameFromXait and normalizeHost', () => {
  const dir = makeTenantsDir();
  assert.equal(hostnameFromXait(path.join(dir, 'hoteldemo/procentric/application/xait.xml')), 'hoteldemo.caritech.net');
  assert.equal(hostnameFromXait(path.join(dir, 'nope.xml')), null);
  assert.equal(normalizeHost('HotelDemo.caritech.net:80'), 'hoteldemo.caritech.net');
  assert.equal(normalizeHost(undefined), null);
});

test('register + poll flow', async (t) => {
  const dir = makeTenantsDir();
  const s = await startServer(dir);
  t.after(s.close);

  const h = await s.call('GET', '/healthz');
  assert.equal(h.status, 200);
  assert.equal(h.json.tenants, 1, 'only the tenant with an xait.xml is registered');

  // unknown host → 404
  const bad = await s.call('POST', '/api/tv/register', { host: 'nobody.example.com', body: { serial_number: 'X' } });
  assert.equal(bad.status, 404);
  assert.equal(bad.json.error, 'unknown tenant');

  // missing serial → 400
  const noSerial = await s.call('POST', '/api/tv/register', { body: { model_name: '43UM670H0UA' } });
  assert.equal(noSerial.status, 400);

  // first register: set created, unassigned layout with the serial in it
  const reg = await s.call('POST', '/api/tv/register', {
    body: { serial_number: '305MAXX1Z123', model_name: '43UM670H0UA', firmware_version: '03.25.80',
      webos_version: '8.3.0', idpn: '306', api: 'idcap', room_number: '204' },
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.headers.get('cache-control'), 'no-store');
  assert.equal(reg.json.created, true);
  assert.ok(reg.json.token.length > 20);
  assert.equal(reg.json.room_number, '204');
  assert.equal(reg.json.group, null);
  assert.equal(reg.json.ws_url, '/ws/tv');
  assert.deepEqual(reg.json.commands, []);
  assert.equal(reg.json.context.hotel, 'hoteldemo');
  assert.equal(reg.json.poll_interval_s, 30);
  assert.equal(reg.json.layout.builtin, 'unassigned');
  const serialZone = reg.json.layout.zones.find((z) => z.id === 'serial');
  assert.equal(serialZone.text, '305MAXX1Z123');
  assert.ok(reg.json.layout.zones.every((z) => ['text', 'clock'].includes(z.type)), 'v0 zone types only');

  const row = s.db.prepare('SELECT * FROM sets WHERE serial = ?').get('305MAXX1Z123');
  assert.equal(row.model, '43UM670H0UA');
  assert.equal(row.ip, '10.9.8.7');
  assert.equal(row.api, 'idcap');

  // second register: same set, new token, fields preserved when omitted
  const reg2 = await s.call('POST', '/api/tv/register', { body: { serial_number: '305MAXX1Z123', api: 'idcap' } });
  assert.equal(reg2.json.created, false);
  assert.equal(reg2.json.set_id, reg.json.set_id);
  assert.notEqual(reg2.json.token, reg.json.token);
  assert.equal(reg2.json.room_number, '204');
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sets').get().n, 1);

  // poll: old token rejected, new token accepted
  const stale = await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`);
  assert.equal(stale.status, 401);
  const poll = await s.call('GET', `/api/tv/poll?set_id=${reg2.json.set_id}&token=${reg2.json.token}`);
  assert.equal(poll.status, 200);
  assert.equal(poll.json.layout.builtin, 'unassigned');
  assert.equal(poll.json.token, undefined, 'poll never re-issues the token');

  // poll from a different tenant host cannot see the set
  const cross = await s.call('GET', `/api/tv/poll?set_id=${reg2.json.set_id}&token=${reg2.json.token}`, { host: 'nobody.example.com' });
  assert.equal(cross.status, 404);

  // events recorded
  const ev = s.db.prepare('SELECT type FROM events ORDER BY id').all().map((r) => r.type);
  assert.deepEqual(ev, ['register_new', 'register']);
});

test('layout resolution: override > group > tenant default > unassigned', async (t) => {
  const dir = makeTenantsDir();
  const s = await startServer(dir);
  t.after(s.close);
  const reg = await s.call('POST', '/api/tv/register', { body: { serial_number: 'S1', api: 'hcap' } });
  const { db } = s;
  const tenantId = db.prepare('SELECT id FROM tenants').get().id;
  const mk = (name) => db.prepare('INSERT INTO layouts (tenant_id, name, json) VALUES (?, ?, ?)')
    .run(tenantId, name, JSON.stringify({ schema: 1, name, canvas: { w: 1920, h: 1080 }, zones: [], screens: [] })).lastInsertRowid;
  const lDefault = mk('Default'), lGroup = mk('Group'), lOverride = mk('Override');
  const poll = () => s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`).then((r) => r.json.layout);

  assert.equal((await poll()).builtin, 'unassigned');
  db.prepare('UPDATE tenants SET default_layout_id = ? WHERE id = ?').run(lDefault, tenantId);
  assert.equal((await poll()).name, 'Default');
  const gid = db.prepare("INSERT INTO groups (tenant_id, name) VALUES (?, 'Standard rooms')").run(tenantId).lastInsertRowid;
  db.prepare('INSERT INTO layout_assign (group_id, layout_id) VALUES (?, ?)').run(gid, lGroup);
  db.prepare('UPDATE sets SET group_id = ? WHERE id = ?').run(gid, reg.json.set_id);
  const p = await s.call('GET', `/api/tv/poll?set_id=${reg.json.set_id}&token=${reg.json.token}`);
  assert.equal(p.json.layout.name, 'Group');
  assert.deepEqual(p.json.group, { id: Number(gid), name: 'Standard rooms' });
  db.prepare('UPDATE sets SET layout_override_id = ? WHERE id = ?').run(lOverride, reg.json.set_id);
  assert.equal((await poll()).name, 'Override');
});

test('new tenant directory is picked up without restart; admin placeholder is tenant-scoped', async (t) => {
  const dir = makeTenantsDir();
  const s = await startServer(dir);
  t.after(s.close);
  const app = path.join(dir, 'hotelb', 'procentric', 'application');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'xait.xml'), '<url>http://hotelb.caritech.net/procentric/application/index.html</url>');
  const r = await s.call('POST', '/api/tv/register', { host: 'hotelb.caritech.net:80', body: { serial_number: 'B1' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.created, true);
  const admin = await s.call('GET', '/admin', { host: 'hotelb.caritech.net' });
  assert.equal(admin.status, 200);
  assert.match(admin.text, /hotelb\.caritech\.net/);
  const adminBad = await s.call('GET', '/admin', { host: 'x.example.com' });
  assert.equal(adminBad.status, 404);
  const badJson = await s.call('POST', '/api/tv/register', { host: 'hotelb.caritech.net', raw: '{oops' });
  assert.equal(badJson.status, 400);
});
