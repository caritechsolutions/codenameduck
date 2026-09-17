'use strict';
// App licence tokens (superadmin only, global for all tenants).
//   GET    /api/admin/licences            [{id, app_id, filename, tail, uploaded_at}]
//   POST   /api/admin/licences            {files: [{filename, content, app_id?}]} → {added, replaced, errors, licences}
//   PATCH  /api/admin/licences/:id        {app_id}
//   DELETE /api/admin/licences/:id
const express = require('express');

function createLicencesRouter({ auth, licences, hub, db, log = () => {} }) {
  const r = express.Router();
  const refreshAll = () => { for (const t of db.prepare('SELECT id FROM tenants').all()) hub.refresh(t.id); };
  r.get('/licences', auth.requireSuperadmin, (_req, res) => res.json({ licences: licences.list(), known_ids: licences.KNOWN_IDS }));
  r.post('/licences', auth.requireSuperadmin, (req, res) => {
    const files = Array.isArray((req.body || {}).files) ? req.body.files.slice(0, 20) : null;
    if (!files || !files.length) return res.status(400).json({ error: 'files must be a non-empty array of {filename, content}' });
    const out = { added: [], replaced: [], errors: [] };
    for (const f of files) {
      if (!f || typeof f !== 'object') { out.errors.push('bad entry'); continue; }
      const r2 = licences.put({ filename: f.filename, content: f.content, app_id: f.app_id });
      if (r2.error) { out.errors.push(r2.error.message); continue; }
      (r2.replaced ? out.replaced : out.added).push(r2.row);
    }
    log(`superadmin ${req.user.username}: licences added ${out.added.map((x) => x.app_id).join(',') || '-'} replaced ${out.replaced.map((x) => x.app_id).join(',') || '-'}${out.errors.length ? ' errors ' + out.errors.length : ''}`);
    if (out.added.length || out.replaced.length) refreshAll();
    res.status(out.errors.length && !out.added.length && !out.replaced.length ? 400 : 200).json({ ...out, licences: licences.list() });
  });
  r.patch('/licences/:id', auth.requireSuperadmin, (req, res) => {
    try {
      const row = licences.setAppId(req.params.id, (req.body || {}).app_id);
      if (!row) return res.status(404).json({ error: 'licence not found' });
      refreshAll();
      res.json(row);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  r.delete('/licences/:id', auth.requireSuperadmin, (req, res) => {
    if (!licences.remove(req.params.id)) return res.status(404).json({ error: 'licence not found' });
    log(`superadmin ${req.user.username}: licence ${req.params.id} deleted`);
    refreshAll();
    res.json({ ok: true });
  });
  return r;
}

module.exports = { createLicencesRouter };
