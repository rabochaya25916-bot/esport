// Защищённый API администратора: вход, публикации, категории, загрузка обложек, ручной запуск синхронизации.
// Все маршруты, кроме /session и /login, требуют сессию; изменяющие — ещё и X-CSRF-Token.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cfg = require('../config');
const { makeAuth } = require('../auth/sessions');
const { hashPassword, verifyPassword, passwordProblem } = require('../auth/password');
const { makePostsRepo, ValidationError } = require('../database/posts-repo');
const { renderMarkdown, readingMinutes } = require('../content/markdown');
const { runSync, runLiveSync, isRunning } = require('../services/sync');
const cache = require('../services/cache');

// Сигнатуры файлов: принимаются только растровые изображения (SVG запрещён — может содержать скрипты)
const IMAGE_TYPES = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 6 && /^GIF8[79]a$/.test(b.slice(0, 6).toString()) },
];

module.exports = function adminApi(db, opts = {}) {
  const r = express.Router();
  const auth = makeAuth(db, opts);
  const posts = makePostsRepo(db);
  const uploadsDir = opts.uploadsDir || cfg.uploadsDir;
  const sync = opts.sync || { runSync, runLiveSync };
  const id = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);
  const fail = (res, e) => {
    if (e instanceof ValidationError) return res.status(400).json({ error: e.message, errors: e.errors });
    console.error(e); return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  };

  r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
  // Защита от межсайтовых запросов: если браузер прислал Origin, он должен совпадать с адресом сайта
  r.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let host; try { host = new URL(origin).host; } catch { host = ''; }
      const allowed = opts.corsOrigins ?? cfg.corsOrigins;
      if (host !== req.get('host') && !allowed.includes(origin)) return res.status(403).json({ error: 'Запрос с другого сайта отклонён' });
    }
    next();
  });
  r.use(express.json({ limit: '1mb' }));

  // ---------- Сессия ----------
  r.get('/session', (req, res) => {
    const s = auth.sessionOf(req);
    const hasAdmin = !!db.prepare('SELECT 1 FROM admin_users LIMIT 1').get();
    res.json({ has_admin: hasAdmin, user: s ? { id: s.user_id, username: s.username } : null, csrf: s ? s.csrf_token : null });
  });
  r.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 60 || password.length > 200) {
      return res.status(400).json({ error: 'Укажите логин и пароль' });
    }
    try {
      const out = await auth.login(req, res, username.trim(), password);
      if (out.status !== 200) return res.status(out.status).json({ error: out.error });
      res.json({ user: out.user, csrf: out.csrf, ...(out.token ? { token: out.token } : {}) });
    } catch (e) { fail(res, e); }
  });

  r.use(auth.requireAdmin);

  r.post('/logout', (req, res) => { auth.logout(req, res); res.json({ ok: true }); });
  r.post('/password', async (req, res) => {
    const { current, next: nextPw } = req.body || {};
    const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.admin.id);
    if (!u || typeof current !== 'string' || !(await verifyPassword(current, u.password_hash))) return res.status(400).json({ error: 'Текущий пароль указан неверно' });
    const prob = passwordProblem(nextPw, u.username); if (prob) return res.status(400).json({ error: prob });
    db.prepare('UPDATE admin_users SET password_hash=?, password_changed_at=? WHERE id=?').run(await hashPassword(nextPw), new Date().toISOString(), u.id);
    db.prepare('DELETE FROM admin_sessions WHERE user_id=? AND token_hash<>?').run(u.id, req.admin.tokenHash); // остальные сессии завершаются
    res.json({ ok: true });
  });

  // ---------- Обзор ----------
  r.get('/overview', (req, res) => {
    const nowIso = new Date().toISOString();
    res.json({
      user: { id: req.admin.id, username: req.admin.username },
      posts: db.prepare(`SELECT
          SUM(status='draft') AS drafts, SUM(status='published' AND published_at<=?) AS published, SUM(status='published' AND published_at>?) AS scheduled, COUNT(*) AS total FROM posts`).get(nowIso, nowIso),
      recent_posts: posts.list({ admin: true, limit: 5 }).rows,
      sync: { running: isRunning(), last_runs: db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 10').all(), errors: db.prepare('SELECT * FROM sync_errors ORDER BY id DESC LIMIT 10').all() },
      sessions: db.prepare('SELECT COUNT(*) c FROM admin_sessions WHERE user_id=? AND expires_at>?').get(req.admin.id, nowIso).c,
    });
  });

  // ---------- Публикации ----------
  r.get('/posts', (req, res) => {
    const { status } = req.query; const q = String(req.query.q || '').trim().slice(0, 80);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100); const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const out = posts.list({ admin: true, status, q, limit, offset, kind: req.query.kind || null });
    res.set('X-Total-Count', String(out.total)); res.json(out.rows);
  });
  r.get('/posts/:id', (req, res) => { const p = id(req) && posts.byId(id(req)); p ? res.json(p) : res.status(404).json({ error: 'Публикация не найдена' }); });
  r.post('/posts', (req, res) => {
    try { const newId = posts.create(req.body || {}, req.admin.id); cache.bump(); res.status(201).json(posts.byId(newId)); } catch (e) { fail(res, e); }
  });
  r.put('/posts/:id', (req, res) => {
    try { const ok = id(req) && posts.update(id(req), req.body || {}); if (!ok) return res.status(404).json({ error: 'Публикация не найдена' }); cache.bump(); res.json(posts.byId(ok)); } catch (e) { fail(res, e); }
  });
  r.post('/posts/:id/publish', (req, res) => {
    try { const ok = id(req) && posts.publish(id(req), (req.body || {}).published_at); if (!ok) return res.status(404).json({ error: 'Публикация не найдена' }); cache.bump(); res.json(posts.byId(ok)); } catch (e) { fail(res, e); }
  });
  r.post('/posts/:id/unpublish', (req, res) => {
    const ok = id(req) && posts.unpublish(id(req)); if (!ok) return res.status(404).json({ error: 'Публикация не найдена' }); cache.bump(); res.json(posts.byId(ok));
  });
  r.delete('/posts/:id', (req, res) => {
    const ok = id(req) && posts.remove(id(req)); if (!ok) return res.status(404).json({ error: 'Публикация не найдена' }); cache.bump(); res.json({ ok: true });
  });
  // Предпросмотр — тот же серверный рендер, что и при сохранении
  r.post('/preview', (req, res) => {
    const md = String((req.body || {}).body_md || ''); if (md.length > 200000) return res.status(400).json({ error: 'Текст слишком длинный' });
    const { html, toc } = renderMarkdown(md); res.json({ html, toc, reading_minutes: readingMinutes(md) });
  });

  // ---------- Категории ----------
  r.get('/categories', (req, res) => res.json(posts.categories({ publicOnly: false })));
  r.post('/categories', (req, res) => { try { const cid = posts.saveCategory(req.body || {}); cache.bump(); res.status(201).json({ id: cid }); } catch (e) { fail(res, e); } });
  r.put('/categories/:id', (req, res) => {
    try { const ok = id(req) && posts.saveCategory({ ...(req.body || {}), id: id(req) }); if (!ok) return res.status(404).json({ error: 'Категория не найдена' }); cache.bump(); res.json({ id: ok }); } catch (e) { fail(res, e); }
  });
  r.delete('/categories/:id', (req, res) => { const ok = id(req) && posts.deleteCategory(id(req)); if (!ok) return res.status(404).json({ error: 'Категория не найдена' }); cache.bump(); res.json({ ok: true }); });

  // ---------- Загрузка обложек и иллюстраций ----------
  r.post('/uploads', express.raw({ type: () => true, limit: `${cfg.uploadMaxMb}mb` }), (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const type = IMAGE_TYPES.find((t) => t.test(buf));
    if (!type) return res.status(400).json({ error: 'Поддерживаются только изображения PNG, JPEG, WebP и GIF' });
    fs.mkdirSync(uploadsDir, { recursive: true });
    const name = `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(8).toString('hex')}.${type.ext}`;
    fs.writeFileSync(path.join(uploadsDir, name), buf, { flag: 'wx' });
    res.status(201).json({ url: `/uploads/${name}`, size: buf.length, type: type.mime });
  });
  r.get('/uploads', (req, res) => {
    if (!fs.existsSync(uploadsDir)) return res.json([]);
    const files = fs.readdirSync(uploadsDir).filter((f) => /^[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i.test(f))
      .map((f) => ({ url: `/uploads/${f}`, size: fs.statSync(path.join(uploadsDir, f)).size, mtime: fs.statSync(path.join(uploadsDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime).slice(0, 100);
    res.json(files);
  });

  // ---------- Синхронизация ----------
  r.post('/sync/run', (req, res) => {
    const kind = (req.body || {}).kind === 'live' ? 'live' : 'full';
    if (isRunning()) return res.status(409).json({ error: 'Синхронизация уже выполняется' });
    const job = kind === 'live' ? sync.runLiveSync(db) : sync.runSync(db);
    Promise.resolve(job).then((x) => console.log(`[sync:admin-${kind}]`, JSON.stringify(x))).catch((e) => console.error(e));
    res.status(202).json({ started: true, kind });
  });

  r.use((req, res) => res.status(404).json({ error: 'Не найдено' }));
  return r;
};
