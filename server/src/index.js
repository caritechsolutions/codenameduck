'use strict';
const config = require('./config');
const { openDb, migrate } = require('./db');
const { createApp } = require('./app');

const log = (msg) => console.log(msg);

const db = openDb(config.dbPath);
const applied = migrate(db, (m) => log(`${new Date().toISOString()} ${m}`));
log(`${new Date().toISOString()} database ${config.dbPath} ready (${applied} migration(s) applied)`);

const app = createApp({ db, tenantsDir: config.tenantsDir, adminDist: config.adminDist, pollIntervalS: config.pollIntervalS, log });
const server = app.listen(config.port, config.host, () => {
  log(`${new Date().toISOString()} coopcentric server listening on http://${config.host}:${config.port} (tenants: ${config.tenantsDir})`);
});

function shutdown(sig) {
  log(`${new Date().toISOString()} ${sig} received, shutting down`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
