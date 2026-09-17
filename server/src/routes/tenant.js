'use strict';
// Tenant settings, assets, weather check, messages, users, checkout, superadmin tenants.
const express = require('express');
const { execFile } = require('child_process');
const { decodeImageUpload } = require('../assets');
const { hashPassword, verifyPassword } = require('../auth');
const { syncTenantsFromDisk } = require('../tenants');

const SETTING_KEYS = ['timezone', 'weather', 'logo_url', 'guest_placeholder', 'checkout_message', 'netflix_hotel_id', 'checkin_time', 'checkout_time'];

function parseSettings(t) { try { return JSON.parse(t.settings_json || '{}') || {}; } catch { return {}; } }

function createTenantRouter({ db, hub, commands, assets, weather, tenantsDir, auth, tenantCommand, log = () => {} }) {
  const r = express.Router();
  const getTenant = (id) => db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  const tenantApi = (t) => ({ id: t.id, name: t.name, hostname: t.hostname, display_name: t.display_name, default_layout_id: t.default_layout_id,
    default_lineup_id: t.default_lineup_id, settings: parseSettings(t), created_at: t.created_at });

  // ---------------------------------------------------------------- settings
  r.get('/tenant', (req, res) => res.json(tenantApi(getTenant(req.tenant.id))));
  r.patch('/tenant', (req, res) => {
    const b = req.body || {};
    const t = getTenant(req.tenant.id);
    if ('default_layout_id' in b) {
      if (b.default_layout_id != null && !db.prepare('SELECT id FROM layouts WHERE id = ? AND tenant_id = ?').get(Number(b.default_layout_id), t.id)) return res.status(400).json({ error: 'unknown layout' });
      db.prepare('UPDATE tenants SET default_layout_id = ? WHERE id = ?').run(b.default_layout_id == null ? null : Number(b.default_layout_id), t.id);
    }
    if ('default_lineup_id' in b) {
      if (b.default_lineup_id != null && !db.prepare('SELECT id FROM lineups WHERE id = ? AND tenant_id = ?').get(Number(b.default_lineup_id), t.id)) return res.status(400).json({ error: 'unknown lineup' });
      db.prepare('UPDATE tenants SET default_lineup_id = ? WHERE id = ?').run(b.default_lineup_id == null ? null : Number(b.default_lineup_id), t.id);
    }
    if ('display_name' in b) {
      const v = String(b.display_name || '').trim().slice(0, 80);
      if (!v) return res.status(400).json({ error: 'display_name required' });
      db.prepare('UPDATE tenants SET display_name = ? WHERE id = ?').run(v, t.id);
    }
    if (b.settings && typeof b.settings === 'object') {
      const cur = parseSettings(t);
      for (const k of SETTING_KEYS) if (k in b.settings) cur[k] = b.settings[k];
      for (const k of ['checkin_time', 'checkout_time']) {
        if (!(k in b.settings)) continue;
        const v = String(b.settings[k] || '').trim();
        if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return res.status(400).json({ error: `${k}: use HH:MM (24 h)` });
        cur[k] = v;
      }
      if ('timezone' in b.settings && b.settings.timezone) {
        try { new Intl.DateTimeFormat('en', { timeZone: String(b.settings.timezone) }); } catch { return res.status(400).json({ error: 'timezone: unknown IANA zone (e.g. Europe/Amsterdam)' }); }
      }
      if ('netflix_hotel_id' in b.settings) {
        const v = String(b.settings.netflix_hotel_id || '').trim();
        if (v && !/^[A-Za-z0-9_.\-]{1,64}$/.test(v)) return res.status(400).json({ error: 'netflix_hotel_id: letters, digits, _ . - only (max 64)' });
        cur.netflix_hotel_id = v;
      }
      if (cur.weather) {
        const w = cur.weather;
        if (w.lat !== undefined && w.lat !== null && w.lat !== '' && !(Number(w.lat) >= -90 && Number(w.lat) <= 90)) return res.status(400).json({ error: 'latitude must be -90..90' });
        if (w.lon !== undefined && w.lon !== null && w.lon !== '' && !(Number(w.lon) >= -180 && Number(w.lon) <= 180)) return res.status(400).json({ error: 'longitude must be -180..180' });
        cur.weather = { lat: w.lat === '' ? null : w.lat, lon: w.lon === '' ? null : w.lon, units: w.units === 'imperial' ? 'imperial' : 'metric' };
      }
      db.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').run(JSON.stringify(cur), t.id);
    }
    hub.refresh(t.id);
    log(`admin ${req.user.username}: tenant ${t.name} settings updated`);
    res.json(tenantApi(getTenant(t.id)));
  });
  r.get('/weather', async (req, res) => {
    const w = await weather.get(parseSettings(getTenant(req.tenant.id)));
    res.json(w);
  });

  // ---------------------------------------------------------------- assets
  const rawImage = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' });
  r.get('/assets', (req, res) => res.json(assets.list(req.tenant)));
  r.post('/assets', rawImage, (req, res) => {
    const up = decodeImageUpload(req);
    if (up.error) return res.status(400).json({ error: up.error });
    let name = up.name ? String(up.name).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-') : `asset-${Date.now()}.${up.ext}`;
    if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) name += '.' + up.ext;
    if (String(req.query.as || '') === 'logo') {
      name = 'logo.' + up.ext;
      const cur = parseSettings(getTenant(req.tenant.id)); cur.logo_url = assets.urlFor(name);
      db.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').run(JSON.stringify(cur), req.tenant.id);
    }
    try {
      const out = assets.save(req.tenant, name, up.buf);
      log(`admin ${req.user.username}: asset ${out.name} (${out.bytes} bytes) for ${req.tenant.name}`);
      hub.refresh(req.tenant.id, { force: true });   // images may be cached by id on the TV; force redraw
      res.status(201).json(out);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/assets/:name', (req, res) => {
    if (!assets.remove(req.tenant, req.params.name)) return res.status(404).json({ error: 'asset not found' });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- messages
  const qMessages = db.prepare(`SELECT m.*, CASE m.target_type WHEN 'set' THEN (SELECT COALESCE('room ' || room_number, serial) FROM sets WHERE id = m.target_id)
      WHEN 'group' THEN (SELECT name FROM groups WHERE id = m.target_id) ELSE 'all sets' END AS target_name,
      (m.expires_at IS NOT NULL AND m.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS expired
    FROM messages m WHERE m.tenant_id = ? ORDER BY m.id DESC LIMIT 200`);
  r.get('/messages', (req, res) => res.json(qMessages.all(req.tenant.id).map((m) => ({ ...m, expired: !!m.expired }))));
  r.post('/messages', (req, res) => {
    const b = req.body || {};
    const text = String(b.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'text required' });
    const type = ['set', 'group', 'all'].includes(b.target_type) ? b.target_type : 'all';
    let targetId = null;
    if (type === 'set') { targetId = Number(b.target_id); if (!db.prepare('SELECT id FROM sets WHERE id = ? AND tenant_id = ?').get(targetId, req.tenant.id)) return res.status(400).json({ error: 'unknown set' }); }
    if (type === 'group') { targetId = Number(b.target_id); if (!db.prepare('SELECT id FROM groups WHERE id = ? AND tenant_id = ?').get(targetId, req.tenant.id)) return res.status(400).json({ error: 'unknown group' }); }
    let expires = null;
    if (b.expires_at) { const d = new Date(b.expires_at); if (isNaN(d)) return res.status(400).json({ error: 'expires_at invalid' }); expires = d.toISOString(); }
    else if (b.ttl_minutes) expires = new Date(Date.now() + Number(b.ttl_minutes) * 60000).toISOString();
    const id = db.prepare('INSERT INTO messages (tenant_id, target_type, target_id, text, expires_at) VALUES (?, ?, ?, ?, ?)').run(req.tenant.id, type, targetId, text, expires).lastInsertRowid;
    const pushed = hub.refresh(req.tenant.id);
    log(`admin ${req.user.username}: message #${id} to ${type}${targetId ? ' ' + targetId : ''}, pushed to ${pushed} set(s)`);
    res.status(201).json({ ...qMessages.all(req.tenant.id).find((m) => m.id === id), pushed });
  });
  r.delete('/messages/:id', (req, res) => {
    const info = db.prepare('DELETE FROM messages WHERE id = ? AND tenant_id = ?').run(Number(req.params.id), req.tenant.id);
    if (!info.changes) return res.status(404).json({ error: 'message not found' });
    hub.refresh(req.tenant.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- checkout
  r.post('/sets/:id/checkout', (req, res) => {
    const s = db.prepare('SELECT * FROM sets WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), req.tenant.id);
    if (!s) return res.status(404).json({ error: 'set not found' });
    db.prepare("DELETE FROM messages WHERE tenant_id = ? AND target_type = 'set' AND target_id = ?").run(req.tenant.id, s.id);
    const cmd = commands.queue(req.tenant, s, 'checkout', { message: parseSettings(getTenant(req.tenant.id)).checkout_message || null });
    db.prepare("INSERT INTO events (tenant_id, set_id, type, payload_json) VALUES (?, ?, 'checkout', ?)").run(req.tenant.id, s.id, JSON.stringify({ by: req.user.username }));
    hub.refresh(req.tenant.id, { setIds: [s.id] });
    log(`admin ${req.user.username}: checkout set ${s.id} (${s.serial})`);
    res.json({ ok: true, command: { id: cmd.id, status: cmd.status } });
  });

  // ---------------------------------------------------------------- users
  const userApi = (u) => ({ id: u.id, username: u.username, role: u.role, tenant_id: u.tenant_id, tenant_name: u.tenant_name || null, created_at: u.created_at, last_login: u.last_login });
  const qUsers = db.prepare(`SELECT u.*, t.name AS tenant_name FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
    WHERE (? = 1) OR u.tenant_id = ? ORDER BY u.tenant_id IS NULL DESC, u.username`);
  const isSuper = (req) => req.user.role === 'superadmin';
  r.get('/users', (req, res) => res.json(qUsers.all(isSuper(req) ? 1 : 0, req.tenant.id).map(userApi)));
  r.post('/users', (req, res) => {
    const b = req.body || {};
    const username = String(b.username || '').trim().toLowerCase().slice(0, 40);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(username)) return res.status(400).json({ error: 'username: letters, digits, . _ -' });
    if (!b.password || String(b.password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    let role = b.role === 'superadmin' ? 'superadmin' : 'tenant-admin';
    let tenantId = role === 'superadmin' ? null : (b.tenant_id != null && isSuper(req) ? Number(b.tenant_id) : req.tenant.id);
    if (role === 'superadmin' && !isSuper(req)) return res.status(403).json({ error: 'only a superadmin can create superadmins' });
    if (tenantId != null && !getTenant(tenantId)) return res.status(400).json({ error: 'unknown tenant' });
    try {
      const id = db.prepare('INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(tenantId, username, hashPassword(b.password), role).lastInsertRowid;
      log(`admin ${req.user.username}: created user ${username} (${role}${tenantId ? ', tenant ' + tenantId : ''})`);
      res.status(201).json(userApi(qUsers.all(1, 0).find((u) => u.id === id)));
    } catch (e) { res.status(409).json({ error: 'that username already exists for this tenant' }); }
  });
  function loadUser(req, res) {
    const u = qUsers.all(1, 0).find((x) => x.id === Number(req.params.id));
    if (!u || (!isSuper(req) && u.tenant_id !== req.tenant.id)) { res.status(404).json({ error: 'user not found' }); return null; }
    return u;
  }
  r.patch('/users/:id', (req, res) => {
    const u = loadUser(req, res); if (!u) return;
    const b = req.body || {};
    if (b.password) {
      if (String(b.password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
      db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(hashPassword(b.password), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(u.id, req.sessionId || '');
    }
    if (b.role && isSuper(req) && u.id !== req.user.id) {
      const role = b.role === 'superadmin' ? 'superadmin' : 'tenant-admin';
      db.prepare('UPDATE users SET role = ?, tenant_id = ? WHERE id = ?').run(role, role === 'superadmin' ? null : (u.tenant_id || req.tenant.id), u.id);
    }
    res.json(userApi(qUsers.all(1, 0).find((x) => x.id === u.id)));
  });
  r.delete('/users/:id', (req, res) => {
    const u = loadUser(req, res); if (!u) return;
    if (u.id === req.user.id) return res.status(400).json({ error: 'you cannot delete yourself' });
    if (u.role === 'superadmin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'superadmin'").get().n <= 1) return res.status(400).json({ error: 'cannot delete the last superadmin' });
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    res.json({ ok: true });
  });
  r.post('/me/password', (req, res) => {
    const { current, next } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!u || !verifyPassword(current, u.password_hash)) return res.status(400).json({ error: 'current password is wrong' });
    if (!next || String(next).length < 8) return res.status(400).json({ error: 'new password must be at least 8 characters' });
    db.prepare("UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(hashPassword(next), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(u.id, req.sessionId || '');
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- superadmin: tenants
  const qTenants = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM sets s WHERE s.tenant_id = t.id) AS set_count,
    (SELECT COUNT(*) FROM sets s WHERE s.tenant_id = t.id AND (julianday('now') - julianday(s.last_seen)) * 86400 < 180) AS online_count,
    (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count FROM tenants t ORDER BY t.name`);
  r.get('/tenants', auth.requireSuperadmin, (req, res) => res.json(qTenants.all().map((t) => ({ ...tenantApi(t), set_count: t.set_count, online_count: t.online_count, user_count: t.user_count }))));
  r.post('/tenants', auth.requireSuperadmin, async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().toLowerCase();
    const hostname = String(b.hostname || '').trim().toLowerCase();
    const display = String(b.display_name || '').trim().slice(0, 80) || name;
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) return res.status(400).json({ error: 'name: lowercase letters, digits, dashes' });
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(hostname)) return res.status(400).json({ error: 'hostname must be a bare FQDN' });
    if (db.prepare('SELECT id FROM tenants WHERE name = ? OR hostname = ?').get(name, hostname)) return res.status(409).json({ error: 'a tenant with that name or hostname exists' });
    try {
      const out = await tenantCommand(['new', name, hostname], { tenantsDir });
      syncTenantsFromDisk(db, tenantsDir, log);
      const t = db.prepare('SELECT * FROM tenants WHERE name = ?').get(name);
      if (!t) return res.status(500).json({ error: 'tenant created on disk but not found afterwards', output: out });
      db.prepare('UPDATE tenants SET display_name = ? WHERE id = ?').run(display, t.id);
      log(`admin ${req.user.username}: created tenant ${name} (${hostname})`);
      res.status(201).json({ ...tenantApi(getTenant(t.id)), output: out });
    } catch (e) {
      log(`tenant create failed: ${e.message}`);
      res.status(500).json({ error: 'coopcentric-tenant failed: ' + e.message.split('\n').slice(-3).join(' ') });
    }
  });
  r.patch('/tenants/:id', auth.requireSuperadmin, (req, res) => {
    const t = getTenant(Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'tenant not found' });
    const v = String((req.body || {}).display_name || '').trim().slice(0, 80);
    if (v) db.prepare('UPDATE tenants SET display_name = ? WHERE id = ?').run(v, t.id);
    hub.refresh(t.id);
    res.json(tenantApi(getTenant(t.id)));
  });
  return r;
}

// Runs the tenant CLI as root via sudo (install.sh installs /etc/sudoers.d/coopcentric).
function defaultTenantCommand(args, { tenantsDir } = {}) {
  return new Promise((resolve, reject) => {
    const bin = process.env.COOPCENTRIC_TENANT_BIN || '/usr/local/bin/coopcentric-tenant';
    const cmd = process.getuid && process.getuid() === 0 ? bin : 'sudo';
    // The CLI must create the tenant exactly where this server looks for tenants.
    const env = { COOPCENTRIC_HOME: process.env.COOPCENTRIC_HOME || '/opt/coopcentric', COOPCENTRIC_TENANTS_DIR: tenantsDir || '/srv/coopcentric/tenants' };
    const argv = cmd === 'sudo' ? ['-n', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), bin, ...args] : args;
    execFile(cmd, argv, { timeout: 60000, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim()));
      else resolve((stdout + stderr).trim());
    });
  });
}

module.exports = { createTenantRouter, defaultTenantCommand, parseSettings, SETTING_KEYS };
