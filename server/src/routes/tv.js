'use strict';
// TV-facing API (docs/PLATFORM.md "TV ↔ server protocol"). All routes are tenant-scoped:
// req.tenant is set by the tenant resolver. Step 1 implements register + poll; the
// WebSocket channel, heartbeats and commands arrive in later steps.
const crypto = require('crypto');
const express = require('express');
const { makeLayoutResolver } = require('../layout');

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

function createTvRouter({ db, pollIntervalS }) {
  const router = express.Router();
  const resolveLayout = makeLayoutResolver(db);

  const findSet = db.prepare('SELECT * FROM sets WHERE tenant_id = ? AND serial = ?');
  const findSetById = db.prepare('SELECT * FROM sets WHERE id = ? AND tenant_id = ?');
  const findGroup = db.prepare('SELECT id, name FROM groups WHERE id = ? AND tenant_id = ?');
  const insertSet = db.prepare(`INSERT INTO sets (tenant_id, serial, token, api, room_number, ip,
      ${PROPERTY_FIELDS.join(', ')})
    VALUES (@tenant_id, @serial, @token, @api, @room_number, @ip, ${PROPERTY_FIELDS.map((f) => '@' + f).join(', ')})`);
  const updateSet = db.prepare(`UPDATE sets SET token = @token, api = COALESCE(@api, api),
      room_number = COALESCE(@room_number, room_number), ip = @ip,
      ${PROPERTY_FIELDS.map((f) => `${f} = COALESCE(@${f}, ${f})`).join(', ')},
      last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = @id`);
  const touchSet = db.prepare(`UPDATE sets SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ip = ? WHERE id = ?`);
  const insertEvent = db.prepare('INSERT INTO events (tenant_id, set_id, type, payload_json) VALUES (?, ?, ?, ?)');

  function statePayload(tenant, set) {
    const group = set.group_id ? findGroup.get(set.group_id, tenant.id) : null;
    return {
      set_id: set.id,
      room_number: set.room_number,
      group: group || null,
      layout: resolveLayout(tenant, set),
      lineup: [],            // step 3
      messages: [],          // step 5
      commands: [],          // step 3
      ws_url: null,          // step 2 — null tells the renderer to poll
      poll_interval_s: pollIntervalS,
      server_time: new Date().toISOString(),
    };
  }

  // POST /api/tv/register  body: {serial_number, model_name, platform_version, firmware_version,
  //                               webos_version, idpn, room_number, api, mac, app_version}
  router.post('/register', (req, res) => {
    const b = req.body || {};
    const serial = str(b.serial_number || b.serial);
    if (!serial) return res.status(400).json({ error: 'serial_number required' });
    const api = ['idcap', 'hcap'].includes(b.api) ? b.api : null;
    const fields = {
      serial, api, ip: clientIp(req),
      room_number: str(b.room_number),
      model: str(b.model_name || b.model),
      platform_version: str(b.platform_version),
      firmware_version: str(b.firmware_version),
      webos_version: str(b.webos_version),
      idpn: str(b.idpn),
      mac: str(b.mac),
      app_version: str(b.app_version),
      token: crypto.randomBytes(24).toString('base64url'),
    };

    const tenant = req.tenant;
    let set = findSet.get(tenant.id, serial);
    let created = false;
    const tx = db.transaction(() => {
      if (set) {
        updateSet.run({ ...fields, id: set.id });
      } else {
        const info = insertSet.run({ ...fields, tenant_id: tenant.id });
        created = true;
        set = { id: info.lastInsertRowid };
      }
      insertEvent.run(tenant.id, set.id, created ? 'register_new' : 'register',
        JSON.stringify({ api, model: fields.model, firmware: fields.firmware_version, ip: fields.ip }));
      set = findSetById.get(set.id, tenant.id);
    });
    tx();

    req.log(`${tenant.name}: ${created ? 'NEW set' : 'register'} serial=${serial} model=${fields.model || '?'} api=${api || '?'} room=${set.room_number || '-'} ip=${fields.ip}`);
    res.json({ ...statePayload(tenant, set), token: set.token, created });
  });

  // GET /api/tv/poll?set_id=..&token=..   (also accepts X-Set-Id / X-Set-Token headers)
  router.get('/poll', (req, res) => {
    const setId = Number(req.query.set_id || req.headers['x-set-id']);
    const token = String(req.query.token || req.headers['x-set-token'] || '');
    const set = Number.isInteger(setId) && setId > 0 ? findSetById.get(setId, req.tenant.id) : null;
    if (!set || !token || set.token !== token) {
      return res.status(401).json({ error: 'unknown set or bad token; re-register' });
    }
    touchSet.run(clientIp(req), set.id);
    res.json(statePayload(req.tenant, set));
  });

  return router;
}

module.exports = { createTvRouter };
