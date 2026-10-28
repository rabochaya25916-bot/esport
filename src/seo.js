// Серверная подготовка index.html: уникальные title/description/canonical для публичных страниц,
// noindex для админки и служебных страниц, 404 для несуществующих объектов, robots.txt и sitemap.xml.
// Для статей в разметку сразу вставляется текст, чтобы поисковики видели содержимое без JavaScript.
'use strict';
const fs = require('fs');
const cfg = require('./config');
const { makePostsRepo } = require('./database/posts-repo');
const { loadShared, makeFacts, metaForPath, safeDecode } = require('./seo-facts');

const GN = { cs2: 'CS2', dota2: 'Dota 2', lol: 'League of Legends' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : t; };
const day = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

function makeSeo(db, { indexPath, siteUrl = cfg.siteUrl, siteName = cfg.siteName } = {}) {
  const posts = makePostsRepo(db);
  let tpl = null; let tplMtime = 0;
  const template = () => {
    const st = fs.statSync(indexPath);
    if (!tpl || st.mtimeMs !== tplMtime) { tpl = fs.readFileSync(indexPath, 'utf8'); tplMtime = st.mtimeMs; }
    return tpl;
  };
  const origin = (req) => siteUrl || `${req.protocol}://${req.get('host')}`;
  const absUrl = (req, u) => (!u ? null : /^https?:\/\//.test(u) ? u : origin(req) + u);

  const ready = loadShared();
  let S = null; let F = null;
  const init = async () => { if (!S) { S = await ready; F = makeFacts(db, S); if (!process.env.SITE_NAME) siteName = S.BRAND.name; } };
  const NOINDEX = { '/search': 'Поиск', '/settings': 'Настройки' };

  function metaFor(req) {
    const p = req.path.replace(/\/+$/, '') || '/';
    if (p === '/admin' || p.startsWith('/admin/')) return { title: `Администрирование | ${siteName}`, description: 'Служебный раздел.', robots: 'noindex, nofollow', admin: true };
    if (NOINDEX[p]) return S.T.service(siteName, NOINDEX[p]);
    let m;
    if ((m = p.match(/^\/articles\/([a-z0-9-]{1,120})$/))) {
      const x = posts.publishedBySlug(m[1]); if (!x) return null;
      const crumbs = [['Статьи и гайды', '/articles'], [x.title, p]];
      return { title: `${x.title} | ${siteName}`, description: cut(x.excerpt || x.title), h1: x.title, canonical: p, image: x.cover_url, type: 'article', post: x, crumbs };
    }
    // Старый адрес /crosshair (без s) — тот же раздел, canonical указывает на /crosshairs
    const meta = metaForPath(S, F, p === '/crosshair' ? '/crosshairs' : p, origin(req), siteName);
    return meta && { ...meta, canonical: p === '/crosshair' ? '/crosshairs' : p };
  }

  // Видимое без JavaScript содержимое: H1, описание и хлебные крошки с внутренними ссылками
  function ssrBasic(mt) {
    const cr = (mt.crumbs || []).length ? `<nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a>${mt.crumbs.map(([n, u]) => `<a href="${esc(u)}">${esc(n)}</a>`).join('')}</nav>` : '';
    return `<div class="page ssr">${cr}<h1>${esc(mt.h1 || mt.title)}</h1><p class="lead">${esc(mt.description)}</p></div>`;
  }

  function ssrPost(x) {
    return `<article class="ssr-article"><h1>${esc(x.title)}</h1><p>${esc(day(x.published_at))}</p>${x.cover_url ? `<img src="${esc(x.cover_url)}" alt="">` : ''}<div>${x.body_html}</div></article>`;
  }

  async function render(req, res) {
    await init();
    const meta = metaFor(req);
    const status = meta ? 200 : 404;
    const mt = meta || { title: `Страница не найдена | ${siteName}`, description: 'Такой страницы нет или она была удалена.', robots: 'noindex, follow' };
    const title = mt.title;
    const head = [
      '<meta name="eh-server" content="node">',
      `<meta name="robots" content="${esc(mt.robots || 'index, follow')}">`,
      mt.canonical ? `<link rel="canonical" href="${esc(origin(req) + mt.canonical)}">` : '',
      `<meta property="og:site_name" content="${esc(siteName)}">`,
      `<meta property="og:title" content="${esc(mt.title)}">`,
      `<meta property="og:description" content="${esc(mt.description)}">`,
      `<meta property="og:type" content="${mt.type || 'website'}">`,
      mt.canonical ? `<meta property="og:url" content="${esc(origin(req) + mt.canonical)}">` : '',
      mt.image ? `<meta property="og:image" content="${esc(absUrl(req, mt.image))}">` : '',
      `<meta name="twitter:card" content="${mt.image && mt.type === 'article' ? 'summary_large_image' : 'summary'}">`,
      mt.post ? `<meta property="article:published_time" content="${esc(mt.post.published_at)}">` : '',
      ...(mt.jsonld || []).filter(Boolean).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
    ].filter(Boolean).join('\n  ');
    let html = template()
      // Через Node.js сайт работает с корня и с настоящими адресами страниц: пути к файлам делаем абсолютными
      .replace(/(href|src)="(assets\/|favicon\.svg)/g, '$1="/$2')
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(mt.description)}">`)
      .replace(/\s*<meta property="og:(title|description|type)" content="[^"]*">/g, '')
      .replace(/\s*<meta name="twitter:card" content="[^"]*">/, '')
      .replace('<!--SEO-->', head);
    html = html.replace('<!--SSR-->', mt.post ? ssrPost(mt.post) : meta ? ssrBasic(mt) : '');
    if (mt.admin) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.status(status).type('html').set('Cache-Control', 'no-cache').send(html);
  }

  function robots(req, res) {
    res.type('text/plain').send(['User-agent: *', 'Disallow: /admin', 'Disallow: /api/', 'Disallow: /search', 'Disallow: /settings', 'Allow: /', '', `Sitemap: ${origin(req)}/sitemap.xml`, ''].join('\n'));
  }

  async function sitemap(req, res) {
    const o = origin(req); const urls = [];
    const add = (loc, lastmod, pri) => urls.push(`<url><loc>${esc(o + loc)}</loc>${lastmod ? `<lastmod>${esc(String(lastmod).slice(0, 10))}</lastmod>` : ''}${pri ? `<priority>${pri}</priority>` : ''}</url>`);
    await init();
    for (const p of Object.keys(S.T.STATIC_PAGES)) add(p, null, p === '/' ? '1.0' : '0.7');
    for (const c of S.cs2.configs) add(`/config/${c.slug}`, c.updated, '0.6');
    for (const c of S.cs2.crosshairs) add(`/crosshair/${c.slug}`, c.date, '0.5');
    for (const c of S.configs) { add(`/config/${S.T.slugNick(c.nickname)}`, c.updated, '0.6'); if (safeDecode(S.XH, c.crosshair)) add(`/crosshair/${S.T.slugNick(c.nickname)}`, c.updated, '0.6'); }
    for (const x of posts.list({ limit: 2000 }).rows) add(`/articles/${x.slug}`, x.updated_at, '0.8');
    for (const x of db.prepare("SELECT id, updated_at FROM tournaments ORDER BY start_date DESC LIMIT 1000").all()) add(`/tournament/${x.id}`, x.updated_at, '0.6');
    for (const x of db.prepare("SELECT id, updated_at FROM teams ORDER BY rank IS NULL, rank LIMIT 2000").all()) add(`/team/${x.id}`, x.updated_at, '0.6');
    for (const x of db.prepare("SELECT id, updated_at FROM players WHERE profile_status='ok' LIMIT 3000").all()) add(`/player/${x.id}`, x.updated_at, '0.5');
    for (const x of db.prepare("SELECT m.id, m.updated_at FROM matches m WHERE (SELECT COUNT(*) FROM match_teams mt WHERE mt.match_id=m.id AND mt.team_source_id IS NOT NULL)=2 ORDER BY m.start_date DESC LIMIT 2000").all()) add(`/match/${x.id}`, x.updated_at, '0.4');
    res.type('application/xml').set('Cache-Control', 'public, max-age=900')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  }

  return { render, robots, sitemap, metaFor, init };
}

module.exports = { makeSeo };
