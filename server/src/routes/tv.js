'use strict';
// TV-facing API (docs/PLATFORM.md "TV ↔ server protocol"). Tenant-scoped via req.tenant.
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { isFactoryRoom } = require('../state');

const PROPERTY_FIELDS = ['model', 'platform_version', 'firmware_version', 'webos_version', 'idpn', 'mac', 'app_version'];
const MAX_LEN = 128;

function str(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_LEN) : null;
}
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || null;
}

function createTvRouter({ db, state, commands, hub, screenshots, weather, log = () => {} }) {
  const router = express.Router();
  const findSet = db.prepare('SELECT * FROM sets WHERE tenant_id = ? AND serial = ?');
  const findSetById = db.prepare('SELECT * FROM sets WHERE id = ? AND tenant_id = ?');
  const insertSet = db.prepare(`INSERT INTO sets (tenant_id, serial, token, api, room_number, reported_room, ip, ${PROPERTY_FIELDS.join(', ')})
    VALUES (@tenant_id, @serial, @token, @api, @room_number, @reported_room, @ip, ${PROPERTY_FIELDS.map((f) => '@' + f).join(', ')})`);
  const updateSet = db.prepare(`UPDATE sets SET token = @token, api = COALESCE(@api, api),
      room_number = COALESCE(room_number, @room_number), reported_room = COALESCE(@reported_room, reported_room), ip = @ip,
      ${PROPERTY_FIELDS.map((f) => `${f} = COALESCE(@${f}, ${f})`).join(', ')},
      last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = @id`);
  const touchSet = db.prepare(`UPDATE sets SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ip = ? WHERE id = ?`);
  const insertEvent = db.prepare('INSERT INTO events (tenant_id, set_id, type, payload_json) VALUES (?, ?, ?, ?)');

  // POST /api/tv/register  body: {serial_number, model_name, platform_version, firmware_version,
  //                               webos_version, idpn, room_number, api, mac, app_version}
  router.post('/register', (req, res) => {
    const b = req.body || {};
    const serial = str(b.serial_number || b.serial);
    if (!serial) return res.status(400).json({ error: 'serial_number required' });
    const api = ['idcap', 'hcap'].includes(b.api) ? b.api : null;
    const reported = str(b.room_number);
    const fields = {
      serial, api, ip: clientIp(req),
      reported_room: reported,
      // LG ships room_number as "[TV]<serial>"; that is "unassigned", never a room.
      room_number: isFactoryRoom(reported) ? null : reported,
      model: str(b.model_name || b.model),
      platform_version: str(b.platform_version),
      firmware_version: str(b.firmware_version),
      webos_version: str(b.webos_version),
      idpn: str(b.idpn),
      mac: str(b.mac),
      app_version: str(b.app_version),
      token: crypto.randomBytes(24).toString('base64url'),
    };
    const instantPower = b.instant_power == null || b.instant_power === '' ? null : (Number(b.instant_power) ? 1 : 0);

    const tenant = req.tenant;
    let set = findSet.get(tenant.id, serial);
    let created = false;
    db.transaction(() => {
      if (set) updateSet.run({ ...fields, id: set.id });
      else { const info = insertSet.run({ ...fields, tenant_id: tenant.id }); created = true; set = { id: info.lastInsertRowid }; }
      insertEvent.run(tenant.id, set.id, created ? 'register_new' : 'register',
        JSON.stringify({ api, model: fields.model, firmware: fields.firmware_version, ip: fields.ip, app_version: fields.app_version }));
      if (instantPower != null) db.prepare('UPDATE sets SET instant_power = ? WHERE id = ?').run(instantPower, set.id);
      set = findSetById.get(set.id, tenant.id);
    })();

    // Admin-assigned room wins: if the TV's own property disagrees, queue a fix (PLATFORM.md §4).
    if (set.room_number && reported !== set.room_number && commands) {
      commands.queue(tenant, set, 'set_property', { key: 'room_number', value: set.room_number }, { dedupe: true });
    }
    // Same for Instant On: the group decides instant_power; a disagreeing set gets a visible command.
    if (set.group_id && commands) {
      const g = db.prepare('SELECT power_mode FROM groups WHERE id = ?').get(set.group_id);
      if (g && g.power_mode) {
        const desired = g.power_mode === 'WARM' ? 1 : 0;
        if (instantPower !== desired) commands.queue(tenant, set, 'set_property', { key: 'instant_power', value: desired }, { dedupe: true });
      }
    }

    log(`${tenant.name}: ${created ? 'NEW set' : 'register'} serial=${serial} model=${fields.model || '?'} api=${api || '?'} room=${set.room_number || '-'} reported=${reported || '-'} ip=${fields.ip}`);
    res.json({ ...state.build(tenant, set), token: set.token, created });
  });

  function authSet(req, res) {
    const setId = Number(req.query.set_id || req.headers['x-set-id']);
    const token = String(req.query.token || req.headers['x-set-token'] || '');
    const set = Number.isInteger(setId) && setId > 0 ? findSetById.get(setId, req.tenant.id) : null;
    if (!set || !token || set.token !== token) { res.status(401).json({ error: 'unknown set or bad token; re-register' }); return null; }
    return set;
  }

  // GET /api/tv/poll?set_id=..&token=..   (also accepts X-Set-Id / X-Set-Token headers)
  router.get('/poll', (req, res) => {
    const set = authSet(req, res); if (!set) return;
    touchSet.run(clientIp(req), set.id);
    const st = state.build(req.tenant, set);
    if (commands && st.commands.length) commands.sent(st.commands.map((c) => c.id));
    res.json(st);
  });

  // POST /api/tv/ack?set_id&token  {command_id, ok, result}  — poll-mode fallback for acks
  router.post('/ack', (req, res) => {
    const set = authSet(req, res); if (!set) return;
    const b = req.body || {};
    const ok = commands ? commands.ack(set.id, Number(b.command_id), !!b.ok, b.result) : false;
    res.json({ ok });
  });

  // POST /api/tv/upload?set_id&token&command_id=  — screenshot upload. Body: raw image
  // (Content-Type image/jpeg|png) or JSON {data_url:"data:image/png;base64,..."}.
  const rawImage = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '8mb' });
  router.post('/upload', rawImage, (req, res) => {
    const set = authSet(req, res); if (!set) return;
    if (!screenshots) return res.status(503).json({ error: 'screenshot storage not configured' });
    let buf = null, ext = 'jpg';
    if (Buffer.isBuffer(req.body) && req.body.length) {
      buf = req.body; ext = /png/.test(req.headers['content-type'] || '') ? 'png' : 'jpg';
    } else if (req.body && typeof req.body.data_url === 'string') {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(req.body.data_url);
      if (!m) return res.status(400).json({ error: 'data_url must be a base64 PNG or JPEG' });
      buf = Buffer.from(m[2], 'base64'); ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpg';
    }
    if (!buf || !buf.length) return res.status(400).json({ error: 'no image data' });
    const file = screenshots.save(set.id, buf, ext);
    db.prepare(`UPDATE sets SET screenshot_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(set.id);
    const cid = Number(req.query.command_id);
    if (cid && commands) commands.ack(set.id, cid, true, { file: path.basename(file), bytes: buf.length });
    log(`${req.tenant.name}: screenshot from set ${set.id} (${buf.length} bytes)`);
    res.json({ ok: true, bytes: buf.length });
  });

  // POST /api/tv/events?set_id&token  {events:[{name, payload, at}]} — used while the WebSocket is down.
  router.post('/events', (req, res) => {
    const set = authSet(req, res); if (!set) return;
    const list = Array.isArray((req.body || {}).events) ? req.body.events.slice(0, 50) : [];
    for (const ev of list) if (ev && typeof ev === 'object') hub.recordTvEvent(req.tenant.id, set.id, ev);
    touchSet.run(clientIp(req), set.id);
    res.json({ ok: true, recorded: list.length });
  });

  // GET /api/tv/weather?set_id&token — current conditions for the tenant's configured location.
  router.get('/weather', async (req, res) => {
    const set = authSet(req, res); if (!set) return;
    if (!weather) return res.json({ ok: false, reason: 'weather not configured' });
    let settings = {}; try { settings = JSON.parse(req.tenant.settings_json || '{}') || {}; } catch { /* ignore */ }
    res.json(await weather.get(settings));
  });

  return router;
}

module.exports = { createTvRouter };
