// Этап 4: безопасный Markdown, пароли, защита админ-API, статьи, поиск, главная, SEO, быстрая проверка live.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../src/database/db');
const { renderMarkdown } = require('../src/content/markdown');
const { hashPassword, verifyPassword, passwordProblem } = require('../src/auth/password');
const { createAdmin } = require('../src/admin/bootstrap');
const { runLiveSync } = require('../src/services/sync');
const { createApp } = require('../server');

const PASS = 'Test-Password-42';

async function start() {
  const db = openDb(':memory:');
  await createAdmin(db, 'editor', PASS);
  const t = new Date().toISOString();
  db.prepare("INSERT INTO teams (source_id, game_code, slug, name, rank, updated_at) VALUES (787,'cs2','natus-vincere','Natus Vincere',3,?), (667,'cs2','vitality','Vitality',1,?)").run(t, t);
  db.prepare("INSERT INTO tournaments (source_id, game_code, slug, name, source_status, start_date, updated_at) VALUES (1,'cs2','major','Test Major','current','2026-10-20',?)").run(t);
  const mk = (sid, status, start, s1, s2) => {
    const id = db.prepare('INSERT INTO matches (source_id, game_code, slug, status, start_date, tournament_source_id, bo_type, updated_at) VALUES (?,?,?,?,?,1,3,?)').run(sid, 'cs2', `m-${sid}`, status, start, t).lastInsertRowid;
    db.prepare('INSERT INTO match_teams VALUES (?,?,?,?), (?,?,?,?)').run(id, 1, 787, s1, id, 2, 667, s2);
    return Number(id);
  };
  mk(10, 'live', '2026-10-25T12:00:00Z', 1, 0); mk(11, 'finished', '2026-10-24T12:00:00Z', 2, 1); mk(12, 'upcoming', '2099-01-01T12:00:00Z', null, null);
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-up-'));
  const srv = createApp(db, { uploadsDir: uploads, loginMaxFails: 5 }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = ''; let csrf = '';
  const call = async (method, p, body, { auth = true, headers = {}, raw } = {}) => {
    const h = { ...headers }; if (auth && cookie) h.Cookie = cookie; if (auth && csrf && method !== 'GET') h['X-CSRF-Token'] = csrf;
    let b; if (raw) { b = raw; } else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers: h, body: b, redirect: 'manual' });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  const login = async () => {
    const r = await call('POST', '/api/admin/login', { username: 'editor', password: PASS }, { auth: false });
    assert.equal(r.status, 200);
    cookie = r.headers.get('set-cookie').split(';')[0]; csrf = r.body.csrf;
    return r;
  };
  return { db, srv, call, login, base, uploads, logout: () => { cookie = ''; csrf = ''; } };
}

