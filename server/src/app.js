'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createTenantResolver, syncTenantsFromDisk } = require('./tenants');
const { createTvRouter } = require('./routes/tv');
const { createAdminRouter } = require('./routes/admin');
const { createAuth, seedSuperadmin } = require('./auth');
const { createStateBuilder } = require('./state');
const { createHub } = require('./ws');
const { createCommands } = require('./commands');
const { createChannelsRouter } = require('./routes/channels');
const { createScreenshotStore } = require('./screenshots');
const { createTenantRouter, defaultTenantCommand } = require('./routes/tenant');
const { createAssetStore } = require('./assets');
const { createMediaStore } = require('./media');
const { createMediaRouter } = require('./routes/media');
const { createWeather } = require('./weather');

function timestamp() { return new Date().toISOString(); }

// Builds the Express app + HTTP server + WebSocket hub. Returns { app, server, hub, ... }.
// Tests call this with an in-memory DB and a temp tenants dir.
function createServer({ db, tenantsDir, adminDist, dataDir = null, pollIntervalS = 60, log = console.log, weatherFetch = undefined, tenantCommand = defaultTenantCommand }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.set('etag', false);

  const logger = (msg) => log(`${timestamp()} ${msg}`);
  app.use((req, _res, next) => { req.log = logger; next(); });

  syncTenantsFromDisk(db, tenantsDir, logger);
  const tenants = createTenantResolver(db, tenantsDir, logger);
  const state = createStateBuilder(db, { pollIntervalS });
  const auth = createAuth(db);
  const hub = createHub({ db, tenants, state, log: logger });
  const commands = createCommands(db, hub, logger);
  hub.setCommands(commands);
  app.locals.state = state;
  const screenshots = dataDir ? createScreenshotStore(path.join(dataDir, 'screenshots')) : null;
  const assets = createAssetStore(tenantsDir);
  const media = createMediaStore(db, tenantsDir, { log: logger });
  const weather = createWeather({ fetcher: weatherFetch, log: logger });

  const seeded = seedSuperadmin(db);
  if (seeded) {
    logger('==========================================================================');
    logger(`INITIAL SUPERADMIN CREATED  username: ${seeded.username}  password: ${seeded.password}`);
    logger('Log in at http://<tenant-hostname>/admin and change it under Users. Shown once.');
    logger('==========================================================================');
  }

  app.get('/healthz', (_req, res) => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n;
    res.json({ ok: true, tenants: n, ws: hub.size, time: timestamp() });
  });

  app.use(express.json({ limit: '1mb' }));

  app.use('/api', tenants.middleware);
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/tv', createTvRouter({ db, state, commands, hub, screenshots, weather, log: logger }));
  const admin = createAdminRouter({ db, auth, hub, commands, screenshots, log: logger });
  admin.use(createChannelsRouter({ db, hub, log: logger }));
  admin.use(createTenantRouter({ db, hub, commands, assets, weather, tenantsDir, auth, tenantCommand, log: logger }));
  admin.use(createMediaRouter({ db, hub, media, log: logger }));
  app.use('/api/admin', admin);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  // Admin UI: built Vite bundle when present, placeholder until then.
  app.use('/admin', tenants.middleware);
  if (adminDist && fs.existsSync(path.join(adminDist, 'index.html'))) {
    app.use('/admin', express.static(adminDist, { index: 'index.html', maxAge: '1h', setHeaders(res, p) { if (p.endsWith('index.html')) res.set('Cache-Control', 'no-store'); } }));
    app.get('/admin/*', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(adminDist, 'index.html')); });
  } else {
    app.get(['/admin', '/admin/*'], (req, res) => {
      res.type('html').send(`<!doctype html><meta charset="utf-8"><title>CoopCentric admin</title>
<body style="font-family:sans-serif;background:#0b1a2a;color:#f2f2f2;padding:40px"><h1>CoopCentric admin</h1>
<p>Tenant <b>${escapeHtml(req.tenant.display_name)}</b> (${escapeHtml(req.tenant.hostname)})</p>
<p>The admin UI bundle is not built. Run install.sh (it builds admin/).</p></body>`);
    });
  }

  app.use((err, req, res, _next) => { // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload too large' });
    logger(`ERROR ${req.method} ${req.originalUrl}: ${err.stack || err}`);
    res.status(500).json({ error: 'internal error' });
  });

  const server = http.createServer(app);
  hub.attach(server);
  const expireTimer = setInterval(() => { try { commands.expire(); } catch { /* ignore */ } }, 3600000);
  expireTimer.unref();

  return { app, server, hub, commands, state, auth, tenants, assets, media, weather, seeded, log: logger };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Back-compat for step-1 tests.
function createApp(opts) { return createServer(opts).app; }

module.exports = { createServer, createApp };
