'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const WebSocket = require('ws');
const { startServer } = require('../testlib/helpers');
const { loadEsm } = require('../src/esm');
const { validateLayout, migrateStoredLayouts, model } = require('../src/layout');
const { openDb, migrate } = require('../src/db');

const V1 = { schema: 1, canvas: { w: 1920, h: 1080 }, zones: [
  { id: 'tv', type: 'video', x: 640, y: 120, w: 1200, h: 675 },
  { id: 'clock', type: 'clock', x: 1600, y: 980, w: 240, h: 60 },
  { id: 'menu', type: 'menu', x: 80, y: 120, w: 480, h: 300, items: [{ label: 'TV', action: 'fullscreen_tv' }, { label: 'Info', action: 'show_page', page: 'info' }, { label: 'Back', action: 'close_page' }] },
  { id: 'info', type: 'html', x: 100, y: 100, w: 1000, h: 600, hidden: true, html: '<p>x</p>' }],
  keys: { PORTAL: 'toggle_menu', BACK: 'close_page' },
  screens: [{ id: 'home', zones: ['tv', 'clock', 'menu'] }, { id: 'fullscreen', zones: ['tv'] }] };

test('esm loader exposes the shared layout model to CommonJS', () => {
  const m = loadEsm(path.resolve(__dirname, '../../shared/layout-model.js'));
  assert.equal(typeof m.upgradeLayout, 'function');
  assert.deepEqual(m.ACTION_TYPES, ['none', 'goto_page', 'back', 'fullscreen_tv', 'tune', 'launch_app', 'toggle']);
  assert.equal(m.spatialNext([{ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 0, w: 10, h: 10 }], 0, 'right'), 1);
  assert.throws(() => loadEsm(path.resolve(__dirname, '../../shared/zone-draw.js')), /import statements/);
});

test('validateLayout upgrades v1 to pages and checks page/action references', () => {
  const r = validateLayout(V1);
  assert.deepEqual(r.errors, []);
  assert.equal(r.doc.schema, 2);
  assert.deepEqual(r.doc.pages.map((p) => [p.id, p.zones, p.inherit]), [['home', ['tv', 'clock', 'menu'], false], ['info', ['info'], true]]);
  assert.equal(r.doc.home, 'home');
  assert.deepEqual(r.doc.keys, { PORTAL: { type: 'fullscreen_tv' }, BACK: { type: 'back' } });
  assert.deepEqual(r.doc.zones[2].items, [{ label: 'TV', action: 'fullscreen_tv' }, { label: 'Info', action: 'goto_page', page: 'info' }, { label: 'Back', action: 'back' }]);
  assert.equal(r.doc.zones[3].hidden, undefined);
  assert.deepEqual(r.doc.focus, { color: '#ffd166', width: 6, radius: 12 });
  // v2 with broken references
  const bad = validateLayout({ schema: 2, zones: [{ id: 'b', type: 'button', x: 0, y: 0, w: 10, h: 10, action: { type: 'goto_page', page: 'nowhere' } }], pages: [{ id: 'home', zones: ['b', 'ghost'] }, { id: 'home', zones: [] }], home: 'elsewhere', back_on_home: 'weird' });
  assert.ok(bad.errors.includes('zone "b": action targets unknown page "nowhere"'), bad.errors.join('; '));
  assert.ok(bad.errors.includes('page "home" references unknown zone "ghost"'));
  assert.ok(bad.errors.includes('duplicate page id "home"'));
  assert.equal(bad.doc.home, 'home', 'an unknown home is healed to the first page by the upgrade');
  assert.equal(validateLayout({ schema: 3, zones: [] }).errors[0], 'schema must be 1 or 2');
  // inherited globals: a page that inherits shows home's video/clock, not its menu
  assert.deepEqual(model.pageZoneIds(r.doc, 'info'), ['info', 'tv', 'clock']);
  assert.deepEqual(model.visibleZoneList(r.doc, 'info').map((z) => z.id), ['tv', 'clock', 'info']);
  assert.deepEqual(model.visibleZoneList(r.doc, 'info', { fullscreen: true }).map((z) => z.id), ['tv']);
  assert.deepEqual(model.visibleZoneList(r.doc, 'home', { toggled: { clock: true } }).map((z) => z.id), ['tv', 'menu']);
});

test('stored v1 layouts are rewritten to v2 once at startup; the TV gets v2 either way', async (t) => {
  const db = openDb(':memory:'); migrate(db);
  db.prepare("INSERT INTO tenants (name, hostname, display_name) VALUES ('h', 'h.test', 'H')").run();
  const tid = db.prepare("SELECT id FROM tenants WHERE name = 'h'").get().id;
  db.prepare('INSERT INTO layouts (tenant_id, name, json) VALUES (?, ?, ?)').run(tid, 'Old', JSON.stringify({ ...V1, name: 'Old' }));
  db.prepare('INSERT INTO layouts (tenant_id, name, json) VALUES (?, ?, ?)').run(tid, 'Broken', 'not json');
  const logs = [];
  assert.equal(migrateStoredLayouts(db, (m) => logs.push(m)), 1);
  const stored = JSON.parse(db.prepare("SELECT json FROM layouts WHERE name = 'Old'").get().json);
  assert.equal(stored.schema, 2); assert.equal(stored.name, 'Old'); assert.deepEqual(stored.pages.map((p) => p.id), ['home', 'info']);
  assert.equal(migrateStoredLayouts(db), 0, 'idempotent');
  assert.match(logs[0], /upgraded 1 layout/);

  // through the API: create with v1 json → stored/served as v2; the set's state carries pages
  const s = await startServer(); t.after(s.close);
  const { cookie } = await s.login();
  const made = await s.call('POST', '/api/admin/layouts', { cookie, body: { name: 'Rooms', json: V1 } });
  assert.equal(made.status, 201, made.text); assert.equal(made.json.json.schema, 2);
  await s.call('PATCH', '/api/admin/tenant', { cookie, body: { default_layout_id: made.json.id } });
  const reg = await s.registerSet('S1');
  assert.equal(reg.json.layout.schema, 2); assert.equal(reg.json.layout.home, 'home'); assert.equal(reg.json.layout.screens, undefined);
  // unassigned built-in layout is v2 too
  const other = await s.registerSet('S2', {}, undefined);
  assert.equal(other.json.layout.schema, 2);

  // preview on set opens the requested page; an unknown page is refused
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws/tv?set_id=${reg.json.set_id}&token=${reg.json.token}`, { headers: { Host: 'hoteldemo.caritech.net' } });
  const msgs = []; ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  await new Promise((r) => setTimeout(r, 100));
  const pv = await s.call('POST', `/api/admin/sets/${reg.json.set_id}/preview`, { cookie, body: { json: V1, page: 'info' } });
  assert.equal(pv.status, 200, pv.text);
  await new Promise((r) => setTimeout(r, 150));
  const m = msgs.find((x) => x.type === 'layout' && x.preview);
  assert.ok(m); assert.equal(m.page, 'info'); assert.equal(m.layout.schema, 2);
  assert.equal((await s.call('POST', `/api/admin/sets/${reg.json.set_id}/preview`, { cookie, body: { json: V1, page: 'nope' } })).status, 400);
  ws.close();
});