test('Markdown: сырой HTML экранируется, опасные ссылки и картинки отбрасываются', () => {
  const { html } = renderMarkdown([
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[a](javascript:alert(1))', '[b](JaVaScRiPt:alert(1))', '[c](data:text/html,<b>x</b>)',
    '![d](javascript:alert(1))', '![e](data:image/png;base64,AAAA)', '[f](https://ok.example/"onmouseover="alert(1))', '![g](https://img.example/a.png "t\\" onerror=\\"x")',
  ].join('\n\n'));
  assert.ok(!/<script/i.test(html));
  for (const tag of html.match(/<(img|a)\b[^>]*>/g) || []) {
    const names = [...tag.matchAll(/\s([a-z-]+)="[^"]*"/g)].map((m) => m[1]);
    assert.ok(names.every((n) => ['src', 'alt', 'title', 'loading', 'referrerpolicy', 'href', 'target', 'rel'].includes(n)), 'лишние атрибуты: ' + tag);
    assert.equal(tag.replace(/\s[a-z-]+="[^"]*"/g, ''), tag.startsWith('<img') ? '<img>' : '<a>', 'атрибуты не разорваны: ' + tag);
  }
  assert.ok(!/href="(javascript|data):/i.test(html) && !/src="(javascript|data):/i.test(html));
  assert.ok(!/"\s*onmouseover=/i.test(html), 'кавычки в адресе не разрывают атрибут');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('Markdown: разметка гайда — заголовки с якорями, выноски, таблицы, списки, ссылки', () => {
  const { html, toc } = renderMarkdown('## Экономика\n\n> [!TIP]\n> Совет\n\n| A | B |\n|---|---:|\n| 1 | 2 |\n\n- [x] готово\n- пункт\n\n[сайт](https://example.com) и **жирный**');
  assert.match(html, /<h2 id="экономика">/);
  assert.match(html, /callout-tip/);
  assert.match(html, /<td class="al-right">2<\/td>/);
  assert.match(html, /<li class="task done">/);
  assert.match(html, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer nofollow">сайт<\/a>/);
  assert.deepEqual(toc.map((t) => t.text), ['Экономика']);
});

test('пароль: scrypt-хеш без открытого текста, проверка и требования', async () => {
  const h = await hashPassword(PASS);
  assert.match(h, /^scrypt\$32768\$8\$1\$/); assert.ok(!h.includes(PASS));
  assert.equal(await verifyPassword(PASS, h), true);
  assert.equal(await verifyPassword('wrong-password', h), false);
  assert.notEqual(await hashPassword(PASS), h, 'соль случайная');
  assert.ok(passwordProblem('short')); assert.ok(passwordProblem('1234567890123')); assert.equal(passwordProblem('Long-enough-pass'), null);
});

test('админ-API: без входа и без CSRF изменения запрещены; вход ограничен по попыткам', async () => {
  const s = await start();
  try {
    assert.equal((await s.call('POST', '/api/admin/posts', { title: 'Взлом' }, { auth: false })).status, 401);
    assert.equal((await s.call('DELETE', '/api/admin/posts/1', undefined, { auth: false })).status, 401);
    assert.equal((await s.call('GET', '/api/admin/overview', undefined, { auth: false })).status, 401);
    const bad = await s.call('POST', '/api/admin/login', { username: 'editor', password: 'nope-nope-nope' }, { auth: false });
    assert.equal(bad.status, 401); assert.equal(bad.headers.get('set-cookie'), null);
    const ok = await s.login();
    const sc = ok.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
    // сессия есть, но CSRF-токена нет → 403
    const cookie = sc.split(';')[0];
    const r = await fetch(s.base + '/api/admin/posts', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Без токена' }) });
    assert.equal(r.status, 403);
    // запрос с чужого сайта → 403
    assert.equal((await s.call('POST', '/api/admin/posts', { title: 'С чужого сайта' }, { headers: { Origin: 'https://evil.example' } })).status, 403);
    // в базе хранится только хеш токена
    const tok = decodeURIComponent(cookie.split('=')[1]);
    assert.equal(s.db.prepare('SELECT COUNT(*) c FROM admin_sessions WHERE token_hash=?').get(tok).c, 0);
    // блокировка после 5 неудачных попыток
    for (let i = 0; i < 5; i++) await s.call('POST', '/api/admin/login', { username: 'editor', password: 'wrong-' + i + '-xxxxx' }, { auth: false });
    assert.equal((await s.call('POST', '/api/admin/login', { username: 'editor', password: PASS }, { auth: false })).status, 429);
  } finally { s.srv.close(); }
});

test('статьи: черновик скрыт, публикация, отложенная дата, снятие, удаление, проверка данных', async () => {
  const s = await start();
  try {
    await s.login();
    const v = await s.call('POST', '/api/admin/posts', { title: 'ab', cover_url: 'javascript:alert(1)', kind: 'video' });
    assert.equal(v.status, 400); assert.ok(v.body.errors.title && v.body.errors.cover_url && v.body.errors.kind);
    const c = await s.call('POST', '/api/admin/posts', { title: 'Гайд по экономике', body_md: '## Раунды\n\nТекст <script>x</script>', kind: 'guide', game_code: 'cs2', tags: 'экономика, CS2', category_id: 3 });
    assert.equal(c.status, 201); assert.equal(c.body.status, 'draft'); assert.equal(c.body.slug, 'gayd-po-ekonomike');
    assert.ok(!c.body.body_html.includes('<script>'));
    const id = c.body.id;
    assert.equal((await s.call('GET', '/api/posts', undefined, { auth: false })).body.length, 0, 'черновик не виден публично');
    assert.equal((await s.call('GET', '/api/posts/gayd-po-ekonomike', undefined, { auth: false })).status, 404);
    assert.equal((await s.call('POST', `/api/admin/posts/${id}/publish`, {})).status, 200);
    const pub = await s.call('GET', '/api/posts/gayd-po-ekonomike', undefined, { auth: false });
    assert.equal(pub.status, 200); assert.equal(pub.body.body_md, undefined, 'исходник не отдаётся публично');
    assert.deepEqual(pub.body.tags.map((t) => t.name).sort(), ['CS2', 'экономика']);
    assert.equal((await s.call('GET', '/api/posts?tag=ekonomika', undefined, { auth: false })).body.length, 1);
    assert.equal((await s.call('GET', '/api/posts?category=guides&kind=guide', undefined, { auth: false })).body.length, 1);
    // отложенная публикация: дата в будущем — не видна
    await s.call('POST', `/api/admin/posts/${id}/publish`, { published_at: '2099-01-01T00:00:00Z' });
    assert.equal((await s.call('GET', '/api/posts', undefined, { auth: false })).body.length, 0);
    await s.call('POST', `/api/admin/posts/${id}/publish`, { published_at: '2020-01-01T00:00:00Z' });
    assert.equal((await s.call('GET', '/api/posts', undefined, { auth: false })).body.length, 1);
    // редактирование
    const u = await s.call('PUT', `/api/admin/posts/${id}`, { title: 'Гайд по экономике CS2', body_md: 'Новый текст' });
    assert.equal(u.body.title, 'Гайд по экономике CS2'); assert.match(u.body.body_html, /Новый текст/);
    // снятие с публикации
    await s.call('POST', `/api/admin/posts/${id}/unpublish`);
    assert.equal((await s.call('GET', '/api/posts', undefined, { auth: false })).body.length, 0);
    // удаление
    assert.equal((await s.call('DELETE', `/api/admin/posts/${id}`)).status, 200);
    assert.equal((await s.call('GET', `/api/admin/posts/${id}`)).status, 404);
    // выход завершает сессию
    await s.call('POST', '/api/admin/logout');
    assert.equal((await s.call('GET', '/api/admin/overview')).status, 401);
  } finally { s.srv.close(); }
});

test('загрузка обложек: только PNG/JPEG/WebP/GIF по сигнатуре файла', async () => {
  const s = await start();
  try {
    await s.login();
    const svg = await s.call('POST', '/api/admin/uploads', undefined, { raw: Buffer.from('<svg onload="alert(1)"></svg>'), headers: { 'Content-Type': 'image/svg+xml' } });
    assert.equal(svg.status, 400);
    const fake = await s.call('POST', '/api/admin/uploads', undefined, { raw: Buffer.from('<html>'), headers: { 'Content-Type': 'image/png' } });
    assert.equal(fake.status, 400);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    const ok = await s.call('POST', '/api/admin/uploads', undefined, { raw: png, headers: { 'Content-Type': 'image/png' } });
    assert.equal(ok.status, 201); assert.match(ok.body.url, /^\/uploads\/[\w-]+\.png$/);
    assert.ok(fs.existsSync(path.join(s.uploads, path.basename(ok.body.url))));
    s.logout();
    assert.equal((await s.call('POST', '/api/admin/uploads', undefined, { raw: png, headers: { 'Content-Type': 'image/png' } })).status, 401);
  } finally { s.srv.close(); }
});

test('поиск по всем разделам с фильтрами, главная и актуальность данных', async () => {
  const s = await start();
  try {
    await s.login();
    const p = await s.call('POST', '/api/admin/posts', { title: 'Разбор игры Natus Vincere', body_md: 'Текст' });
    await s.call('POST', `/api/admin/posts/${p.body.id}/publish`, {});
    const r = (await s.call('GET', '/api/search?q=natus', undefined, { auth: false })).body;
    assert.equal(r.teams.length, 1); assert.equal(r.matches.length, 3); assert.equal(r.posts.length, 1);
    const live = (await s.call('GET', '/api/search?q=natus&type=matches&status=live', undefined, { auth: false })).body;
    assert.deepEqual(live.matches.map((m) => m.status), ['live']); assert.equal(live.teams.length, 0);
    const dated = (await s.call('GET', '/api/search?q=vitality&type=matches&date_from=2026-10-24&date_to=2026-10-24', undefined, { auth: false })).body;
    assert.deepEqual(dated.matches.map((m) => m.status), ['finished']);
    assert.equal((await s.call('GET', '/api/search?q=n', undefined, { auth: false })).status, 400);
    assert.equal((await s.call('GET', '/api/search?q=natus&date_from=24.10.2026', undefined, { auth: false })).status, 400);
    assert.equal((await s.call('GET', '/api/matches?q=Test%20Major&status=finished', undefined, { auth: false })).body.length, 1);
    const h = (await s.call('GET', '/api/home?game=cs2', undefined, { auth: false })).body;
    assert.equal(h.live.length, 1); assert.equal(h.upcoming.length, 1); assert.equal(h.finished.length, 1);
    assert.equal(h.tournaments[0].live_count, 1); assert.equal(h.top_teams.cs2[0].name, 'Vitality'); assert.equal(h.posts.length, 1);
    // синхронизаций не было → данные помечены как устаревшие
    assert.equal(h.sync.stale, true); assert.equal(h.sync.last_success_at, null);
    s.db.prepare("INSERT INTO sync_runs (started_at, finished_at, status) VALUES (?,?, 'success')").run(new Date().toISOString(), new Date().toISOString());
    const f = (await s.call('GET', '/api/sync/freshness', undefined, { auth: false })).body;
    assert.equal(f.stale, false); assert.equal(f.source_ok, true);
    s.db.prepare("INSERT INTO sync_runs (started_at, finished_at, status) VALUES (?,?, 'failed')").run(new Date().toISOString(), new Date().toISOString());
    const f2 = (await s.call('GET', '/api/sync/freshness', undefined, { auth: false })).body;
    assert.equal(f2.source_ok, false); assert.ok(f2.last_success_at, 'сохранённые данные остаются доступными');
  } finally { s.srv.close(); }
});

test('SEO: уникальные заголовки, 404, noindex для админки, robots.txt, sitemap, текст статьи без JS', async () => {
  const s = await start();
  try {
    await s.login();
    const p = await s.call('POST', '/api/admin/posts', { title: 'Мой первый гайд', excerpt: 'Анонс гайда', body_md: '## Часть\n\nУникальный текст статьи' });
    await s.call('POST', `/api/admin/posts/${p.body.id}/publish`, {});
    s.logout();
    const team = s.db.prepare("SELECT id FROM teams WHERE source_id=787").get().id;
    const t = await s.call('GET', `/team/${team}`, undefined, { auth: false });
    assert.equal(t.status, 200); assert.match(t.body, /<title>Natus Vincere — (?:состав, )?статистика, турниры и игроки \| CyberLeague<\/title>/);
    assert.match(t.body, /<link rel="canonical" href="[^"]+\/team\/\d+">/);
    assert.equal((await s.call('GET', '/team/999999', undefined, { auth: false })).status, 404);
    assert.equal((await s.call('GET', '/no-such-page', undefined, { auth: false })).status, 404);
    const a = await s.call('GET', '/articles/moy-pervyy-gayd', undefined, { auth: false });
    assert.match(a.body, /<title>Мой первый гайд \| CyberLeague<\/title>/); assert.match(a.body, /Уникальный текст статьи/);
    assert.match(a.body, /<meta name="description" content="Анонс гайда">/);
    const adm = await s.call('GET', '/admin/posts', undefined, { auth: false });
    assert.equal(adm.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.match(adm.body, /noindex, nofollow/);
    assert.equal((await s.call('GET', '/api/admin/session', undefined, { auth: false })).headers.get('x-robots-tag'), 'noindex, nofollow');
    const rb = await s.call('GET', '/robots.txt', undefined, { auth: false });
    assert.match(rb.body, /Disallow: \/admin/); assert.match(rb.body, /Sitemap: /);
    const sm = await s.call('GET', '/sitemap.xml', undefined, { auth: false });
    assert.match(sm.body, /\/articles\/moy-pervyy-gayd/); assert.ok(!/\/admin/.test(sm.body));
    assert.match(t.headers.get('content-security-policy'), /script-src 'self'/);
  } finally { s.srv.close(); }
});

test('быстрая проверка текущих матчей: только /matches/current и страницы live, запись kind=live', async () => {
  const db = openDb(':memory:');
  const t = new Date().toISOString();
  db.prepare("INSERT INTO matches (source_id, game_code, slug, status, start_date, updated_at) VALUES (1,'cs2','a-vs-b','live',?,?)").run(t, t);
  const calls = [];
  const fetcher = async (url) => { const p = url.replace('https://bo3.gg', ''); calls.push(p); if (p === '/robots.txt') return 'User-agent: *\nDisallow: /api/'; return '<html><script>window.__NUXT__={data:{}}</script></html>'; };
  const r = await runLiveSync(db, { fetcher, delayMs: 0, base: 'https://bo3.gg' });
  assert.equal(r.kind, 'live');
  assert.deepEqual(calls.filter((c) => c !== '/robots.txt' && !c.includes('a-vs-b')).sort(), ['/dota2/matches/current', '/lol/matches/current', '/matches/current']);
  assert.ok(calls.includes('/matches/a-vs-b'));
  assert.equal(db.prepare('SELECT kind FROM sync_runs ORDER BY id DESC').get().kind, 'live');
  assert.ok(!calls.some((c) => c.startsWith('/api/')));
});

test('сайт на другом домене: токен только для разрешённого Origin, Bearer без CSRF, CORS-preflight', async () => {
  const db = openDb(':memory:'); await createAdmin(db, 'editor', PASS);
  const srv = createApp(db, { corsOrigins: ['https://kotakniga.ru'] }).listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const login = (origin) => fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ username: 'editor', password: PASS }) });
    assert.equal((await login('https://evil.example')).status, 403);
    const r = await login('https://kotakniga.ru'); const body = await r.json();
    assert.equal(r.status, 200); assert.ok(body.token && body.token.length > 20);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://kotakniga.ru');
    const same = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'editor', password: PASS }) });
    assert.equal((await same.json()).token, undefined, 'без стороннего Origin токен в теле не отдаётся');
    const pre = await fetch(base + '/api/admin/posts', { method: 'OPTIONS', headers: { Origin: 'https://kotakniga.ru', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
    const c = await fetch(base + '/api/admin/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://kotakniga.ru', Authorization: 'Bearer ' + body.token }, body: JSON.stringify({ title: 'Через токен' }) });
    assert.equal(c.status, 201);
    const bad = await fetch(base + '/api/admin/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + 'x'.repeat(40) }, body: JSON.stringify({ title: 'Чужой токен' }) });
    assert.equal(bad.status, 401);
    const pub = await fetch(base + '/api/home', { headers: { Origin: 'https://kotakniga.ru' } });
    assert.equal(pub.headers.get('access-control-allow-origin'), 'https://kotakniga.ru');
    const other = await fetch(base + '/api/home', { headers: { Origin: 'https://evil.example' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
    // страницы через Node: абсолютные пути к файлам и признак режима History
    const html = await (await fetch(base + '/matches')).text();
    assert.match(html, /href="\/assets\/styles.css"/); assert.match(html, /src="\/assets\/js\/main.js"/); assert.match(html, /name="eh-server"/);
  } finally { srv.close(); }
});

test('миграции хранятся в .js (хостинг не принимает .sql) и записываются под прежними именами', () => {
  const fsx = require('fs');
  const files = fsx.readdirSync(path.join(__dirname, '..', 'migrations'));
  assert.ok(files.length >= 4 && files.every((f) => f.endsWith('.js')));
  const db = openDb(':memory:');
  assert.deepEqual(db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((x) => x.name), ['001_init.sql', '002_match_details.sql', '003_profiles.sql', '004_posts_admin.sql']);
});
