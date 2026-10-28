// Браузерная версия API: те же обработчики, что и на Node.js-сервере (src/routes/api.js),
// но запросы выполняются к файлу базы data/esports.db прямо в браузере (sql.js).
// Собирается командой `npm run build:static` в assets/js/static-api.js.
'use strict';
const apiRoutes = require('../routes/api');

// Обёртка sql.js с интерфейсом better-sqlite3 (только то, что нужно для чтения)
function wrapDb(sdb) {
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  const prepare = (sql) => ({
    all: (...p) => { const st = sdb.prepare(sql); try { st.bind(norm(p)); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); } },
    get: (...p) => { const st = sdb.prepare(sql); try { st.bind(norm(p)); return st.step() ? st.getAsObject() : undefined; } finally { st.free(); } },
    run: (...p) => { sdb.run(sql, norm(p)); return { changes: sdb.getRowsModified(), lastInsertRowid: 0 }; },
  });
  return { prepare, exec: (s) => sdb.exec(s), pragma: () => [], transaction: (fn) => (...a) => fn(...a) };
}

function createStaticApi(SQL, bytes) {
  const router = apiRoutes(wrapDb(new SQL.Database(bytes)));
  return function handle(path) {
    const u = new URL(path, 'http://x');
    const query = Object.fromEntries(u.searchParams);
    return router.dispatch(decodeURIComponent(u.pathname), query);
  };
}
module.exports = { createStaticApi };
