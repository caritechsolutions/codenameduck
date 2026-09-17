'use strict';
// Apps admin API (Phase 3 B3).
//   GET    /api/admin/apps                 discovered apps (+ group_ids enabled, models, set_count, raw)
//   PATCH  /api/admin/apps/:id             {name_override, icon_override}
//   DELETE /api/admin/apps/:id             forget an app (re-appears at the next register that lists it)
//   PUT    /api/admin/groups/:id/apps      {app_ids: [db ids in tile order]} → enabled for that group
//   GET    /api/admin/groups/:id/apps      [{id, app_id, name, icon}] in order
const express = require('express');

//   GET    /api/admin/apps/activation      {config: {tokens, accountNumber}, results: [per set]}
//   PUT    /api/admin/apps/activation      {tokens: [{id, token}], accountNumber}
//   POST   /api/admin/apps/activation/run  {group_id? | set_ids?} → queues register_apps on the sets
function createAppsRouter({ db, hub, apps, commands, log = () => {} }) {
  const r = express.Router();
  const qGroup = db.prepare('SELECT id, name FROM groups WHERE id = ? AND tenant_id = ?');
  const qSets = db.prepare('SELECT * FROM sets WHERE tenant_id = ? ORDER BY id');
  const qGroupSets = db.prepare('SELECT * FROM sets WHERE tenant_id = ? AND group_id = ? ORDER BY id');

  r.get('/apps', (req, res) => res.json(apps.list(req.tenant)));
  r.get('/apps/activation', (req, res) => res.json({ config: apps.activationConfig(req.tenant), results: apps.activationResults(req.tenant) }));
  r.put('/apps/activation', (req, res) => {
    const b = req.body || {};
    const cfg = apps.setActivationConfig(req.tenant, { accountNumber: b.accountNumber || '' });
    log(`admin ${req.user.username}: app activation config for ${req.tenant.name}: account number ${cfg.accountNumber ? 'set' : 'cleared'}`);
    res.json({ config: cfg });
  });
  r.post('/apps/activation/run', (req, res) => {
    const payload = apps.registerPayload(req.tenant);
    if (!payload) return res.status(400).json({ error: 'no licence tokens on file (superadmin → App licences) and no account number' });
    const b = req.body || {};
    let sets;
    if (b.group_id) { const g = qGroup.get(Number(b.group_id), req.tenant.id); if (!g) return res.status(404).json({ error: 'group not found' }); sets = qGroupSets.all(req.tenant.id, g.id); }
    else if (Array.isArray(b.set_ids)) sets = qSets.all(req.tenant.id).filter((s) => b.set_ids.map(Number).includes(s.id));
    else sets = qSets.all(req.tenant.id);
    const ids = sets.map((s) => commands.queue(req.tenant, s, 'register_apps', payload, { dedupe: true }).id);
    log(`admin ${req.user.username}: register_apps queued for ${ids.length} set(s) of ${req.tenant.name}`);
    res.json({ queued: ids.length, command_ids: ids });
  });
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
