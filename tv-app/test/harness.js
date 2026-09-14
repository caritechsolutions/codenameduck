'use strict';
// Starts the real server in-process (in-memory DB, temp tenant dir whose hostname is 127.0.0.1
// so tenant resolution works on a bare port) and serves tv-app/dist under /procentric/application
// the way nginx does on the VM. Returns helpers for tests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const serverRoot = path.resolve(__dirname, '..', '..', 'server');
const { openDb, migrate } = require(path.join(serverRoot, 'src/db'));
const { createServer } = require(path.join(serverRoot, 'src/app'));

const DIST = path.resolve(__dirname, '..', 'dist');

async function startStack(opts = {}) {
  if (!fs.existsSync(path.join(DIST, 'app.js'))) throw new Error('tv-app/dist missing — run npm run build first');
  const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-'));
  const appDir = path.join(tenantsDir, 'e2e', 'procentric', 'application');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'xait.xml'), '<XAIT><url>http://127.0.0.1/procentric/application/index.html</url></XAIT>');
  const db = openDb(':memory:');
  migrate(db);
  const logs = [];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-data-'));
  const srv = createServer({ db, tenantsDir, adminDist: opts.adminDist || null, dataDir, pollIntervalS: 15, log: (m) => logs.push(m) });
  srv.app.use('/procentric/application', express.static(DIST, { etag: false, cacheControl: false }));
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  const port = srv.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const api = (method, p, body, cookie) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let json = null; try { json = t ? JSON.parse(t) : null; } catch { /* binary or text body */ } resolve({ status: res.statusCode, json, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  const login = async () => (await api('POST', '/api/admin/login', { username: 'admin', password: srv.seeded.password })).cookie;
  const close = () => { srv.hub.closeAll(); return new Promise((r) => srv.server.close(r)); };
  return { ...srv, db, port, base, api, login, logs, close, dataDir, url: base + '/procentric/application/index.html', adminUrl: base + '/admin/' };
}

// Playwright is a dev tool that may not be installed on the VM; tests skip when it is missing.
async function launchChromium() {
  let pw;
  try { pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
  catch { try { pw = require('/opt/node22/lib/node_modules/playwright'); } catch { return null; } }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
  try {
    return await pw.chromium.launch({ env, args: ['--no-proxy-server'] });
  } catch (e) { console.log('# chromium unavailable: ' + e.message.split('\n')[0]); return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startStack, launchChromium, sleep, DIST };
