// Обновление данных для сайта без сервера. Запускается GitHub Actions по расписанию (см. .github/workflows/update-site.yml).
//  1. Берёт базу data/esports.db (workflow перед запуском скачивает её с опубликованного сайта — так сохраняется история).
//  2. Раз в FULL_EVERY_MIN минут — полная синхронизация с BO3.GG, в остальные запуски — быстрая (только текущие матчи).
//  3. Переносит статьи из папки content/posts/*.md в базу.
//  4. Сохраняет базу одним файлом, который сайт читает прямо в браузере.
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const { openDb } = require('../src/database/db');
const { runSync, runLiveSync } = require('../src/services/sync');
const { makePostsRepo } = require('../src/database/posts-repo');

const FULL_EVERY_MIN = Number(process.env.FULL_EVERY_MIN || 60);
const POSTS_DIR = path.join(__dirname, '..', 'content', 'posts');

// --- статьи из Markdown-файлов: вверху файла блок ---\nключ: значение\n---
function parseFile(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const meta = {}; const body = m ? m[2] : text;
  if (m) for (const line of m[1].split('\n')) {
    const i = line.indexOf(':'); if (i < 1) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body };
}

function syncPosts(db) {
  const repo = makePostsRepo(db);
  const files = fs.existsSync(POSTS_DIR) ? fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_')) : [];
  const keep = new Set();
  for (const f of files) {
    const { meta, body } = parseFile(fs.readFileSync(path.join(POSTS_DIR, f), 'utf8'));
    const slug = (meta.slug || f.replace(/\.md$/, '')).toLowerCase();
    let category_id = null;
    if (meta.category) {
      const c = db.prepare('SELECT id FROM post_categories WHERE name=? OR slug=?').get(meta.category, meta.category);
      category_id = c ? c.id : null;
    }
    const input = {
      slug, title: meta.title || slug, kind: meta.kind || 'article', excerpt: meta.excerpt || '', body_md: body.trim(),
      cover_url: meta.cover || '', game_code: meta.game || null, category_id, tags: meta.tags || '',
      published_at: meta.date ? new Date(meta.date).toISOString() : null,
    };
    try {
      const cur = db.prepare('SELECT id FROM posts WHERE slug=?').get(slug);
      const id = cur ? (repo.update(cur.id, input), cur.id) : repo.create(input, null);
      const draft = String(meta.draft || '').toLowerCase() === 'true';
      db.prepare('UPDATE posts SET status=?, published_at=COALESCE(published_at, ?) WHERE id=?').run(draft ? 'draft' : 'published', new Date().toISOString(), id);
      keep.add(id);
    } catch (e) { console.error(`Статья ${f}: ${e.message}`); }
  }
  // Статьи, файлы которых удалены, снимаются с публикации
  for (const { id } of db.prepare('SELECT id FROM posts').all()) if (!keep.has(id)) repo.remove(id);
  console.log(`Статей из content/posts: ${keep.size}`);
}

(async () => {
  const db = openDb(cfg.dbPath);
  const lastFull = db.prepare("SELECT finished_at FROM sync_runs WHERE kind='full' AND status IN ('success','partial') ORDER BY id DESC LIMIT 1").get();
  const ageMin = lastFull ? (Date.now() - new Date(lastFull.finished_at)) / 60000 : Infinity;
  const full = process.env.FORCE_FULL === 'true' || ageMin >= FULL_EVERY_MIN;
  // Незавершённые запуски (например, прерванные по времени) помечаем как неудачные
  db.prepare("UPDATE sync_runs SET status='failed', finished_at=COALESCE(finished_at, started_at) WHERE status='running'").run();
  console.log(full ? 'Полная синхронизация' : 'Быстрая синхронизация (текущие матчи)');
  try { console.log(full ? await runSync(db) : await runLiveSync(db)); } catch (e) { console.error('Синхронизация:', e.message); }
  syncPosts(db);
  // Служебные таблицы входа в публикуемый файл не попадают
  for (const t of ['admin_sessions', 'admin_login_attempts', 'admin_users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch {} }
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE'); // один файл без -wal, иначе браузер его не прочитает
  db.exec('VACUUM');
  db.close();
  console.log('База готова:', cfg.dbPath, Math.round(fs.statSync(cfg.dbPath).size / 1024), 'КБ');
})();
