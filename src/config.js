require('dotenv').config();
const path = require('path');
const e = process.env;
module.exports = {
  port: Number(e.PORT || 3000),
  dbPath: path.resolve(e.DB_PATH || path.join(__dirname, '..', 'data', 'esports.db')),
  syncCron: e.SYNC_CRON || '*/10 * * * *',
  syncOnStart: (e.SYNC_ON_START || 'true') === 'true',
  requestDelayMs: Number(e.REQUEST_DELAY_MS || 2500),
  requestTimeoutMs: Number(e.REQUEST_TIMEOUT_MS || 20000),
  userAgent: e.USER_AGENT || 'EsportsHubBot/0.1',
  sourceBase: (e.SOURCE_BASE_URL || 'https://bo3.gg').replace(/\/$/, ''),
};
// Этап 2: сколько страниц матчей разбирать подробно за один цикл и сколько раз перепроверять завершённый матч
module.exports.detailLimit = Number(process.env.DETAIL_LIMIT || 20);
module.exports.detailMaxAttempts = Number(process.env.DETAIL_MAX_ATTEMPTS || 6);
// Этап 3: обход профилей команд/игроков/турниров
module.exports.profileLimit = Number(process.env.PROFILE_LIMIT || 12);          // страниц каждого вида за цикл
module.exports.profileTtlHours = Number(process.env.PROFILE_TTL_HOURS || 24);   // через сколько часов профиль обновляется повторно
module.exports.profileMaxAttempts = Number(process.env.PROFILE_MAX_ATTEMPTS || 5);
// Этап 4: сайт, обновления, администратор
const bool = (v, d) => (v == null || v === '' ? d : v === 'true' ? true : v === 'false' ? false : v);
module.exports.siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');                       // публичный адрес для canonical и sitemap
module.exports.siteName = process.env.SITE_NAME || 'CyberLeague';
module.exports.liveSyncCron = process.env.LIVE_SYNC_CRON ?? '*/3 * * * *';                       // частая проверка текущих матчей; пусто = выключено
module.exports.liveDetailLimit = Number(process.env.LIVE_DETAIL_LIMIT || 6);
module.exports.staleAfterMin = Number(process.env.STALE_AFTER_MIN || 30);                       // после скольких минут без успешной синхронизации данные считаются устаревшими
module.exports.pollSec = Number(process.env.CLIENT_POLL_SEC || 60);                             // как часто браузер опрашивает API
module.exports.pollLiveSec = Number(process.env.CLIENT_POLL_LIVE_SEC || 30);                    // ... если на странице есть текущие матчи
module.exports.apiCacheSec = Number(process.env.API_CACHE_SEC || 15);                           // кэш тяжёлых ответов API в памяти
module.exports.trustProxy = process.env.TRUST_PROXY || '';                                      // например 1 за одним обратным прокси
module.exports.corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
module.exports.sessionTtlHours = Number(process.env.SESSION_TTL_HOURS || 12);
module.exports.loginMaxFails = Number(process.env.LOGIN_MAX_FAILS || 5);
module.exports.loginWindowMin = Number(process.env.LOGIN_WINDOW_MIN || 15);
module.exports.cookieSecure = bool(process.env.COOKIE_SECURE, 'auto');                         // auto = Secure при HTTPS
module.exports.uploadMaxMb = Number(process.env.UPLOAD_MAX_MB || 5);
module.exports.uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
