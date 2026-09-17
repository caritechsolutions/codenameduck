'use strict';
// Part C routes.
// Admin (mounted under /api/admin, session auth):
//   GET    /reservations?from&to&status&q&room&group_id&arrivals&departures
//   POST   /reservations            PATCH /reservations/:id      DELETE /reservations/:id (cancel)
//   POST   /reservations/:id/checkin   POST /reservations/:id/checkout
//   GET    /rooms?date&group_id      GET /reservations/export?from&to (CSV)
//   POST   /import/parse {filename, content_base64|text}   POST /import/preview {rows, mapping, date_format}
//   POST   /import/commit {rows, mapping, date_format}     POST /import/report {skipped, headers} (CSV)
//   GET/POST /import-profiles        DELETE /import-profiles/:id
//   GET    /pms/settings   POST /pms/key   DELETE /pms/key   GET /pms/log
// External PMS bridge (mounted at /api/pms, per-tenant API key in Authorization: Bearer or X-Api-Key):
//   POST /reservations   PATCH /reservations/:id   GET /reservations/:id   GET /rooms?date=
const express = require('express');

function createPmsAdminRouter({ pms, log = () => {} }) {
  const r = express.Router();
  const send = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const by = (req) => req.user && req.user.username;

  r.get('/reservations', (req, res) => send(res, () => pms.list(req.tenant.id, req.query)));
  r.get('/reservations/export', (req, res) => {
    try {
      const csv = pms.exportCsv(req.tenant.id, { from: req.query.from || null, to: req.query.to || null });
      res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="reservations-${req.tenant.name}.csv"`).send(csv);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  r.get('/reservations/:id', (req, res) => send(res, () => pms.get(req.tenant, req.params.id)));
  r.post('/reservations', (req, res) => { try { res.status(201).json(pms.create(req.tenant, req.body || {}, { source: 'manual', by: by(req) })); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  r.patch('/reservations/:id', (req, res) => send(res, () => pms.update(req.tenant, req.params.id, req.body || {}, { source: 'manual', by: by(req) })));
  r.delete('/reservations/:id', (req, res) => send(res, () => pms.cancel(req.tenant, req.params.id, { source: 'manual', by: by(req) })));
  r.post('/reservations/:id/checkin', (req, res) => send(res, () => pms.checkinNow(req.tenant, req.params.id, { source: 'manual', by: by(req) })));
  r.post('/reservations/:id/checkout', (req, res) => send(res, () => pms.checkoutNow(req.tenant, req.params.id, { source: 'manual', by: by(req) })));
  r.get('/rooms', (req, res) => send(res, () => pms.rooms(req.tenant, req.query.date || null, { group_id: req.query.group_id || null })));

  r.post('/import/parse', (req, res) => send(res, () => pms.parseUpload(req.body || {})));
  r.post('/import/preview', (req, res) => send(res, () => {
    const rows = pms.prepareImport(req.tenant, req.body || {});
    return { rows: rows.map((x) => ({ index: x.index, value: x.value, errors: x.errors })), ok: rows.filter((x) => !x.errors.length).length, bad: rows.filter((x) => x.errors.length).length };
  }));
  r.post('/import/commit', (req, res) => send(res, () => pms.commitImport(req.tenant, req.body || {}, { by: by(req) })));
  r.post('/import/report', (req, res) => {
    const b = req.body || {};
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="skipped-rows.csv"').send(pms.skippedCsv(Array.isArray(b.skipped) ? b.skipped : [], Array.isArray(b.headers) ? b.headers : []));
  });
  r.get('/import-profiles', (req, res) => send(res, () => pms.profiles(req.tenant.id)));
  r.post('/import-profiles', (req, res) => send(res, () => pms.saveProfile(req.tenant.id, req.body || {})));
  r.delete('/import-profiles/:id', (req, res) => { if (!pms.deleteProfile(req.tenant.id, req.params.id)) return res.status(404).json({ error: 'profile not found' }); res.json({ ok: true }); });

  r.get('/pms/settings', (req, res) => send(res, () => ({ ...pms.pmsSettings(req.tenant), today: pms.today(req.tenant), api_key: pms.keyInfo(req.tenant), fields: pms.FIELDS, date_formats: pms.DATE_FORMATS })));
  r.post('/pms/key', (req, res) => { const k = pms.generateKey(req.tenant); log(`admin ${by(req)}: PMS API key generated for ${req.tenant.name} (${k.prefix}…)`); res.json(k); });
  r.delete('/pms/key', (req, res) => { pms.revokeKey(req.tenant); log(`admin ${by(req)}: PMS API key revoked for ${req.tenant.name}`); res.json({ ok: true }); });
  r.get('/pms/log', (req, res) => send(res, () => pms.recentLog(req.tenant.id, req.query.limit)));
  return r;
}

function createPmsApiRouter({ pms, log = () => {} }) {
  const r = express.Router();
  r.use((req, res, next) => {
    const h = req.get('authorization') || '';
    const key = /^Bearer\s+(.+)$/i.exec(h) ? RegExp.$1.trim() : req.get('x-api-key');
    if (!pms.authenticate(req.tenant, key)) return res.status(401).json({ error: 'invalid or missing API key (Settings → PMS → generate key)' });
    next();
  });
  const send = (res, status, fn) => { try { res.status(status).json(fn()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  const body = (b) => ({ room_number: b.room ?? b.room_number, first_name: b.first_name, last_name: b.last_name, checkin_date: b.checkin_date ?? b.checkin, checkout_date: b.checkout_date ?? b.checkout, lang: b.lang, vip: b.vip, notes: b.notes });
  // Idempotent create: the same room/dates/name returns the existing reservation.
  r.post('/reservations', (req, res) => {
    const b = body(req.body || {});
    const same = pms.list(req.tenant.id, { room: b.room_number, from: b.checkin_date, to: b.checkin_date, status: 'booked,checked_in' })
      .find((x) => x.checkin_date === b.checkin_date && x.checkout_date === b.checkout_date && x.first_name === String(b.first_name || '').trim() && x.last_name === String(b.last_name || '').trim());
    if (same) return res.json(same);
    log(`pms api ${req.tenant.name}: create ${b.room_number} ${b.checkin_date}→${b.checkout_date}`);
    send(res, 201, () => pms.create(req.tenant, b, { source: 'api', by: 'api' }));
  });
  r.patch('/reservations/:id', (req, res) => {
    const b = req.body || {};
    if (b.status === 'checked_in') return send(res, 200, () => pms.checkinNow(req.tenant, req.params.id, { source: 'api', by: 'api' }));
    if (b.status === 'checked_out') return send(res, 200, () => pms.checkoutNow(req.tenant, req.params.id, { source: 'api', by: 'api' }));
    if (b.status === 'cancelled') return send(res, 200, () => pms.cancel(req.tenant, req.params.id, { source: 'api', by: 'api' }));
    const patch = {}; for (const [k, v] of Object.entries(body(b))) if (v !== undefined) patch[k] = v;
    send(res, 200, () => pms.update(req.tenant, req.params.id, patch, { source: 'api', by: 'api' }));
  });
  r.get('/reservations/:id', (req, res) => send(res, 200, () => pms.get(req.tenant, req.params.id)));
  r.get('/reservations', (req, res) => send(res, 200, () => pms.list(req.tenant.id, req.query)));
  r.get('/rooms', (req, res) => send(res, 200, () => pms.rooms(req.tenant, req.query.date || null)));
  return r;
}

module.exports = { createPmsAdminRouter, createPmsApiRouter };
