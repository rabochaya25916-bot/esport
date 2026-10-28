// Собственные статьи и гайды. Хранятся в БД; HTML формируется на сервере безопасным рендером Markdown.
'use strict';
const { renderMarkdown, plainText, readingMinutes, safeUrl } = require('../content/markdown');

const GAMES = ['cs2', 'dota2', 'lol'];
const KINDS = ['article', 'guide'];
const now = () => new Date().toISOString();

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (s) => String(s || '').toLowerCase().split('').map((c) => TR[c] ?? c).join('')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

class ValidationError extends Error { constructor(errors) { super(Object.values(errors)[0]); this.errors = errors; this.status = 400; } }

// Проверка входных данных публикации. Возвращает нормализованный объект или бросает ValidationError.
function validatePost(input, { partial = false } = {}) {
  const e = {}; const o = {};
  const str = (v) => (v == null ? '' : String(v)).trim();
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has('title')) { o.title = str(input.title).replace(/\s+/g, ' '); if (o.title.length < 3 || o.title.length > 200) e.title = 'Заголовок: от 3 до 200 символов'; }
  if (has('slug') || !partial) {
    const s = str(input.slug) ? slugify(input.slug) : slugify(o.title || input.title);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(s)) e.slug = 'Адрес (slug): латиница, цифры и дефис, до 100 символов'; o.slug = s;
  }
  if (!partial || has('kind')) { o.kind = str(input.kind) || 'article'; if (!KINDS.includes(o.kind)) e.kind = 'Тип: article или guide'; }
  if (!partial || has('excerpt')) { o.excerpt = str(input.excerpt) || null; if (o.excerpt && o.excerpt.length > 500) e.excerpt = 'Анонс: не более 500 символов'; }
  if (!partial || has('body_md')) { o.body_md = input.body_md == null ? '' : String(input.body_md); if (o.body_md.length > 200000) e.body_md = 'Текст: не более 200 000 символов'; }
  if (!partial || has('cover_url')) {
    const c = str(input.cover_url); o.cover_url = c ? safeUrl(c, { image: true }) : null;
    if (c && (!o.cover_url || !/^(https:\/\/|\/uploads\/)/.test(o.cover_url))) e.cover_url = 'Обложка: ссылка https://… или загруженный файл';
  }
  if (!partial || has('game_code')) { o.game_code = str(input.game_code) || null; if (o.game_code && !GAMES.includes(o.game_code)) e.game_code = 'Неизвестная дисциплина'; }
  if (!partial || has('category_id')) {
    o.category_id = input.category_id === '' || input.category_id == null ? null : Number(input.category_id);
    if (o.category_id !== null && !Number.isInteger(o.category_id)) e.category_id = 'Неверная категория';
  }
  if (!partial || has('tags')) {
    const raw = Array.isArray(input.tags) ? input.tags : str(input.tags).split(',');
    o.tags = [...new Map(raw.map((t) => str(t).replace(/\s+/g, ' ')).filter(Boolean).map((t) => [slugify(t) || t.toLowerCase(), t])).values()];
    if (o.tags.length > 12) e.tags = 'Не более 12 тегов'; if (o.tags.some((t) => t.length > 40)) e.tags = 'Тег: не более 40 символов';
  }
  if (has('published_at')) {
    const v = str(input.published_at);
    if (!v) o.published_at = null;
    else { const d = new Date(v); if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) e.published_at = 'Неверная дата публикации'; else o.published_at = d.toISOString(); }
  }
  if (Object.keys(e).length) throw new ValidationError(e);
  return o;
}

