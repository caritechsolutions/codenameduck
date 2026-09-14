'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createTenantResolver, syncTenantsFromDisk } = require('./tenants');
const { createTvRouter } = require('./routes/tv');

function timestamp() { return new Date().toISOString(); }

function createApp({ db, tenantsDir, adminDist, pollIntervalS = 60, log = console.log }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.set('etag', false);

  const logger = (msg) => log(`${timestamp()} ${msg}`);
  app.use((req, _res, next) => { req.log = logger; next(); });

  syncTenantsFromDisk(db, tenantsDir, logger);
  const tenants = createTenantResolver(db, tenantsDir, logger);

  // Liveness for systemd/curl; not tenant-scoped.
  app.get('/healthz', (_req, res) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n;
    res.json({ ok: true, tenants: n, time: timestamp() });
  });

  app.use(express.json({ limit: '64kb' }));

  app.use('/api', tenants.middleware);
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/tv', createTvRouter({ db, pollIntervalS }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // Admin UI: built Vite bundle when present (step 2), placeholder until then.
  app.use('/admin', tenants.middleware);
  if (adminDist && fs.existsSync(path.join(adminDist, 'index.html'))) {
    app.use('/admin', express.static(adminDist, { index: 'index.html' }));
    app.get('/admin/*', (_req, res) => res.sendFile(path.join(adminDist, 'index.html')));
  } else {
    app.get(['/admin', '/admin/*'], (req, res) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM sets WHERE tenant_id = ?').get(req.tenant.id).n;
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>CoopCentric admin</title>
<body style="font-family:sans-serif;background:#0b1a2a;color:#f2f2f2;padding:40px">
<h1>CoopCentric admin</h1><p>Tenant <b>${escapeHtml(req.tenant.display_name)}</b> (${escapeHtml(req.tenant.hostname)})</p>
<p>${n} set(s) registered. The admin UI arrives in Phase 2 step 2.</p></body>`);
    });
  }

  app.use((err, req, res, _next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    logger(`ERROR ${req.method} ${req.originalUrl}: ${err.stack || err}`);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { createApp };
