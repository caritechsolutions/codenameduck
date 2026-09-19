'use strict';
// Admin API. Everything under /api/admin is tenant-scoped by Host (req.tenant) and, except
// login, requires a session. Tenant-admins are confined to their tenant; superadmins act on
// whichever tenant's hostname they are using.
const express = require('express');
const { validateLayout, starterLayout, templateLayout, layoutTemplates } = require('../layout');
const { isFactoryRoom } = require('../state');

const ONLINE_SQL = `((julianday('now') - julianday(s.last_seen)) * 86400 < 180)`;

function createAdminRouter({ db, auth, hub, commands, screenshots = null, log = () => {} }) {
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

  const qLastError = db.prepare(`SELECT payload_json, created_at FROM events WHERE set_id = ? AND type = 'tv_error' ORDER BY id DESC LIMIT 1`);
  function lastError(setId) {
    const e = qLastError.get(setId);
    if (!e) return null;
    const p = safe(e.payload_json) || {};
    return { kind: p.kind || null, message: p.message || null, at: e.created_at };
  }
  function setToApi(s) {
    const { token, ...rest } = s;
    return { ...rest, online: !!s.online, ws: hub.isConnected(s.id), reported_room_is_factory: isFactoryRoom(s.reported_room), last_error: lastError(s.id) };
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
      layout: state(req).resolveLayout(req.tenant, s),
      lineup: state(req).resolveLineup(req.tenant, s) });
  });
  // Instant On is applied through a visible set_property command (queued, delivered, acked,
  // errors logged). LG instant_power values: 0 off, 1 Instant On with update-on-off, 2 Instant
  // On, 10 Always On — sent as strings (the TV only accepts string property values).
  const INSTANT_POWER_VALUES = [0, 1, 2, 10];
  const qGroupPower = db.prepare('SELECT instant_power FROM groups WHERE id = ? AND tenant_id = ?');
  const qGroupSets = db.prepare('SELECT * FROM sets WHERE tenant_id = ? AND group_id = ?');
  function queueInstantPower(tenant, set, value) {
    if (value == null) return null;
    return commands.queue(tenant, set, 'set_property', { key: 'instant_power', value: String(value) }, { dedupe: true });
  }
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
    if ('lineup_override_id' in b) {
      if (b.lineup_override_id != null && !db.prepare('SELECT id FROM lineups WHERE id = ? AND tenant_id = ?').get(Number(b.lineup_override_id), req.tenant.id)) return res.status(400).json({ error: 'unknown lineup' });
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
    if ('group_id' in upd && upd.group_id !== s.group_id && upd.group_id) {
      const g = qGroupPower.get(upd.group_id, req.tenant.id);
      if (g) queueInstantPower(req.tenant, s, g.instant_power);
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
  const qGroups = db.prepare(`SELECT g.*, la.layout_id, l.name AS layout_name, lu.lineup_id, lp.name AS lineup_name, (SELECT name FROM layouts v WHERE v.id = g.vacant_layout_id) AS vacant_layout_name,
      (SELECT COUNT(*) FROM sets s WHERE s.group_id = g.id) AS set_count
    FROM groups g LEFT JOIN layout_assign la ON la.group_id = g.id LEFT JOIN layouts l ON l.id = la.layout_id
    LEFT JOIN lineup_assign lu ON lu.group_id = g.id LEFT JOIN lineups lp ON lp.id = lu.lineup_id
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
    let instantPower = g.instant_power;
    if ('instant_power' in b) {
      if (b.instant_power != null && b.instant_power !== '' && !INSTANT_POWER_VALUES.includes(Number(b.instant_power))) return res.status(400).json({ error: 'instant_power must be 0, 1, 2, 10 or null' });
      instantPower = b.instant_power == null || b.instant_power === '' ? null : Number(b.instant_power);
    }
    let vacant = g.vacant_layout_id;
    if ('vacant_layout_id' in b) {
      if (b.vacant_layout_id != null && b.vacant_layout_id !== '' && !qLayout.get(Number(b.vacant_layout_id), req.tenant.id)) return res.status(400).json({ error: 'unknown vacant layout' });
      vacant = b.vacant_layout_id == null || b.vacant_layout_id === '' ? null : Number(b.vacant_layout_id);
    }
    let welcome = g.welcome_popup_s;
    if ('welcome_popup_s' in b) { const n = Number(b.welcome_popup_s); if (!Number.isInteger(n) || n < 0 || n > 600) return res.status(400).json({ error: 'welcome_popup_s must be 0–600 seconds' }); welcome = n; }
    // D4b: "Hide TV's own OSD" — off | banner (Installer Menu 107 BANNER_SELECT) | osd_lock (banner + property osd_lock while the portal is in front)
    let hideOsd = g.hide_tv_osd || 'banner', bannerSelect = g.banner_select == null ? 1 : g.banner_select;
    if ('hide_tv_osd' in b) { if (!['off', 'banner', 'osd_lock'].includes(b.hide_tv_osd)) return res.status(400).json({ error: 'hide_tv_osd must be off, banner or osd_lock' }); hideOsd = b.hide_tv_osd; }
    if ('banner_select' in b) { if (![0, 1].includes(Number(b.banner_select))) return res.status(400).json({ error: 'banner_select must be 0 or 1' }); bannerSelect = Number(b.banner_select); }
    try {
      db.prepare('UPDATE groups SET name = ?, description = ?, instant_power = ?, vacant_layout_id = ?, welcome_popup_s = ?, hide_tv_osd = ?, banner_select = ? WHERE id = ?').run(name, 'description' in b ? str(b.description, 500) : g.description, instantPower, vacant, welcome, hideOsd, bannerSelect, g.id);
    } catch (e) { return res.status(409).json({ error: 'a group with that name exists' }); }
    let queued = 0;
    if ('instant_power' in b && instantPower !== g.instant_power && instantPower != null) {
      for (const s of qGroupSets.all(req.tenant.id, g.id)) { queueInstantPower(req.tenant, s, instantPower); queued++; }
      log(`admin ${req.user.username}: group ${g.id} instant_power=${instantPower} queued for ${queued} set(s)`);
    }
    if ('layout_id' in b) assignLayout(req, g.id, b.layout_id, res, true);
    hub.refresh(req.tenant.id);
    res.json({ ...qGroupFull.get(g.id, req.tenant.id), instant_power_queued: queued });
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
  const qLayouts = db.prepare(`SELECT l.id, l.name, l.version, l.updated_at, l.json,
      (SELECT COUNT(*) FROM layout_assign la WHERE la.layout_id = l.id) AS group_count,
      (SELECT COUNT(*) FROM sets s WHERE s.layout_override_id = l.id) AS override_count,
      (l.id = t.default_layout_id) AS is_default
    FROM layouts l JOIN tenants t ON t.id = l.tenant_id WHERE l.tenant_id = ? ORDER BY l.name`);
  const qLayoutFull = db.prepare('SELECT * FROM layouts WHERE id = ? AND tenant_id = ?');
  const layoutToApi = (l) => ({ id: l.id, name: l.name, version: l.version, updated_at: l.updated_at, json: safe(l.json) });
  r.get('/layouts', (req, res) => res.json(qLayouts.all(req.tenant.id).map((l) => ({ ...l, json: safe(l.json), is_default: !!l.is_default }))));
  r.get('/layouts/:id', (req, res) => {
    const l = qLayoutFull.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'layout not found' });
    res.json(layoutToApi(l));
  });
  r.get('/layout-templates', (_req, res) => res.json(layoutTemplates()));
  r.post('/layouts', (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80) || 'New layout';
    let base = b.json;
    if (!base && b.template) { base = templateLayout(String(b.template), name); if (!base) return res.status(400).json({ error: 'unknown template' }); }
    const { doc, errors } = validateLayout(base || starterLayout(name));
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
    const page = (req.body || {}).page;
    if (page != null && !(doc.pages || []).some((p) => p.id === page)) return res.status(400).json({ error: `unknown page "${page}"` });
    if (!hub.preview(s.id, doc, page || null)) return res.status(409).json({ error: 'set is not connected over WebSocket' });
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
  r.get('/sets/:id/screenshot', (req, res) => {
    const s = loadSet(req, res); if (!s) return;
    const f = screenshots && screenshots.latest(s.id);
    if (!f) return res.status(404).json({ error: 'no screenshot yet' });
    res.set('Cache-Control', 'no-store');
    res.sendFile(f);
  });
  // Bulk: {type, payload, set_ids?:[], group_id?, all?:true}
  r.post('/commands', (req, res) => {
    const { type, payload, set_ids, group_id, all } = req.body || {};
    if (!commands.TYPES.includes(type)) return res.status(400).json({ error: `unknown command type; one of ${commands.TYPES.join(', ')}` });
    let targets;
    if (all) targets = db.prepare('SELECT * FROM sets WHERE tenant_id = ?').all(req.tenant.id);
    else if (group_id != null) targets = db.prepare('SELECT * FROM sets WHERE tenant_id = ? AND group_id = ?').all(req.tenant.id, Number(group_id));
    else if (Array.isArray(set_ids) && set_ids.length) targets = set_ids.map((id) => qSet.get(Number(id), req.tenant.id)).filter(Boolean);
    else return res.status(400).json({ error: 'set_ids, group_id or all required' });
    let sent = 0, queued = 0;
    for (const s of targets) { const c = commands.queue(req.tenant, s, type, payload && typeof payload === 'object' ? payload : {}); if (c.status === 'sent') sent++; else queued++; }
    log(`admin ${req.user.username}: bulk ${type} -> ${targets.length} set(s) (${sent} sent, ${queued} queued)`);
    res.json({ targets: targets.length, sent, queued });
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

  function state(req) { return req.app.locals.state; }
  function hasColumn(table, col) { return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col); }
  return r;
}

function publicTenant(t) { let settings = {}; try { settings = JSON.parse(t.settings_json || '{}') || {}; } catch { /* ignore */ }
  return { id: t.id, name: t.name, hostname: t.hostname, display_name: t.display_name, default_layout_id: t.default_layout_id, default_lineup_id: t.default_lineup_id, settings }; }
function safe(s, fb = null) { try { return s == null ? fb : JSON.parse(s); } catch { return fb; } }
function str(v, max) { if (v == null) return null; const s = String(v).trim().slice(0, max); return s || null; }

module.exports = { createAdminRouter };
