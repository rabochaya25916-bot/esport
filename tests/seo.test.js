// Часть 3: SEO-шаблоны, проверка дублей, серверные метатеги, предгенерация.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { openDb } = require('../src/database/db');
const { createApp } = require('../server');

const T = import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../assets/js/seo-templates.js'), 'utf8')));

test('игрок: шаблон из ТЗ при полном наборе данных', async () => {
  const { player } = await T;
  const m = player('CyberLeague', { nickname: 'magixx', real_name: 'Борис Воробьёв', country: 'Россия', birthday: '2003-06-03', team: 'Spirit', game: 'cs2', has_config: true, has_crosshair: true, matches_count: 10, path: '/player/1' });
  assert.equal(m.title, 'magixx — статистика, прицел, биография и настройки CS2 | CyberLeague');
  assert.equal(m.robots, 'index, follow');
});

test('игрок без конфига и прицела: не обещаем их', async () => {
  const { player } = await T;
  const m = player('CyberLeague', { nickname: 'nobody', team: 'X', game: 'cs2', matches_count: 3, path: '/player/2' });
  assert.equal(m.title, 'nobody — статистика CS2 | CyberLeague');
  assert.doesNotMatch(m.description, /прицел|настройки/);
});

test('матч: без выдуманного счёта у предстоящего, TBD — noindex', async () => {
  const { match } = await T;
  const up = match('CyberLeague', { t1: 'FURIA', t2: 'NAVI', s1: null, s2: null, status: 'upcoming', start_date: '2026-11-01T10:00:00Z', game: 'cs2', path: '/match/1' });
  assert.equal(up.title, 'FURIA — NAVI (01.11.2026): расписание и составы матча CS2 | CyberLeague');
  const fin = match('CyberLeague', { t1: 'Team Spirit', t2: 'FURIA', s1: 2, s2: 0, status: 'finished', start_date: '2026-10-20T10:00:00Z', game: 'cs2', path: '/match/3' });
  assert.equal(fin.title, 'Team Spirit — FURIA (20.10.2026): счёт и статистика матча CS2 | CyberLeague');
  const again = match('CyberLeague', { t1: 'Team Spirit', t2: 'FURIA', s1: 1, s2: 2, status: 'finished', start_date: '2026-10-25T10:00:00Z', game: 'cs2', path: '/match/4' });
  assert.notEqual(again.title, fin.title);
  assert.doesNotMatch(up.description, /\d:\d/); assert.doesNotMatch(up.description, /трансляц/i);
  assert.match(match('CyberLeague', { t1: null, t2: 'NAVI', status: 'upcoming', game: 'cs2', path: '/match/2' }).robots, /noindex/);
});

test('прицел без кода — страницы нет; турнир и каталоги по шаблону', async () => {
  const { crosshair, tournament, staticPage } = await T;
  assert.equal(crosshair('CyberLeague', { nickname: 'a' }, null), null);
  assert.equal(tournament('CyberLeague', { name: 'PGL Major', game: 'cs2', path: '/tournament/1' }).title, 'PGL Major — расписание, результаты матчей и команды | CyberLeague');
  assert.equal(staticPage('CyberLeague', '/configs').title, 'Конфиги CS2 — настройки профессиональных игроков | CyberLeague');
  assert.equal(staticPage('CyberLeague', '/crosshairs').title, 'Прицелы CS2 — коды и настройки прицелов игроков | CyberLeague');
});

test('проверка находит одинаковые title, пустые description и дубли canonical', async () => {
  const { auditPages } = await T;
  const r = auditPages([
    { path: '/a', title: 'X | S', description: 'd', canonical: '/a', h1: 'X' },
    { path: '/b', title: 'X | S', description: '', canonical: '/a', h1: 'X' },
    { path: '/c', title: 'Y | S', description: '', canonical: '/c', h1: 'Y', robots: 'noindex, follow' },
  ]);
  assert.ok(r.errors.some((e) => /Одинаковый title/.test(e)));
  assert.ok(r.errors.some((e) => /\/b: нет description/.test(e)));
  assert.ok(r.errors.some((e) => /Один canonical/.test(e)));
});

