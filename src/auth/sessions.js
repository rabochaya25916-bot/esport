// Серверные сессии администратора.
// Токен (32 случайных байта) живёт только в HttpOnly-cookie; в базе хранится его SHA-256.
// Изменяющие запросы требуют заголовок X-CSRF-Token, совпадающий с токеном сессии.
'use strict';
const crypto = require('crypto');
const cfg = require('../config');
const { verifyPassword, dummyVerify } = require('./password');

const COOKIE = 'eh_admin';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const nowIso = () => new Date().toISOString();

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(); const v = part.slice(i + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  }
  return out;
}

function makeAuth(db, opts = {}) {
  const ttlH = opts.sessionTtlHours ?? cfg.sessionTtlHours;
  const maxFails = opts.loginMaxFails ?? cfg.loginMaxFails;
  const windowMin = opts.loginWindowMin ?? cfg.loginWindowMin;
  const secureCookie = opts.cookieSecure ?? cfg.cookieSecure;

  const cookie = (req, value, maxAgeSec) => {
    const secure = secureCookie === 'auto' ? req.secure : secureCookie === true;
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
  };

  const tooManyAttempts = (key) => {
    const since = new Date(Date.now() - windowMin * 60000).toISOString();
    return db.prepare('SELECT COUNT(*) c FROM admin_login_attempts WHERE key=? AND ok=0 AND created_at>?').get(key, since).c >= maxFails;
  };

  async function login(req, res, username, password) {
    const ipKey = `ip:${req.ip}`; const userKey = `user:${String(username).toLowerCase()}`;
    if (tooManyAttempts(ipKey) || tooManyAttempts(userKey)) {
      return { status: 429, error: `Слишком много неудачных попыток. Повторите через ${windowMin} мин.` };
    }
    const user = db.prepare('SELECT * FROM admin_users WHERE username=?').get(String(username));
    const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
    const t = nowIso();
    db.prepare('INSERT INTO admin_login_attempts (key, created_at, ok) VALUES (?,?,?), (?,?,?)').run(ipKey, t, ok ? 1 : 0, userKey, t, ok ? 1 : 0);
    if (!ok) return { status: 401, error: 'Неверный логин или пароль' };
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const exp = new Date(Date.now() + ttlH * 3600000).toISOString();
    db.prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(t);
    db.prepare('INSERT INTO admin_sessions (token_hash, user_id, csrf_token, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)')
      .run(sha(token), user.id, csrf, t, exp, req.ip, String(req.get('user-agent') || '').slice(0, 300));
    db.prepare('UPDATE admin_users SET last_login_at=? WHERE id=?').run(t, user.id);
    // старые записи попыток чистим, чтобы таблица не росла бесконечно
    db.prepare('DELETE FROM admin_login_attempts WHERE created_at<?').run(new Date(Date.now() - 7 * 86400000).toISOString());
    res.setHeader('Set-Cookie', cookie(req, token, ttlH * 3600));
    // Токен в ответе — только для разрешённого стороннего сайта (CORS_ORIGINS), иначе он остаётся лишь в HttpOnly-cookie
    const allowed = opts.corsOrigins ?? cfg.corsOrigins; const origin = req.get('origin');
    return { status: 200, user: { id: user.id, username: user.username }, csrf, token: origin && allowed.includes(origin) ? token : undefined };
  }

  // Токен берётся из HttpOnly-cookie (сайт и API на одном домене) или из заголовка Authorization: Bearer
  // (сайт на файловом хостинге, API на отдельном домене из CORS_ORIGINS)
  const bearer = (req) => { const m = String(req.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/); return m ? m[1] : null; };
  function sessionOf(req) {
    const b = bearer(req);
    const token = b || parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 200) return null;
    const s = db.prepare(`SELECT s.*, u.username FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha(token));
    if (!s) return null;
    if (s.expires_at < nowIso()) { db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(s.token_hash); return null; }
    s.viaBearer = !!b;
    return s;
  }

  function logout(req, res) {
    const s = sessionOf(req);
    if (s) db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(s.token_hash);
    res.setHeader('Set-Cookie', cookie(req, '', 0));
  }

  // Middleware: только для вошедшего администратора; для POST/PUT/PATCH/DELETE — ещё и CSRF-токен
  function requireAdmin(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const s = sessionOf(req);
    if (!s) return res.status(401).json({ error: 'Требуется вход администратора' });
    // Заголовок Authorization браузер сам не подставляет, поэтому CSRF-токен нужен только для cookie-сессии
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !s.viaBearer) {
      const h = String(req.get('x-csrf-token') || '');
      const a = Buffer.from(h); const b = Buffer.from(s.csrf_token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Недействительный CSRF-токен. Обновите страницу.' });
    }
    req.admin = { id: s.user_id, username: s.username, csrf: s.csrf_token, tokenHash: s.token_hash };
    next();
  }

  return { login, logout, sessionOf, requireAdmin, COOKIE };
}

module.exports = { makeAuth, parseCookies, sha };
