'use strict';
// Apps admin API (Phase 3 B3).
//   GET    /api/admin/apps                 discovered apps (+ group_ids enabled, models, set_count, raw)
//   PATCH  /api/admin/apps/:id             {name_override, icon_override}
//   DELETE /api/admin/apps/:id             forget an app (re-appears at the next register that lists it)
//   PUT    /api/admin/groups/:id/apps      {app_ids: [db ids in tile order]} → enabled for that group
//   GET    /api/admin/groups/:id/apps      [{id, app_id, name, icon}] in order
const express = require('express');

function createAppsRouter({ db, hub, apps, log = () => {} }) {
  const r = express.Router();
  const qGroup = db.prepare('SELECT id, name FROM groups WHERE id = ? AND tenant_id = ?');

  r.get('/apps', (req, res) => res.json(apps.list(req.tenant)));
  r.patch('/apps/:id', (req, res) => {
    const out = apps.updateOverrides(req.tenant, req.params.id, req.body || {});
    if (!out) return res.status(404).json({ error: 'app not found' });
    hub.refresh(req.tenant.id);
    log(`admin ${req.user.username}: app ${out.app_id} → name "${out.name}"${out.icon ? ' icon set' : ''}`);
    res.json(out);
  });
  r.delete('/apps/:id', (req, res) => {
    if (!apps.remove(req.tenant, req.params.id)) return res.status(404).json({ error: 'app not found' });
    hub.refresh(req.tenant.id);
    res.json({ ok: true });
  });
  r.get('/groups/:id/apps', (req, res) => {
    const g = qGroup.get(Number(req.params.id), req.tenant.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    res.json(apps.enabledFor(req.tenant, { group_id: g.id }));
  });
  r.put('/groups/:id/apps', (req, res) => {
    const g = qGroup.get(Number(req.params.id), req.tenant.id);
    if (!g) return res.status(404).json({ error: 'group not found' });
    const ids = (req.body || {}).app_ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'app_ids must be an array' });
    try {
      const saved = apps.setGroupApps(req.tenant, g.id, ids);
      const pushed = hub.refresh(req.tenant.id);
      log(`admin ${req.user.username}: group ${g.name} apps = [${saved.join(',')}] (pushed to ${pushed})`);
      res.json({ ok: true, app_ids: saved, pushed, apps: apps.enabledFor(req.tenant, { group_id: g.id }) });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  return r;
}

module.exports = { createAppsRouter };
