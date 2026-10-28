const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(__dirname, '..', '..', 'migrations');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  // Миграции лежат в migrations/NNN_name.js (module.exports = SQL). Имя в журнале — NNN_name.sql, как на этапах 1–4.
  const files = fs.readdirSync(dir).filter((f) => /\.(sql|js)$/.test(f));
  const byName = new Map();
  for (const f of files) { const name = f.replace(/\.(sql|js)$/, '.sql'); if (!byName.has(name) || f.endsWith('.sql')) byName.set(name, f); }
  for (const name of [...byName.keys()].sort()) {
    if (done.has(name)) continue;
    const f = byName.get(name); const file = path.join(dir, f);
    const sql = f.endsWith('.js') ? require(file) : fs.readFileSync(file, 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }
}
module.exports = { openDb, migrate };
