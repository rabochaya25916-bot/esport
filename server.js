const path = require('path');
const express = require('express');
const compression = require('compression');
const cfg = require('./src/config');
const { openDb } = require('./src/database/db');
const api = require('./src/routes/api');
const adminApi = require('./src/routes/admin-api');
const { makeSeo } = require('./src/seo');
const { startScheduler } = require('./src/scheduler');
const { bootstrapAdminFromEnv } = require('./src/admin/bootstrap');

// Политика безопасности содержимого: скрипты только с этого сайта, без inline-скриптов и eval
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "frame-src https://player.twitch.tv https://clips.twitch.tv",
].join('; ');

function createApp(db, opts = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', /^\d+$/.test(cfg.trustProxy) ? Number(cfg.trustProxy) : cfg.trustProxy);
  app.use(compression());
  app.use((req, res, next) => {
    res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    next();
  });

  // Публичный API: браузер перепроверяет ответ по ETag (304 без тела, если данные не изменились)
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    // Сайт на другом домене (файловый хостинг) — только из списка CORS_ORIGINS. Cookie между доменами не передаются:
    // админ-панель там работает по токену в заголовке Authorization.
    const o = req.get('origin'); const allowed = opts.corsOrigins ?? cfg.corsOrigins;
    if (o && allowed.includes(o)) {
      res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Expose-Headers': 'X-Total-Count' });
      if (req.method === 'OPTIONS') {
        return res.set({ 'Access-Control-Allow-Methods': req.path.startsWith('/admin') ? 'GET, POST, PUT, DELETE' : 'GET',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token', 'Access-Control-Max-Age': '600' }).sendStatus(204);
      }
    }
    next();
  });
  app.use('/api/admin', adminApi(db, opts));
  app.use('/api', api(db));

  app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '1h' }));
  app.use('/uploads', (req, res, next) => { res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"); next(); },
    express.static(opts.uploadsDir || cfg.uploadsDir, { maxAge: '7d', index: false, dotfiles: 'deny' }));
  app.get('/favicon.svg', (req, res) => res.sendFile(path.join(__dirname, 'favicon.svg'), { maxAge: '7d' }));

  const seo = makeSeo(db, { indexPath: path.join(__dirname, 'index.html') });
  app.get('/robots.txt', seo.robots);
  app.get('/sitemap.xml', (req, res, next) => seo.sitemap(req, res).catch(next));
  app.get('/index.html', (req, res) => res.redirect(301, '/'));
  // SPA: index.html лежит в корне проекта; сервер подставляет мета-теги страницы и код 404 для несуществующих адресов
  app.get('*', (req, res) => (path.extname(req.path) ? res.status(404).type('text').send('Не найдено') : seo.render(req, res).catch((e) => { console.error(e); res.status(500).type('text').send('Ошибка'); })));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Неверный JSON' });
    console.error(err); res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });
  return app;
}

if (require.main === module) {
  const db = openDb(cfg.dbPath);
  bootstrapAdminFromEnv(db).catch((e) => console.error('Администратор не создан:', e.message));
  createApp(db).listen(cfg.port, () => console.log(`CyberLeague: http://localhost:${cfg.port}`));
  startScheduler(db);
}
module.exports = { createApp };
