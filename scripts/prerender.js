// Предгенерация HTML для поисковиков (сайт без сервера). Для каждой важной страницы создаётся папка с index.html:
//   _site/player/12/index.html, _site/team/5/index.html, _site/match/7/…, _site/tournament/3/…, _site/config/<ник>/…, разделы.
// В каждом файле — свои title, description, canonical, Open Graph, robots, Schema.org, H1 и текст с внутренними ссылками;
// после загрузки скриптов открывается обычное приложение. Также пишутся sitemap.xml, robots.txt и 404.html.
// Запуск: SITE_URL=https://example.com node scripts/prerender.js [папка, по умолчанию _site]
// После генерации запускается проверка SEO (одинаковые title, пустые description, дубли canonical) — см. scripts/seo-check.js.
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const { openDb } = require('../src/database/db');
const { loadShared, makeFacts, metaForPath, safeDecode } = require('../src/seo-facts');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '_site'));
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const LIMITS = { players: 3000, teams: 2000, tournaments: 1000, matches: 1500 };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(tpl, mt, logical, { depth, notFound = false, basePath = '' } = {}) {
  const prefix = depth ? '../'.repeat(depth) : '';
  const url = SITE_URL && mt.canonical ? SITE_URL + mt.canonical : null;
  const crumbs = (mt.crumbs || []).length ? `<nav class="crumbs" aria-label="Навигация"><a href="${prefix || './'}">Главная</a>${mt.crumbs.map(([n, u]) => `<a href="${esc(link(u, prefix))}">${esc(n)}</a>`).join('')}</nav>` : '';
  const head = [
    SITE_URL ? `<meta name="site-url" content="${esc(SITE_URL)}">` : '',
    `<meta name="robots" content="${esc(mt.robots || 'index, follow')}">`,
    url && !/noindex/.test(mt.robots || '') ? `<link rel="canonical" href="${esc(url)}">` : '',
    `<meta property="og:title" content="${esc(mt.title)}">`, `<meta property="og:description" content="${esc(mt.description)}">`,
    `<meta property="og:type" content="${mt.type || 'website'}">`, url ? `<meta property="og:url" content="${esc(url)}">` : '',
    mt.image && /^https?:/.test(mt.image) ? `<meta property="og:image" content="${esc(mt.image)}">` : '',
    `<meta name="twitter:card" content="summary">`,
    ...(mt.jsonld || []).filter(Boolean).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
  ].filter(Boolean).join('\n  ');
  let html = tpl
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(mt.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(mt.description)}">`)
    .replace(/\s*<meta property="og:(title|description|type)" content="[^"]*">/g, '')
    .replace(/\s*<meta name="twitter:card" content="[^"]*">/, '')
    .replace('<!--SEO-->', head)
    .replace('<!--SSR-->', `<div class="page ssr">${crumbs}<h1>${esc(mt.h1 || mt.title)}</h1><p class="lead">${esc(mt.description)}</p>${mt.ssr || ''}</div>`);
  // Пути к файлам: относительные для вложенных папок, абсолютные для 404.html (он отдаётся по любому адресу)
  html = html.replace(/(href|src)="(assets\/|favicon\.svg)/g, `$1="${notFound ? basePath : prefix}$2`);
  // Ссылки шапки и подвала (/matches) — на предсгенерированные страницы
  html = html.replace(/href="\/([a-z]*)"/g, (m0, p) => `href="${notFound ? basePath + p : link('/' + p, prefix)}"`);
  return html;
}
const link = (u, prefix) => (u === '/' ? prefix || './' : (prefix || './') + u.replace(/^\//, '') + '/');

(async () => {
  const S = await loadShared();
  const db = openDb(cfg.dbPath);
  const F = makeFacts(db, S);
  const site = process.env.SITE_NAME || S.BRAND.name;
  const tpl = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const all = (sql) => { try { return db.prepare(sql).all(); } catch { return []; } };
  const paths = ['/', ...Object.keys(S.T.STATIC_PAGES).filter((p) => p !== '/')];
  for (const c of S.cs2.configs) paths.push(`/config/${c.slug}`);
  for (const c of S.cs2.crosshairs) paths.push(`/crosshair/${c.slug}`);
  for (const c of S.configs) { paths.push(`/config/${S.T.slugNick(c.nickname)}`); if (safeDecode(S.XH, c.crosshair)) paths.push(`/crosshair/${S.T.slugNick(c.nickname)}`); }
  for (const x of all(`SELECT id FROM tournaments ORDER BY start_date DESC LIMIT ${LIMITS.tournaments}`)) paths.push(`/tournament/${x.id}`);
  for (const x of all(`SELECT id FROM teams ORDER BY rank IS NULL, rank LIMIT ${LIMITS.teams}`)) paths.push(`/team/${x.id}`);
  for (const x of all(`SELECT id FROM players WHERE profile_status='ok' OR profile_status IS NULL LIMIT ${LIMITS.players}`)) paths.push(`/player/${x.id}`);
  for (const x of all(`SELECT id FROM matches ORDER BY start_date DESC LIMIT ${LIMITS.matches}`)) paths.push(`/match/${x.id}`);

  const report = []; const sitemap = [];
  for (const p of paths) {
    const mt = metaForPath(S, F, p, SITE_URL, site); if (!mt) continue;
    mt.canonical = p;
    const depth = p === '/' ? 0 : p.split('/').length - 1;
    const dir = path.join(OUT, ...p.split('/').filter(Boolean).map((s) => decodeURIComponent(s)));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(tpl, mt, p, { depth }));
    report.push({ path: p, title: mt.title, description: mt.description, canonical: SITE_URL + p, robots: mt.robots, h1: mt.h1 });
    if (!/noindex/.test(mt.robots || '')) sitemap.push(`<url><loc>${esc(SITE_URL + p)}</loc></url>`);
  }
  const basePath = SITE_URL ? new URL(SITE_URL + '/').pathname : '/';
  fs.writeFileSync(path.join(OUT, '404.html'), page(tpl, { title: `Страница не найдена | ${site}`, description: 'Такой страницы нет или она была удалена.', robots: 'noindex, follow' }, '/404', { notFound: true, basePath }));
  if (SITE_URL) {
    fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join('\n')}\n</urlset>\n`);
    fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nDisallow: ${basePath}admin\nDisallow: ${basePath}search\nDisallow: ${basePath}settings\nDisallow: ${basePath}data/\nAllow: ${basePath}\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  }
  fs.writeFileSync(path.join(OUT, 'seo-report.json'), JSON.stringify(report));
  db.close();
  console.log(`Предгенерировано страниц: ${report.length}, в sitemap: ${sitemap.length}${SITE_URL ? '' : ' (SITE_URL не задан — canonical и sitemap не созданы)'}`);
})().catch((e) => { console.error(e); process.exit(1); });