function makePostsRepo(db) {
  const tagIdsFor = (names) => names.map((name) => {
    const slug = slugify(name) || ('tag-' + Buffer.from(name).toString('hex').slice(0, 16));
    db.prepare('INSERT INTO post_tags (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING').run(slug, name);
    return db.prepare('SELECT id FROM post_tags WHERE slug=?').get(slug).id;
  });
  const setTags = (postId, names) => {
    db.prepare('DELETE FROM post_tag_links WHERE post_id=?').run(postId);
    for (const id of tagIdsFor(names)) db.prepare('INSERT OR IGNORE INTO post_tag_links (post_id, tag_id) VALUES (?, ?)').run(postId, id);
    db.prepare('DELETE FROM post_tags WHERE id NOT IN (SELECT tag_id FROM post_tag_links)').run();
  };
  const tagsOf = (postId) => db.prepare('SELECT t.slug, t.name FROM post_tags t JOIN post_tag_links l ON l.tag_id=t.id WHERE l.post_id=? ORDER BY t.name COLLATE NOCASE').all(postId);
  const uniqueSlug = (slug, exceptId = 0) => {
    let s = slug; let k = 2;
    while (db.prepare('SELECT 1 FROM posts WHERE slug=? AND id<>?').get(s, exceptId)) s = `${slug.slice(0, 95)}-${k++}`;
    return s;
  };
  const checkCategory = (id) => { if (id != null && !db.prepare('SELECT 1 FROM post_categories WHERE id=?').get(id)) throw new ValidationError({ category_id: 'Категория не найдена' }); };

  const select = `SELECT p.*, c.slug AS category_slug, c.name AS category_name, u.username AS author FROM posts p
    LEFT JOIN post_categories c ON c.id=p.category_id LEFT JOIN admin_users u ON u.id=p.author_id`;
  const shape = (p, { body = true } = {}) => p && ({
    id: p.id, slug: p.slug, kind: p.kind, title: p.title, excerpt: p.excerpt, cover_url: p.cover_url, game_code: p.game_code,
    category: p.category_id ? { id: p.category_id, slug: p.category_slug, name: p.category_name } : null,
    status: p.status, published_at: p.published_at, reading_minutes: p.reading_minutes, author: p.author || null,
    created_at: p.created_at, updated_at: p.updated_at, tags: tagsOf(p.id),
    is_scheduled: p.status === 'published' && p.published_at > now(),
    ...(body ? { body_md: p.body_md, body_html: p.body_html, toc: renderMarkdown(p.body_md).toc } : {}),
  });

  const create = db.transaction((input, authorId) => {
    const o = validatePost(input); checkCategory(o.category_id);
    const { html } = renderMarkdown(o.body_md); const t = now();
    const excerpt = o.excerpt || plainText(o.body_md).slice(0, 220) || null;
    const id = db.prepare(`INSERT INTO posts (slug, kind, title, excerpt, body_md, body_html, cover_url, game_code, category_id, status, published_at, reading_minutes, author_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?, ?, ?, ?, ?)`).run(uniqueSlug(o.slug), o.kind, o.title, excerpt, o.body_md, html, o.cover_url, o.game_code, o.category_id,
      o.published_at ?? null, readingMinutes(o.body_md), authorId ?? null, t, t).lastInsertRowid;
    setTags(id, o.tags);
    return Number(id);
  });
  const update = db.transaction((id, input) => {
    const cur = db.prepare('SELECT * FROM posts WHERE id=?').get(id); if (!cur) return null;
    const o = validatePost(input, { partial: true }); if ('category_id' in o) checkCategory(o.category_id);
    const next = { ...cur, ...o };
    if ('slug' in o) next.slug = uniqueSlug(o.slug, id);
    if ('body_md' in o) { next.body_html = renderMarkdown(next.body_md).html; next.reading_minutes = readingMinutes(next.body_md); }
    if ('excerpt' in o && !o.excerpt) next.excerpt = plainText(next.body_md).slice(0, 220) || null;
    db.prepare(`UPDATE posts SET slug=?, kind=?, title=?, excerpt=?, body_md=?, body_html=?, cover_url=?, game_code=?, category_id=?, published_at=?, reading_minutes=?, updated_at=? WHERE id=?`)
      .run(next.slug, next.kind, next.title, next.excerpt, next.body_md, next.body_html, next.cover_url, next.game_code, next.category_id, next.published_at, next.reading_minutes, now(), id);
    if ('tags' in o) setTags(id, o.tags);
    return id;
  });
  const publish = (id, at) => {
    const p = db.prepare('SELECT * FROM posts WHERE id=?').get(id); if (!p) return null;
    if (!p.body_md.trim()) throw new ValidationError({ body_md: 'Нельзя опубликовать пустой текст' });
    const when = at ? new Date(at) : null;
    if (when && Number.isNaN(when.getTime())) throw new ValidationError({ published_at: 'Неверная дата публикации' });
    db.prepare("UPDATE posts SET status='published', published_at=?, updated_at=? WHERE id=?").run(when ? when.toISOString() : p.published_at || now(), now(), id);
    return id;
  };
  const unpublish = (id) => (db.prepare("UPDATE posts SET status='draft', updated_at=? WHERE id=?").run(now(), id).changes ? id : null);
  const remove = (id) => db.transaction(() => { const ok = db.prepare('DELETE FROM posts WHERE id=?').run(id).changes; db.prepare('DELETE FROM post_tags WHERE id NOT IN (SELECT tag_id FROM post_tag_links)').run(); return ok; })();
  const byId = (id) => shape(db.prepare(`${select} WHERE p.id=?`).get(id));
  const publishedBySlug = (slug) => shape(db.prepare(`${select} WHERE p.slug=? AND p.status='published' AND p.published_at<=?`).get(slug, now()));

  // Публичный список: только опубликованные (и уже наступившая дата публикации)
  function list({ q, category, tag, kind, game, status, limit = 12, offset = 0, admin = false } = {}) {
    const w = []; const p = [];
    if (!admin) { w.push("p.status='published' AND p.published_at<=?"); p.push(now()); }
    else if (status === 'draft' || status === 'published') { w.push('p.status=?'); p.push(status); }
    else if (status === 'scheduled') { w.push("p.status='published' AND p.published_at>?"); p.push(now()); }
    if (q) { w.push('(p.title LIKE ? OR p.excerpt LIKE ? OR p.body_md LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (category) { w.push('c.slug=?'); p.push(category); }
    if (tag) { w.push('p.id IN (SELECT l.post_id FROM post_tag_links l JOIN post_tags t ON t.id=l.tag_id WHERE t.slug=?)'); p.push(tag); }
    if (kind) { w.push('p.kind=?'); p.push(kind); }
    if (game) { w.push('(p.game_code=? OR p.game_code IS NULL)'); p.push(game); } // общие материалы видны в любой дисциплине
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM posts p LEFT JOIN post_categories c ON c.id=p.category_id ${where}`).get(...p).c;
    const order = admin ? 'p.updated_at DESC' : 'p.published_at DESC, p.id DESC';
    const rows = db.prepare(`${select} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...p, limit, offset).map((x) => shape(x, { body: false }));
    return { total, rows };
  }
  const related = (post, n = 3) => db.prepare(`${select} WHERE p.status='published' AND p.published_at<=? AND p.id<>?
      ORDER BY (p.category_id IS ?) DESC, (p.game_code IS ?) DESC, p.published_at DESC LIMIT ?`).all(now(), post.id, post.category ? post.category.id : null, post.game_code, n)
    .map((x) => shape(x, { body: false }));
  const categories = ({ publicOnly = true } = {}) => db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id=c.id ${publicOnly ? "AND p.status='published' AND p.published_at<=?" : ''}) AS posts_count
    FROM post_categories c ORDER BY c.sort, c.name`).all(...(publicOnly ? [now()] : []));
  const tags = () => db.prepare(`SELECT t.slug, t.name, COUNT(*) AS posts_count FROM post_tags t JOIN post_tag_links l ON l.tag_id=t.id JOIN posts p ON p.id=l.post_id
    WHERE p.status='published' AND p.published_at<=? GROUP BY t.id ORDER BY posts_count DESC, t.name COLLATE NOCASE LIMIT 60`).all(now());

  function saveCategory({ id, name, slug, description, sort }) {
    const n = String(name || '').trim(); if (n.length < 2 || n.length > 60) throw new ValidationError({ name: 'Название категории: от 2 до 60 символов' });
    const s = slugify(slug || n); if (!s) throw new ValidationError({ slug: 'Неверный адрес категории' });
    const d = description ? String(description).trim().slice(0, 300) : null; const so = Number.isInteger(Number(sort)) ? Number(sort) : 0;
    const clash = db.prepare('SELECT id FROM post_categories WHERE slug=? AND id<>?').get(s, id || 0); if (clash) throw new ValidationError({ slug: 'Категория с таким адресом уже есть' });
    if (id) { const r = db.prepare('UPDATE post_categories SET name=?, slug=?, description=?, sort=? WHERE id=?').run(n, s, d, so, id); return r.changes ? id : null; }
    return Number(db.prepare('INSERT INTO post_categories (name, slug, description, sort) VALUES (?,?,?,?)').run(n, s, d, so).lastInsertRowid);
  }
  const deleteCategory = (id) => db.prepare('DELETE FROM post_categories WHERE id=?').run(id).changes;

  return { create, update, publish, unpublish, remove, byId, publishedBySlug, list, related, categories, tags, saveCategory, deleteCategory };
}

module.exports = { makePostsRepo, validatePost, ValidationError, slugify };
