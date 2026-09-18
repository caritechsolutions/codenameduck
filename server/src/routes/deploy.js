'use strict';
// Part D admin routes (under /api/admin):
//   GET  /deployment          mode, bundle status, pending sets
//   GET  /deployment/diff     dry run: what a publish would change
//   POST /deployment/publish  build app.zip (+ state.json, bundle.json), bump when content changed
//   PUT  /deployment/mode     {mode: run|deploy}
const express = require('express');

function createDeployRouter({ bundler, log = () => {} }) {
  const r = express.Router();
  const send = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  r.get('/deployment', (req, res) => send(res, () => bundler.status(req.tenant)));
  r.get('/deployment/diff', (req, res) => send(res, () => bundler.diff(req.tenant)));
  r.post('/deployment/publish', (req, res) => send(res, () => { const out = bundler.publish(req.tenant, { force: !!(req.body && req.body.force), by: req.user.username }); return { ...out, status: bundler.status(req.tenant) }; }));
  r.put('/deployment/mode', (req, res) => send(res, () => { const out = bundler.changeMode(req.tenant, (req.body || {}).mode, { by: req.user.username }); log(`admin ${req.user.username}: ${req.tenant.name} deployment mode → ${out.mode}`); return { ...out, status: bundler.status(req.tenant) }; }));
  return r;
}

module.exports = { createDeployRouter };
