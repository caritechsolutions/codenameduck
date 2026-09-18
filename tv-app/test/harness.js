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
  if (!fs.existsSync(DIST) || !fs.readdirSync(DIST).some((f) => /^app\.[0-9a-f]+\.js$/.test(f))) throw new Error('tv-app/dist missing — run npm run build first');
  const tenantsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-'));
  const appDir = path.join(tenantsDir, 'e2e', 'procentric', 'application');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'xait.xml'), '<XAIT><url>http://127.0.0.1/procentric/application/index.html</url></XAIT>');
  const db = openDb(':memory:');
  migrate(db);
  const logs = [];
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-e2e-data-'));
  let port = 0;
  // Part D: serveTenantDir copies dist into the tenant's application dir (as coopcentric-tenant
  // deploy does) and serves that, so app.zip / state.json / bundle.json written by a publish are
  // visible to the page; publicHost bakes the test port into state.json's tenant_host.
  const serveDir = opts.serveTenantDir ? appDir : DIST;
  if (opts.serveTenantDir) fs.cpSync(DIST, appDir, { recursive: true });
  const srv = createServer({ db, tenantsDir, adminDist: opts.adminDist || null, dataDir, pollIntervalS: 15, log: (m) => logs.push(m), weatherFetch: opts.weatherFetch, tenantCommand: opts.tenantCommand,
    publicHost: () => `127.0.0.1:${port}` });
  let offline = false;   // simulate an unreachable server: TV API + WS sockets are dropped
  srv.app.use((req, res, next) => { if (offline && (req.path.startsWith('/api/') || req.path.startsWith('/ws/'))) { req.socket.destroy(); return; } next(); });
  srv.app._router.stack.splice(2, 0, srv.app._router.stack.pop());   // after express's query/init layers, before the API routers createServer mounted
  srv.app.use('/procentric/application', express.static(serveDir, { etag: false, cacheControl: false }));
  srv.app.use('/fixtures', express.static(path.join(__dirname, 'fixtures'), { etag: false, cacheControl: false }));
  const upgraders = srv.server.listeners('upgrade'); srv.server.removeAllListeners('upgrade');
  srv.server.on('upgrade', (req, sock, head) => { if (offline) { sock.destroy(); return; } upgraders.forEach((l) => l(req, sock, head)); });
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  port = srv.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const setOffline = (v) => { offline = !!v; if (offline) srv.hub.dropAll(); };
  // A second origin serving the same files, like the TV's local storage in remote-deploy mode.
  async function startOtherOrigin() {
    const app2 = express();
    app2.use('/procentric/application', express.static(serveDir, { etag: false, cacheControl: false }));
    const s2 = http.createServer(app2);
    await new Promise((r) => s2.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${s2.address().port}/procentric/application/index.html`, close: () => new Promise((r) => s2.close(r)) };
  }
  const api = (method, p, body, cookie) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let json = null; try { json = t ? JSON.parse(t) : null; } catch { /* binary or text body */ } resolve({ status: res.statusCode, json, text: t, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  const login = async () => (await api('POST', '/api/admin/login', { username: 'admin', password: srv.seeded.password })).cookie;
  const close = () => { srv.hub.closeAll(); return new Promise((r) => srv.server.close(r)); };
  return { ...srv, db, port, base, api, login, logs, close, dataDir, appDir, setOffline, startOtherOrigin, url: base + '/procentric/application/index.html', adminUrl: base + '/admin/' };
}

// Playwright is a dev tool that may not be installed on the VM; tests skip when it is missing.
async function launchChromium() {
  let pw;
  try { pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
  catch { try { pw = require('/opt/node22/lib/node_modules/playwright'); } catch { return null; } }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
  try {
    return await pw.chromium.launch({ env, args: ['--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
  } catch (e) { console.log('# chromium unavailable: ' + e.message.split('\n')[0]); return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startStack, launchChromium, sleep, DIST };
