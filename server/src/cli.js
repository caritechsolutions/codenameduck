#!/usr/bin/env node
'use strict';
// coopcentric server CLI (called by bin/coopcentric-tenant):
//   node cli.js bundle <name>|--all [--force]   build/publish a tenant's app.zip
//   node cli.js mode <name> run|deploy           switch deployment mode (rewrites xait.xml)
//   node cli.js status [<name>]                  deployment status
const config = require('./config');
const { openDb, migrate } = require('./db');
const { createBundler } = require('./bundle');
const { createStateBuilder } = require('./state');
const { createAppStore } = require('./apps');
const { createLicenceStore } = require('./licences');
const { createPms } = require('./pms');

function main(argv) {
  const [cmd, ...args] = argv;
  const db = openDb(config.dbPath);
  db.pragma('busy_timeout = 5000');   // the service may be running
  migrate(db);
  const log = (m) => console.log(`[coopcentric-bundle] ${m}`);
  const licences = createLicenceStore(db, { dataDir: config.dataDir, log });
  const apps = createAppStore(db, { log, licences });
  const pms = createPms(db, { log });
  const state = createStateBuilder(db, { apps, pms });
  const bundler = createBundler({ db, tenantsDir: config.tenantsDir, apps, state, log });
  const tenant = (name) => { const t = db.prepare('SELECT * FROM tenants WHERE name = ?').get(name); if (!t) { console.error(`no such tenant in the database: ${name}`); process.exit(1); } return t; };
  const fmt = (o) => console.log(JSON.stringify(o, null, 2));
  switch (cmd) {
    case 'bundle': {
      const force = args.includes('--force');
      const names = args.includes('--all') ? db.prepare('SELECT name FROM tenants ORDER BY name').all().map((t) => t.name) : args.filter((a) => !a.startsWith('--'));
      if (!names.length) { console.error('usage: cli.js bundle <name>|--all [--force]'); process.exit(2); }
      for (const n of names) { const t = tenant(n); if (!args.includes('--all') || t.deploy_mode === 'deploy' || force) { const r = bundler.publish(t, { force, by: 'cli' }); log(`${n}: v${r.version} ${r.bumped ? 'published' : 'refreshed'} (${r.files} files)`); } else log(`${n}: remote-run mode, skipped (use --force to build anyway)`); }
      break;
    }
    case 'mode': {
      const [name, mode] = args;
      if (!name || !mode) { console.error('usage: cli.js mode <name> run|deploy'); process.exit(2); }
      fmt(bundler.changeMode(tenant(name), mode, { by: 'cli' }));
      break;
    }
    case 'status': {
      const names = args.length ? args : db.prepare('SELECT name FROM tenants ORDER BY name').all().map((t) => t.name);
      for (const n of names) fmt({ tenant: n, ...bundler.status(tenant(n)) });
      break;
    }
    default: console.error('usage: cli.js bundle <name>|--all [--force] | mode <name> run|deploy | status [<name>]'); process.exit(2);
  }
  db.close();
}
main(process.argv.slice(2));