function seed(db) {
  const t = new Date().toISOString();
  db.prepare("INSERT INTO teams (source_id, game_code, slug, name, updated_at) VALUES (1,'cs2','furia','FURIA Esports',?),(2,'cs2','navi','Natus Vincere',?)").run(t, t);
  db.prepare("INSERT INTO players (source_id, game_code, team_source_id, slug, nickname, updated_at) VALUES (10,'cs2',1,'yuurih','yuurih',?)").run(t);
  db.prepare("INSERT INTO tournaments (source_id, game_code, slug, name, updated_at) VALUES (5,'cs2','major','PGL Major',?)").run(t);
  db.prepare("INSERT INTO matches (source_id, game_code, slug, status, start_date, tournament_source_id, updated_at) VALUES (100,'cs2','f-vs-n','finished',?,5,?)").run(t, t);
  const mid = db.prepare('SELECT id FROM matches').get().id;
  db.prepare('INSERT INTO match_teams (match_id, position, team_source_id, score) VALUES (?,1,1,2),(?,2,2,1)').run(mid, mid);
  return mid;
}

test('сервер: уникальные метатеги, JSON-LD, H1 без JavaScript, 404, sitemap с разделами CS2', async () => {
  const db = openDb(':memory:'); const mid = seed(db);
  const srv = createApp(db).listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const m = await (await fetch(`${base}/match/${mid}`)).text();
    assert.match(m, /<title>FURIA Esports — Natus Vincere \(\d\d\.\d\d\.\d{4}\): счёт и статистика матча CS2 \| CyberLeague<\/title>/);
    assert.match(m, /Матч завершён со счётом 2:1/); assert.match(m, /application\/ld\+json/); assert.match(m, /<h1>FURIA Esports — Natus Vincere<\/h1>/);
    assert.equal((m.match(/<meta property="og:title"/g) || []).length, 1);
    const tm = await (await fetch(`${base}/team/1`)).text();
    assert.match(tm, /<title>FURIA Esports — состав, статистика, турниры и игроки \| CyberLeague<\/title>/);
    assert.notEqual(tm.match(/<title>(.*)<\/title>/)[1], m.match(/<title>(.*)<\/title>/)[1]);
    assert.match(await (await fetch(`${base}/configs`)).text(), /<title>Конфиги CS2 — настройки профессиональных игроков \| CyberLeague<\/title>/);
    assert.equal((await fetch(`${base}/config/nobody`)).status, 404);
    assert.equal((await fetch(`${base}/crosshair/nobody`)).status, 404);
    assert.match(await (await fetch(`${base}/search?q=x`)).text(), /noindex/);
    const sm = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sm, /\/configs</); assert.match(sm, /\/crosshairs</); assert.match(sm, new RegExp(`/match/${mid}<`));
  } finally { srv.close(); }
});

test('предгенерация: отдельный HTML на страницу, sitemap, robots, отчёт без ошибок', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  const dbPath = path.join(dir, 'e.db'); const db = openDb(dbPath); seed(db); db.close();
  const out = path.join(dir, 'site');
  execFileSync('node', [path.join(__dirname, '../scripts/prerender.js'), out], { env: { ...process.env, DB_PATH: dbPath, SITE_URL: 'https://example.github.io/esports' } });
  const p = fs.readFileSync(path.join(out, 'player/1/index.html'), 'utf8');
  assert.match(p, /<title>yuurih — статистика CS2 \| CyberLeague<\/title>/);
  assert.match(p, /<link rel="canonical" href="https:\/\/example.github.io\/esports\/player\/1">/);
  assert.match(p, /src="\.\.\/\.\.\/assets\/js\/main.js"/);
  assert.match(fs.readFileSync(path.join(out, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/example.github.io\/esports\/sitemap.xml/);
  assert.match(fs.readFileSync(path.join(out, '404.html'), 'utf8'), /src="\/esports\/assets\/js\/main.js"/);
  execFileSync('node', [path.join(__dirname, '../scripts/seo-check.js'), path.join(out, 'seo-report.json')]);
});
