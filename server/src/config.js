'use strict';
const path = require('path');

const dataDir = process.env.COOPCENTRIC_DATA || '/srv/coopcentric/data';

module.exports = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  dataDir,
  dbPath: process.env.COOPCENTRIC_DB || path.join(dataDir, 'coopcentric.db'),
  tenantsDir: process.env.COOPCENTRIC_TENANTS || '/srv/coopcentric/tenants',
  adminDist: process.env.COOPCENTRIC_ADMIN_DIST || path.resolve(__dirname, '..', '..', 'admin', 'dist'),
  pollIntervalS: Number(process.env.COOPCENTRIC_POLL_INTERVAL_S || 60),
};
