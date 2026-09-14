'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { openDb, migrate } = require('../src/db');
const { createServer } = require('../src/app');

function makeTenantsDir(extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-tenants-'));
  for (const [name, host] of [['hoteldemo', 'hoteldemo.caritech.net'], ...extra]) addTenantDir(dir, name, host);
  return dir;
}
function addTenantDir(dir, name, host) {
  const app = path.join(dir, name, 'procentric', 'application');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'xait.xml'), `<XAIT><versionNumber>0</versionNumber><url>http://${host}/procentric/application/index.html</url></XAIT>`);
}

// Node's fetch drops a caller-supplied Host header, so use plain http.
function httpJson(base, method, url, { host = 'hoteldemo.caritech.net', body, raw, cookie, headers = {} } = {}) {
  const u = new URL(base + url);
  const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { Host: host, 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.8.7',
        ...(cookie ? { Cookie: cookie } : {}), ...headers,
        ...(payload !== undefined ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function startServer(opts = {}) {
  const tenantsDir = opts.tenantsDir || makeTenantsDir(opts.extraTenants);
  const db = openDb(':memory:');
  migrate(db);
  const logs = [];
  const srv = createServer({ db, tenantsDir, adminDist: opts.adminDist || null, dataDir: opts.dataDir || null, pollIntervalS: 30, log: (m) => logs.push(m) });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const port = srv.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = (method, url, o) => httpJson(base, method, url, o);
  const close = () => { srv.hub.closeAll(); return new Promise((r) => srv.server.close(r)); };

  async function login(username = 'admin', password = srv.seeded.password, host) {
    const r = await call('POST', '/api/admin/login', { body: { username, password }, host });
    const cookie = (r.headers['set-cookie'] || [])[0]?.split(';')[0];
    return { ...r, cookie };
  }
  async function registerSet(serial = 'S1', extra = {}, host) {
    return call('POST', '/api/tv/register', { body: { serial_number: serial, api: 'idcap', model_name: '43UM670H0UA', ...extra }, host });
  }
  return { ...srv, db, tenantsDir, port, base, call, logs, close, login, registerSet };
}

module.exports = { makeTenantsDir, addTenantDir, httpJson, startServer };
