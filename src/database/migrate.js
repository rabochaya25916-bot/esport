const { openDb } = require('./db');
const cfg = require('../config');
openDb(cfg.dbPath).close();
console.log('Migrations applied to', cfg.dbPath);
