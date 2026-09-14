'use strict';
const config = require('./config');
const { openDb, migrate } = require('./db');
const { createServer } = require('./app');

const log = (msg) => console.log(msg);

const db = openDb(config.dbPath);
const applied = migrate(db, (m) => log(`${new Date().toISOString()} ${m}`));
log(`${new Date().toISOString()} database ${config.dbPath} ready (${applied} migration(s) applied)`);

const { server, hub } = createServer({ db, tenantsDir: config.tenantsDir, adminDist: config.adminDist, dataDir: config.dataDir, pollIntervalS: config.pollIntervalS, log });
server.listen(config.port, config.host, () => {
  log(`${new Date().toISOString()} coopcentric server listening on http://${config.host}:${config.port} (tenants: ${config.tenantsDir}, admin: ${config.adminDist})`);
});

function shutdown(sig) {
  log(`${new Date().toISOString()} ${sig} received, shutting down`);
  hub.closeAll();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
