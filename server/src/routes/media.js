'use strict';
// Media library API (Phase 3 B1): list / upload / rename / delete per tenant.
//   GET    /api/admin/media               → [{id, name, kind, url, thumb_url, width, height, bytes, ...}]
//   POST   /api/admin/media[?as=logo]     raw body (Content-Type image/* | video/mp4, X-Filename)
//                                         or JSON {data_url, name}; ?as=logo also sets settings.logo_url
//   PATCH  /api/admin/media/:id           {name}
//   GET    /api/admin/media/:id/references → {layouts: [{id,name}], logo}
//   DELETE /api/admin/media/:id           409 {error, layouts, logo} when a layout or the logo uses it
const express = require('express');
const { decodeMediaUpload, MAX_BYTES } = require('../media');

function createMediaRouter({ db, hub, media, log = () => {} }) {
  const r = express.Router();
  const rawBody = express.raw({ type: ['image/*', 'video/mp4', 'application/octet-stream'], limit: MAX_BYTES + 1024 });
  const parseSettings = (t) => { try { return JSON.parse(t.settings_json || '{}') || {}; } catch { return {}; } };

  r.get('/media', (req, res) => res.json(media.list(req.tenant)));
  r.post('/media', rawBody, async (req, res) => {
    const up = decodeMediaUpload(req);
    if (up.error) return res.status(400).json({ error: up.error });
    try {
      const out = await media.save(req.tenant, up);
      if (String(req.query.as || '') === 'logo') {
        if (out.kind !== 'image') { media.remove(req.tenant, out.id, { force: true }); return res.status(400).json({ error: 'the logo must be an image' }); }
        const t = db.prepare('SELECT * FROM tenants WHERE id = ?').get(req.tenant.id);
        const cur = parseSettings(t); cur.logo_url = out.url;
        db.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').run(JSON.stringify(cur), req.tenant.id);
        hub.refresh(req.tenant.id, { force: true });
      }
      log(`admin ${req.user.username}: media "${out.name}" (${out.kind} ${out.bytes} bytes${out.width ? ` ${out.width}x${out.height}` : ''}) for ${req.tenant.name}`);
      res.status(201).json(out);
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      log(`media upload failed for ${req.tenant.name}: ${e.stack || e}`);
      res.status(500).json({ error: 'upload failed' });
    }
  });
  r.patch('/media/:id', (req, res) => {
    try {
      const out = media.rename(req.tenant, req.params.id, (req.body || {}).name);
      if (!out) return res.status(404).json({ error: 'media not found' });
      res.json(out);
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  r.get('/media/:id/references', (req, res) => {
    if (!media.get(req.tenant, req.params.id)) return res.status(404).json({ error: 'media not found' });
    res.json(media.references(req.tenant, req.params.id));
  });
  r.delete('/media/:id', (req, res) => {
    const out = media.remove(req.tenant, req.params.id);
    if (!out.ok) return res.status(out.status).json({ error: out.error, layouts: out.layouts || [], logo: !!out.logo });
    log(`admin ${req.user.username}: media ${req.params.id} deleted for ${req.tenant.name}`);
    res.json({ ok: true });
  });
  return r;
}

module.exports = { createMediaRouter };
