'use strict';
// Admin API. Everything under /api/admin is tenant-scoped by Host (req.tenant) and, except
// login, requires a session. Tenant-admins are confined to their tenant; superadmins act on
// whichever tenant's hostname they are using.
const express = require('express');
const { validateLayout, starterLayout } = require('../layout');
const { isFactoryRoom } = require('../state');

const ONLINE_SQL = `((julianday('now') - julianday(s.last_seen)) * 86400 < 180)`;

function createAdminRouter({ db, auth, hub, commands, log = () => {} }) {
  const r = express.Router();

  // ---------------------------------------------------------------- auth
  r.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const out = auth.login({ username, password, tenant: req.tenant, ip: req.ip });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.set('Set-Cookie', auth.cookieHeader(out.sessionId, out.expires));
    log(`admin login ${out.user.username} (${out.user.role}) on ${req.tenant.hostname} from ${req.ip}`);
    res.json({ user: out.user, tenant: publicTenant(req.tenant) });
  });
  r.post('/logout', (req, res) => {
    const row = auth.sessionFromRequest(req);
    if (row) auth.logout(row.session_id);
    res.set('Set-Cookie', auth.clearCookie);
    res.json({ ok: true });
  });

  r.use(auth.requireAuth);

  r.get('/me', (req, res) => res.json({ user: req.user, tenant: publicTenant(req.tenant) }));

  // ---------------------------------------------------------------- dashboard
  const qCounts = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${ONLINE_SQL} THEN 1 ELSE 0 END) AS online,
      SUM(CASE WHEN group_id IS NULL OR room_number IS NULL THEN 1 ELSE 0 END) AS unassigned
    FROM sets s WHERE tenant_id = ?`);
  const qOffline = db.prepare(`SELECT s.id, s.serial, s.room_number, s.model, s.last_seen, g.name AS group_name
    FROM sets s LEFT JOIN groups g ON g.id = s.group_id WHERE s.tenant_id = ? AND NOT ${ONLINE_SQL}
    ORDER BY s.last_seen DESC LIMIT 50`);
  const qRecentEvents = db.prepare(`SELECT e.id, e.type, e.payload_json, e.created_at, s.serial, s.room_number
    FROM events e LEFT JOIN sets s ON s.id = e.set_id WHERE e.tenant_id = ? ORDER BY e.id DESC LIMIT 30`);
  r.get('/dashboard', (req, res) => {
    const c = qCounts.get(req.tenant.id);
    res.json({
      sets: { total: c.total, online: c.online || 0, offline: c.total - (c.online || 0), unassigned: c.unassigned || 0 },
      offline: qOffline.all(req.tenant.id),
      events: qRecentEvents.all(req.tenant.id).map((e) => ({ ...e, payload: safe(e.payload_json), payload_json: undefined })),
      groups: db.prepare('SELECT COUNT(*) n FROM groups WHERE tenant_id = ?').get(req.tenant.id).n,
      layouts: db.prepare('SELECT COUNT(*) n FROM layouts WHERE tenant_id = ?').get(req.tenant.id).n,
      ws_connected: hub.connectedSetIds(req.tenant.id).length,
    });
  });

  // ---------------------------------------------------------------- sets
  const SET_COLS = `s.*, g.name AS group_name, ${ONLINE_SQL} AS online`;
  const qSets = db.prepare(`SELECT ${SET_COLS} FROM sets s LEFT JOIN groups g ON g.id = s.group_id
    WHERE s.tenant_id = ? ORDER BY (s.room_number IS NULL), s.room_number, s.serial`);
  const qSet = db.prepare(`SELECT ${SET_COLS} FROM sets s LEFT JOIN groups g ON g.id = s.group_id WHERE s.id = ? AND s.tenant_id = ?`);
  const qSetEvents = db.prepare('SELECT id, type, payload_json, created_at FROM events WHERE set_id = ? ORDER BY id DESC LIMIT 30');
  const qGroup = db.prepare('SELECT id FROM groups WHERE id = ? AND tenant_id = ?');
  const qLayout = db.prepare('SELECT id FROM layouts WHERE id = ? AND tenant_id = ?');

  function setToApi(s) {
    const { token, ...rest } = s;
    return { ...rest, online: !!s.online, ws: hub.isConnected(s.id), reported_room_is_factory: isFactoryRoom(s.reported_room) };
  }
  function loadSet(req, res) {
    const s = qSet.get(Number(req.params.id), req.tenant.id);
    if (!s) { res.status(404).json({ error: 'set not found' }); return null; }
    return s;
  }

  r.get('/sets', (req, res) => {
    let rows = qSets.all(req.tenant.id);
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q) rows = rows.filter((s) => [s.serial, s.room_number, s.model, s.group_name, s.ip, s.notes].some((v) => v && String(v).toLowerCase().includes(q)));
    res.json(rows.map(setToApi));
  });
  r.get('/sets/:id', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    res.json({ ...setToApi(s),
      events: qSetEvents.all(s.id).map((e) => ({ ...e, payload: safe(e.payload_json), payload_json: undefined })),
      commands: commands.recent(s.id, 20),
      layout: state(req).resolveLayout(req.tenant, s) });
  });
  r.patch('/sets/:id', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    const b = req.body || {};
    const upd = {};
    if ('room_number' in b) {
      const v = b.room_number == null ? null : String(b.room_number).trim().slice(0, 32);
      upd.room_number = v || null;
    }
    if ('group_id' in b) {
      if (b.group_id != null && !qGroup.get(Number(b.group_id), req.tenant.id)) return res.status(400).json({ error: 'unknown group' });
      upd.group_id = b.group_id == null ? null : Number(b.group_id);
    }
    if ('layout_override_id' in b) {
      if (b.layout_override_id != null && !qLayout.get(Number(b.layout_override_id), req.tenant.id)) return res.status(400).json({ error: 'unknown layout' });
      upd.layout_override_id = b.layout_override_id == null ? null : Number(b.layout_override_id);
    }
    if ('lineup_override_id' in b && hasColumn('sets', 'lineup_override_id')) {
      upd.lineup_override_id = b.lineup_override_id == null ? null : Number(b.lineup_override_id);
    }
    if ('notes' in b) upd.notes = b.notes == null ? null : String(b.notes).slice(0, 2000);
    const keys = Object.keys(upd);
    if (!keys.length) return res.status(400).json({ error: 'nothing to update' });
    db.prepare(`UPDATE sets SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...upd, id: s.id });
    if ('room_number' in upd && upd.room_number !== s.room_number) {
      // Keep the TV's own property in step with admin (PLATFORM.md §4).
      commands.queue(req.tenant, s, 'set_property', { key: 'room_number', value: upd.room_number || '' }, { dedupe: true });
    }
    hub.refresh(req.tenant.id, { setIds: [s.id] });
    log(`admin ${req.user.username}: set ${s.id} (${s.serial}) updated ${JSON.stringify(upd)}`);
    res.json(setToApi(qSet.get(s.id, req.tenant.id)));
  });
  r.delete('/sets/:id', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    db.prepare('DELETE FROM sets WHERE id = ?').run(s.id);
    if (hub.isConnected(s.id)) hub.send(s.id, { type: 'deleted' });
    log(`admin ${req.user.username}: deleted set ${s.id} (${s.serial})`);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- groups
  const qGroups = db.prepare(`SELECT g.*, la.layout_id, l.name AS layout_name,
      (SELECT COUNT(*) FROM sets s WHERE s.group_id = g.id) AS set_count
    FROM groups g LEFT JOIN layout_assign la ON la.group_id = g.id LEFT JOIN layouts l ON l.id = la.layout_id
    WHERE g.tenant_id = ? ORDER BY g.name`);
  const qGroupFull = db.prepare(`SELECT g.*, la.layout_id FROM groups g LEFT JOIN layout_assign la ON la.group_id = g.id WHERE g.id = ? AND g.tenant_id = ?`);
  r.get('/groups', (req, res) => res.json(qGroups.all(req.tenant.id)));
  r.post('/groups', (req, res) => {
    const name = String((req.body || {}).name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      const id = db.prepare('INSERT INTO groups (tenant_id, name, description) VALUES (?, ?, ?)')
        .run(req.tenant.id, name, str(req.body.description, 500)).lastInsertRowid;
      res.status(201).json(qGroupFull.get(id, req.tenant.id));
    } catch (e) { res.status(409).json({ error: 'a group with that name exists' }); }
  });
  r.patch('/groups/:id', (req, res) => {
    const g = qGroupFull.get(Number(req.params.id), req.tenant.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    const b = req.body || {};
    const name = 'name' in b ? String(b.name || '').trim().slice(0, 80) : g.name;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      db.prepare('UPDATE groups SET name = ?, description = ? WHERE id = ?').run(name, 'description' in b ? str(b.description, 500) : g.description, g.id);
    } catch (e) { return res.status(409).json({ error: 'a group with that name exists' }); }
    if ('layout_id' in b) assignLayout(req, g.id, b.layout_id, res, true);
    hub.refresh(req.tenant.id);
    res.json(qGroupFull.get(g.id, req.tenant.id));
  });
  r.put('/groups/:id/layout', (req, res) => {
    const g = qGroupFull.get(Number(req.params.id), req.tenant.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    if (!assignLayout(req, g.id, (req.body || {}).layout_id, res)) return;
    const pushed = hub.refresh(req.tenant.id);
    res.json({ ...qGroupFull.get(g.id, req.tenant.id), pushed });
  });
  function assignLayout(req, groupId, layoutId, res, silent) {
    if (layoutId == null) { db.prepare('DELETE FROM layout_assign WHERE group_id = ?').run(groupId); return true; }
    if (!qLayout.get(Number(layoutId), req.tenant.id)) { if (!silent) res.status(400).json({ error: 'unknown layout' }); return false; }
    db.prepare('INSERT INTO layout_assign (group_id, layout_id) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET layout_id = excluded.layout_id').run(groupId, Number(layoutId));
    log(`admin ${req.user.username}: group ${groupId} -> layout ${layoutId}`);
    return true;
  }
  r.delete('/groups/:id', (req, res) => {
    const g = qGroupFull.get(Number(req.params.id), req.tenant.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);   // sets.group_id → NULL via FK
    hub.refresh(req.tenant.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- layouts
  const qLayouts = db.prepare(`SELECT l.id, l.name, l.version, l.updated_at,
      (SELECT COUNT(*) FROM layout_assign la WHERE la.layout_id = l.id) AS group_count,
      (SELECT COUNT(*) FROM sets s WHERE s.layout_override_id = l.id) AS override_count,
      (l.id = t.default_layout_id) AS is_default
    FROM layouts l JOIN tenants t ON t.id = l.tenant_id WHERE l.tenant_id = ? ORDER BY l.name`);
  const qLayoutFull = db.prepare('SELECT * FROM layouts WHERE id = ? AND tenant_id = ?');
  const layoutToApi = (l) => ({ id: l.id, name: l.name, version: l.version, updated_at: l.updated_at, json: safe(l.json) });
  r.get('/layouts', (req, res) => res.json(qLayouts.all(req.tenant.id).map((l) => ({ ...l, is_default: !!l.is_default }))));
  r.get('/layouts/:id', (req, res) => {
    const l = qLayoutFull.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'layout not found' });
    res.json(layoutToApi(l));
  });
  r.post('/layouts', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80) || 'New layout';
    const { doc, errors } = validateLayout(b.json || starterLayout(name));
    if (errors.length) return res.status(400).json({ error: 'invalid layout', errors });
    doc.name = name;
    try {
      const id = db.prepare('INSERT INTO layouts (tenant_id, name, json) VALUES (?, ?, ?)').run(req.tenant.id, name, JSON.stringify(doc)).lastInsertRowid;
      res.status(201).json(layoutToApi(qLayoutFull.get(id, req.tenant.id)));
    } catch (e) { res.status(409).json({ error: 'a layout with that name exists' }); }
  });
  r.put('/layouts/:id', (req, res) => {
    const l = qLayoutFull.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'layout not found' });
    const b = req.body || {};
    const name = 'name' in b ? String(b.name || '').trim().slice(0, 80) : l.name;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { doc, errors } = validateLayout(b.json !== undefined ? b.json : l.json);
    if (errors.length) return res.status(400).json({ error: 'invalid layout', errors });
    doc.name = name;
    try {
      db.prepare(`UPDATE layouts SET name = ?, json = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
        .run(name, JSON.stringify(doc), l.id);
    } catch (e) { return res.status(409).json({ error: 'a layout with that name exists' }); }
    const pushed = hub.refresh(req.tenant.id);   // publish: every online set using this layout redraws
    log(`admin ${req.user.username}: layout ${l.id} "${name}" saved (v${l.version + 1}), pushed to ${pushed} set(s)`);
    res.json({ ...layoutToApi(qLayoutFull.get(l.id, req.tenant.id)), pushed });
  });
  r.post('/layouts/:id/duplicate', (req, res) => {
    const l = qLayoutFull.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'layout not found' });
    let name = `${l.name} copy`, i = 2;
    while (db.prepare('SELECT 1 FROM layouts WHERE tenant_id = ? AND name = ?').get(req.tenant.id, name)) name = `${l.name} copy ${i++}`;
    const doc = safe(l.json); doc.name = name;
    const id = db.prepare('INSERT INTO layouts (tenant_id, name, json) VALUES (?, ?, ?)').run(req.tenant.id, name, JSON.stringify(doc)).lastInsertRowid;
    res.status(201).json(layoutToApi(qLayoutFull.get(id, req.tenant.id)));
  });
  r.delete('/layouts/:id', (req, res) => {
    const l = qLayoutFull.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'layout not found' });
    db.prepare('UPDATE tenants SET default_layout_id = NULL WHERE id = ? AND default_layout_id = ?').run(req.tenant.id, l.id);
    db.prepare('DELETE FROM layouts WHERE id = ?').run(l.id);
    hub.refresh(req.tenant.id);
    res.json({ ok: true });
  });
  // Preview an unsaved layout on one connected set (not persisted).
  r.post('/sets/:id/preview', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    const { doc, errors } = validateLayout((req.body || {}).json);
    if (errors.length) return res.status(400).json({ error: 'invalid layout', errors });
    if (!hub.preview(s.id, doc)) return res.status(409).json({ error: 'set is not connected over WebSocket' });
    res.json({ ok: true });
  });
  // Queue a command for one set (delivered over WS now, or on the TV's next poll).
  r.post('/sets/:id/commands', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    const { type, payload } = req.body || {};
    if (!commands.TYPES.includes(type)) return res.status(400).json({ error: `unknown command type; one of ${commands.TYPES.join(', ')}` });
    const cmd = commands.queue(req.tenant, s, type, payload && typeof payload === 'object' ? payload : {});
    log(`admin ${req.user.username}: ${type} -> set ${s.id} (${s.serial}) [${cmd.status}]`);
    res.status(201).json({ id: cmd.id, type: cmd.type, status: cmd.status });
  });
  r.get('/sets/:id/commands', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    res.json(commands.recent(s.id, Number(req.query.limit) || 50));
  });
  r.post('/sets/:id/refresh', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    const pushed = hub.refresh(req.tenant.id, { setIds: [s.id], force: true });
    res.json({ ok: true, pushed });
  });

  // ---------------------------------------------------------------- tenant (minimal; settings page in step 5)
  r.get('/tenant', (req, res) => res.json(publicTenant(req.tenant)));
  r.patch('/tenant', (req, res) => {
    const b = req.body || {};
    if ('default_layout_id' in b) {
      if (b.default_layout_id != null && !qLayout.get(Number(b.default_layout_id), req.tenant.id)) return res.status(400).json({ error: 'unknown layout' });
      db.prepare('UPDATE tenants SET default_layout_id = ? WHERE id = ?').run(b.default_layout_id == null ? null : Number(b.default_layout_id), req.tenant.id);
    }
    if ('display_name' in b) {
      const v = String(b.display_name || '').trim().slice(0, 80);
      if (v) db.prepare('UPDATE tenants SET display_name = ? WHERE id = ?').run(v, req.tenant.id);
    }
    hub.refresh(req.tenant.id);
    res.json(publicTenant(db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.tenant.id)));
  });

  function state(req) { return req.app.locals.state; }
  function hasColumn(table, col) { return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col); }
  return r;
}

function publicTenant(t) { return { id: t.id, name: t.name, hostname: t.hostname, display_name: t.display_name, default_layout_id: t.default_layout_id }; }
function safe(s, fb = null) { try { return s == null ? fb : JSON.parse(s); } catch { return fb; } }
function str(v, max) { if (v == null) return null; const s = String(v).trim().slice(0, max); return s || null; }

module.exports = { createAdminRouter };
