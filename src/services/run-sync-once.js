const cfg = require('../config');
const { openDb } = require('../database/db');
const { runSync } = require('./sync');
(async () => { const db = openDb(cfg.dbPath); console.log(await runSync(db)); db.close(); })();
