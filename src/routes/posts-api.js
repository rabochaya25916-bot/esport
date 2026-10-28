// Публичная часть статей и гайдов: только опубликованные материалы с наступившей датой публикации.
'use strict';
module.exports = function postsApi(r, db, { posts, lim, off, gameOk, bad, notFound }) {
  r.get('/posts', (req, res) => {
    const { game, kind, category, tag } = req.query; const q = String(req.query.q || '').trim();
    if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    if (kind && !['article', 'guide'].includes(kind)) return bad(res, 'kind: article | guide');
    if (q.length > 80) return bad(res, 'Слишком длинный запрос');
    const { total, rows } = posts.list({ q, game, kind, category: category || null, tag: tag || null, limit: lim(req.query.limit, 12), offset: off(req.query.offset) });
    res.set('X-Total-Count', String(total));
    res.json(rows);
  });
  r.get('/posts/:slug', (req, res) => {
    if (!/^[a-z0-9-]{1,120}$/.test(req.params.slug)) return notFound(res);
    const p = posts.publishedBySlug(req.params.slug); if (!p) return notFound(res);
    const { body_md, ...pub } = p; // исходный Markdown публично не нужен
    res.json({ ...pub, related: posts.related(p, 3) });
  });
  r.get('/post-categories', (req, res) => res.json(posts.categories()));
  r.get('/post-tags', (req, res) => res.json(posts.tags()));
};
