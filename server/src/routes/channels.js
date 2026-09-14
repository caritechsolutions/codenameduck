'use strict';
// Channels + lineups admin API (mounted under /api/admin, after auth).
const express = require('express');
const { validateChannel, rowToApi, parseCsv, toCsv } = require('../channels');

function createChannelsRouter({ db, hub, log = () => {} }) {
  const r = express.Router();
  const qChannels = db.prepare('SELECT * FROM channels WHERE tenant_id = ? ORDER BY sort, number');
  const qChannel = db.prepare('SELECT * FROM channels WHERE id = ? AND tenant_id = ?');
  const ins = db.prepare(`INSERT INTO channels (tenant_id, number, name, logo_url, type, params_json, enabled, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const upd = db.prepare(`UPDATE channels SET number = ?, name = ?, logo_url = ?, type = ?, params_json = ?, enabled = ?, sort = ? WHERE id = ?`);

  r.get('/channels', (req, res) => res.json(qChannels.all(req.tenant.id).map(rowToApi)));
  r.get('/channels.csv', (req, res) => { res.type('text/csv').set('Content-Disposition', 'attachment; filename="channels.csv"').send(toCsv(qChannels.all(req.tenant.id).map(rowToApi))); });
  r.post('/channels', (req, res) => {
    const { channel: c, errors } = validateChannel(req.body);
    if (errors.length) return res.status(400).json({ error: 'invalid channel', errors });
    try {
      const id = ins.run(req.tenant.id, c.number, c.name, c.logo_url, c.type, JSON.stringify(c.params), c.enabled, c.sort).lastInsertRowid;
      hub.refresh(req.tenant.id);
      res.status(201).json(rowToApi(qChannel.get(id, req.tenant.id)));
    } catch (e) { res.status(409).json({ error: `channel number ${c.number} already exists` }); }
  });
  r.put('/channels/:id', (req, res) => {
    const cur = qChannel.get(Number(req.params.id), req.tenant.id);
    if (!cur) return res.status(404).json({ error: 'channel not found' });
    const merged = { ...rowToApi(cur), ...req.body, params: req.body.params || rowToApi(cur).params };
    const { channel: c, errors } = validateChannel(merged);
    if (errors.length) return res.status(400).json({ error: 'invalid channel', errors });
    try {
      upd.run(c.number, c.name, c.logo_url, c.type, JSON.stringify(c.params), c.enabled, c.sort, cur.id);
      hub.refresh(req.tenant.id);
      res.json(rowToApi(qChannel.get(cur.id, req.tenant.id)));
    } catch (e) { res.status(409).json({ error: `channel number ${c.number} already exists` }); }
  });
  r.delete('/channels/:id', (req, res) => {
    const cur = qChannel.get(Number(req.params.id), req.tenant.id);
    if (!cur) return res.status(404).json({ error: 'channel not found' });
    db.prepare('DELETE FROM channels WHERE id = ?').run(cur.id);
    hub.refresh(req.tenant.id);
    res.json({ ok: true });
  });
  // CSV import: body {csv: "..."} or text/csv. mode=replace deletes channels not in the file.
  r.post('/channels/import', express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), (req, res) => {
    const text = typeof req.body === 'string' ? req.body : (req.body && req.body.csv) || '';
    const { rows, errors } = parseCsv(text);
    if (!rows.length && errors.length) return res.status(400).json({ error: 'nothing imported', errors });
    const dry = String(req.query.dry || '') === '1';
    if (dry) return res.json({ imported: 0, would_import: rows.length, errors, rows });
    const existing = new Map(qChannels.all(req.tenant.id).map((c) => [c.number, c]));
    let created = 0, updated = 0;
    db.transaction(() => {
      for (const c of rows) {
        const e = existing.get(c.number);
        if (e) { upd.run(c.number, c.name, c.logo_url || e.logo_url, c.type, JSON.stringify(c.params), c.enabled, c.sort, e.id); updated++; }
        else { ins.run(req.tenant.id, c.number, c.name, c.logo_url, c.type, JSON.stringify(c.params), c.enabled, c.sort); created++; }
      }
    })();
    hub.refresh(req.tenant.id);
    log(`admin ${req.user.username}: channel import created ${created}, updated ${updated}, ${errors.length} line error(s)`);
    res.json({ imported: created + updated, created, updated, errors });
  });

  // ---------------------------------------------------------------- lineups
  const qLineups = db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM lineup_items li WHERE li.lineup_id = l.id) AS item_count,
      (SELECT COUNT(*) FROM lineup_assign la WHERE la.lineup_id = l.id) AS group_count,
      (SELECT COUNT(*) FROM sets s WHERE s.lineup_override_id = l.id) AS override_count,
      (l.id = t.default_lineup_id) AS is_default
    FROM lineups l JOIN tenants t ON t.id = l.tenant_id WHERE l.tenant_id = ? ORDER BY l.name`);
  const qLineup = db.prepare('SELECT * FROM lineups WHERE id = ? AND tenant_id = ?');
  const qItems = db.prepare(`SELECT c.* FROM lineup_items li JOIN channels c ON c.id = li.channel_id WHERE li.lineup_id = ? ORDER BY li.position`);
  const lineupApi = (l) => ({ id: l.id, name: l.name, items: qItems.all(l.id).map(rowToApi) });

  r.get('/lineups', (req, res) => res.json(qLineups.all(req.tenant.id).map((l) => ({ ...l, is_default: !!l.is_default }))));
  r.get('/lineups/:id', (req, res) => {
    const l = qLineup.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'lineup not found' });
    res.json(lineupApi(l));
  });
  r.post('/lineups', (req, res) => {
    const name = String((req.body || {}).name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
      const id = db.prepare('INSERT INTO lineups (tenant_id, name) VALUES (?, ?)').run(req.tenant.id, name).lastInsertRowid;
      if (Array.isArray(req.body.channel_ids)) setItems(req, id, req.body.channel_ids);
      res.status(201).json(lineupApi(qLineup.get(id, req.tenant.id)));
    } catch (e) { res.status(409).json({ error: 'a lineup with that name exists' }); }
  });
  r.put('/lineups/:id', (req, res) => {
    const l = qLineup.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'lineup not found' });
    const b = req.body || {};
    if ('name' in b) {
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name) return res.status(400).json({ error: 'name required' });
      try { db.prepare('UPDATE lineups SET name = ? WHERE id = ?').run(name, l.id); } catch (e) { return res.status(409).json({ error: 'a lineup with that name exists' }); }
    }
    if (Array.isArray(b.channel_ids)) {
      const bad = setItems(req, l.id, b.channel_ids);
      if (bad) return res.status(400).json({ error: `unknown channel id ${bad}` });
    }
    const pushed = hub.refresh(req.tenant.id);
    log(`admin ${req.user.username}: lineup ${l.id} saved, pushed to ${pushed} set(s)`);
    res.json({ ...lineupApi(qLineup.get(l.id, req.tenant.id)), pushed });
  });
  function setItems(req, lineupId, channelIds) {
    const valid = new Set(qChannels.all(req.tenant.id).map((c) => c.id));
    for (const id of channelIds) if (!valid.has(Number(id))) return id;
    db.transaction(() => {
      db.prepare('DELETE FROM lineup_items WHERE lineup_id = ?').run(lineupId);
      const ins2 = db.prepare('INSERT OR IGNORE INTO lineup_items (lineup_id, channel_id, position) VALUES (?, ?, ?)');
      channelIds.forEach((id, i) => ins2.run(lineupId, Number(id), i));
    })();
    return null;
  }
  r.delete('/lineups/:id', (req, res) => {
    const l = qLineup.get(Number(req.params.id), req.tenant.id);
    if (!l) return res.status(404).json({ error: 'lineup not found' });
    db.prepare('UPDATE tenants SET default_lineup_id = NULL WHERE id = ? AND default_lineup_id = ?').run(req.tenant.id, l.id);
    db.prepare('DELETE FROM lineups WHERE id = ?').run(l.id);
    hub.refresh(req.tenant.id);
    res.json({ ok: true });
  });
  r.put('/groups/:id/lineup', (req, res) => {
    const g = db.prepare('SELECT id FROM groups WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), req.tenant.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    const lid = (req.body || {}).lineup_id;
    if (lid == null) db.prepare('DELETE FROM lineup_assign WHERE group_id = ?').run(g.id);
    else {
      if (!qLineup.get(Number(lid), req.tenant.id)) return res.status(400).json({ error: 'unknown lineup' });
      db.prepare('INSERT INTO lineup_assign (group_id, lineup_id) VALUES (?, ?) ON CONFLICT(group_id) DO UPDATE SET lineup_id = excluded.lineup_id').run(g.id, Number(lid));
    }
    const pushed = hub.refresh(req.tenant.id);
    res.json({ ok: true, lineup_id: lid == null ? null : Number(lid), pushed });
  });
  return r;
}

module.exports = { createChannelsRouter };
