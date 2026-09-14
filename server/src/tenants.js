'use strict';
// Tenant registry. The filesystem (one directory per tenant under tenantsDir, each with
// procentric/application/xait.xml) is the source of truth for now — coopcentric-tenant
// creates it. We mirror it into the tenants table on startup and lazily whenever an unknown
// Host arrives, so a freshly created tenant works without a service restart.
const fs = require('fs');
const path = require('path');

const RESCAN_MIN_MS = 5000;

function hostnameFromXait(xaitPath) {
  let xml;
  try { xml = fs.readFileSync(xaitPath, 'utf8'); } catch { return null; }
  const m = xml.match(/<url>\s*https?:\/\/([^/:<\s]+)/i);
  return m ? m[1].toLowerCase() : null;
}

function scanTenantsDir(tenantsDir) {
  let entries = [];
  try { entries = fs.readdirSync(tenantsDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hostname = hostnameFromXait(path.join(tenantsDir, e.name, 'procentric', 'application', 'xait.xml'));
    if (hostname) out.push({ name: e.name, hostname });
  }
  return out;
}

function syncTenantsFromDisk(db, tenantsDir, log = () => {}) {
  const found = scanTenantsDir(tenantsDir);
  const upsert = db.prepare(`INSERT INTO tenants (name, hostname, display_name) VALUES (@name, @hostname, @name)
    ON CONFLICT(name) DO UPDATE SET hostname = excluded.hostname WHERE hostname <> excluded.hostname`);
  const tx = db.transaction((rows) => {
    let changed = 0;
    for (const r of rows) {
      try { changed += upsert.run(r).changes; }
      catch (err) { log(`tenant ${r.name} (${r.hostname}) not synced: ${err.message}`); }
    }
    return changed;
  });
  const changed = tx(found);
  if (changed) log(`tenant registry updated from ${tenantsDir}: ${changed} row(s) changed`);
  return found;
}

function normalizeHost(hostHeader) {
  if (!hostHeader) return null;
  let h = String(hostHeader).trim().toLowerCase();
  if (h.startsWith('[')) h = h.slice(0, h.indexOf(']') + 1); // IPv6 literal
  else h = h.replace(/:\d+$/, '');
  return h || null;
}

function createTenantResolver(db, tenantsDir, log = () => {}) {
  const byHost = db.prepare('SELECT * FROM tenants WHERE hostname = ?');
  let lastScan = 0;

  function resolve(hostHeader) {
    const host = normalizeHost(hostHeader);
    if (!host) return null;
    let t = byHost.get(host);
    if (!t && Date.now() - lastScan > RESCAN_MIN_MS) {
      lastScan = Date.now();
      syncTenantsFromDisk(db, tenantsDir, log);
      t = byHost.get(host);
    }
    return t || null;
  }

  function middleware(req, res, next) {
    const tenant = resolve(req.headers.host);
    if (!tenant) {
      return res.status(404).json({ error: 'unknown tenant', host: normalizeHost(req.headers.host) });
    }
    req.tenant = tenant;
    next();
  }

  return { resolve, middleware };
}

module.exports = { hostnameFromXait, scanTenantsDir, syncTenantsFromDisk, normalizeHost, createTenantResolver };
