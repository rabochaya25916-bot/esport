// Этап 2: разбор подробных страниц матчей, связи, повторная синхронизация, миграции и API.
// Фикстуры — урезанные реальные состояния страниц BO3.GG (25.10.2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { extractMatchDetails, isFinal } = require('../src/parser/details');
const { openDb, migrate } = require('../src/database/db');
const { makeRepo } = require('../src/database/repository');
const { runSync } = require('../src/services/sync');
const { createApp } = require('../server');

const BASE = 'https://bo3.gg';
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n + '.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const count = (db, t, w = '') => db.prepare(`SELECT COUNT(*) c FROM ${t} ${w}`).get().c;

test('CS2: карты, половины, раунды, состав и статистика игроков из реальной страницы', () => {
  const d = extractMatchDetails(fx('cs2_match'), 'cs2', BASE);
  assert.equal(d.match.source_id, 132225);
  assert.equal(d.match.parsed_status, 'done');
  assert.equal(d.games.length, 2);
  const inferno = d.games.find((g) => g.map_name === 'de_inferno');
  assert.equal(inferno.winner_score, 13); assert.equal(inferno.loser_score, 6);
  assert.equal(inferno.rounds.length, 19);
  assert.equal(inferno.rounds[0].winner_side, 'T');
  assert.equal(inferno.sides.length, 2);
  const zywoo = d.playerStats.find((p) => p.scope === 0 && p.nickname === 'ZywOo');
  assert.equal(zywoo.kills, 35); assert.equal(zywoo.deaths, 16); assert.equal(zywoo.assists, 16);
  assert.equal(Math.round(zywoo.adr * 10) / 10, 116.1);
  assert.equal(d.lineup.length, 10);
  assert.equal(isFinal(d), true);
});

test('Dota 2 и LoL разбираются по своей структуре (герои / чемпионы)', () => {
  const dota = extractMatchDetails(fx('dota2_match'), 'dota2', BASE);
  const lol = extractMatchDetails(fx('lol_match'), 'lol', BASE);
  const dp = dota.playerStats.find((p) => p.nickname === 'miCKe');
  assert.equal(dp.hero, 'Tiny'); assert.equal(dp.last_hits, 340); assert.equal(dp.gold_per_min, 657); assert.equal(dp.adr, null);
  assert.ok(dota.teamStats.some((t) => t.side === 'Radiant'));
  const lp = lol.playerStats.find((p) => p.nickname === 'CoreJJ');
  assert.equal(lp.hero, 'Karma'); assert.equal(lp.role, 'sup'); assert.equal(lp.last_hits, null);
  assert.equal(dota.games.every((g) => g.map_name === null && g.rounds.length === 0), true);
  // игра без статистики в Dota 2 остаётся без выдуманных значений
  const noStats = dota.games.find((g) => g.state === 'no_stats');
  assert.equal(noStats.winner_score, null);
  assert.equal(dota.playerStats.filter((p) => p.scope === noStats.source_id).length, 0);
});

test('Отсутствующие поля не ломают разбор и не подменяются значениями', () => {
  const d = extractMatchDetails({ pinia: { matches: { match: { id: 5, slug: 'x', status: 'upcoming' } } } }, 'cs2', BASE);
  assert.equal(d.games.length, 0); assert.equal(d.playerStats.length, 0); assert.equal(d.lineup.length, 0);
  assert.equal(d.match.teams[0].score, null);
  assert.throws(() => extractMatchDetails({ pinia: {} }, 'cs2', BASE), /нет данных матча/);
  const waiting = extractMatchDetails(fx('cs2_match_waiting'), 'cs2', BASE);
  assert.equal(waiting.playerStats.length, 0);
  assert.equal(isFinal(waiting), false);
});

test('Повторная синхронизация: без дублей, данные не теряются, история только при изменении', () => {
  const db = openDb(':memory:'); const repo = makeRepo(db);
  const d = extractMatchDetails(fx('cs2_match'), 'cs2', BASE);
  repo.saveDetails(d, { final: true });
  const before = ['match_games', 'match_rounds', 'match_player_stats', 'match_lineups', 'matches', 'teams'].map((t) => count(db, t));
  repo.saveDetails(extractMatchDetails(fx('cs2_match'), 'cs2', BASE), { final: true });
  assert.deepEqual(['match_games', 'match_rounds', 'match_player_stats', 'match_lineups', 'matches', 'teams'].map((t) => count(db, t)), before);
  assert.equal(count(db, 'match_snapshots'), 1);

  // источник временно не отдал статистику — сохранённые значения остаются
  const partial = clone(d); partial.playerStats = partial.playerStats.map((p) => ({ ...p, kills: null, adr: null }));
  repo.saveDetails(partial, { final: false });
  assert.equal(db.prepare("SELECT kills FROM match_player_stats WHERE nickname='ZywOo' AND scope_game_id=0").get().kills, 35);
  assert.equal(count(db, 'match_snapshots'), 1);

  // изменился счёт — появляется новая запись истории
  const changed = clone(d); changed.match.teams[1].score = 1;
  repo.saveDetails(changed, { final: false });
  assert.equal(count(db, 'match_snapshots'), 2);
  // связи: статистика ссылается на матч и карту
  assert.equal(count(db, 'match_player_stats s', 'LEFT JOIN match_games g ON g.id=s.scope_game_id WHERE s.scope_game_id<>0 AND g.id IS NULL'), 0);
});

test('Миграция поверх базы этапа 1 сохраняет старые данные', () => {
  const file = path.join(require('os').tmpdir(), `eh-mig-${process.pid}.db`); fs.rmSync(file, { force: true });
  const old = new Database(file);
  old.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  old.exec(require(path.join(__dirname, '..', 'migrations', '001_init.js')));
  old.prepare("INSERT INTO schema_migrations VALUES ('001_init.sql', 'x')").run();
  old.prepare("INSERT INTO matches (source_id, game_code, slug, status, updated_at) VALUES (1,'cs2','old','finished','x')").run();
  old.close();
  const db = openDb(file);
  assert.equal(db.prepare("SELECT slug FROM matches WHERE source_id=1").get().slug, 'old');
  assert.equal(db.prepare("SELECT details_attempts FROM matches WHERE source_id=1").get().details_attempts, 0);
  migrate(db); // повторный запуск безопасен
  db.close(); fs.rmSync(file, { force: true });
});

test('Сбой одной страницы матча не прерывает синхронизацию, журнал показывает результат', async () => {
  const db = openDb(':memory:');
  const page = (state) => `<html><script>window.__NUXT__=${JSON.stringify(state)}</script></html>`;
  const listState = { data: { list: [
    { id: 132225, slug: 'vitality-vs-the-mongolz-25-10-2026', status: 'finished', start_date: '2026-10-25T09:50:00Z', team1_id: 667, team2_id: 736, team1_score: 2, team2_score: 0 },
    { id: 999, slug: 'broken-match', status: 'finished', start_date: '2026-10-25T08:00:00Z', team1_id: 1, team2_id: 2 },
  ] } };
  const fetcher = async (url) => {
    if (url.endsWith('/robots.txt')) return 'User-agent: *\nDisallow: /api/';
    if (url === BASE + '/matches/finished') return page(listState);
    if (url.endsWith('/matches/vitality-vs-the-mongolz-25-10-2026')) return page(fx('cs2_match'));
    if (url.endsWith('/matches/broken-match')) throw new Error('HTTP 500');
    return page({ data: {} });
  };
  const r = await runSync(db, { fetcher, delayMs: 0, base: BASE });
  assert.equal(r.status, 'partial');
  assert.equal(r.details_ok, 1); assert.equal(r.details_failed, 1);
  assert.ok(count(db, 'match_player_stats') > 0);
  const pages = db.prepare("SELECT ok, summary_json FROM sync_pages WHERE kind='match'").all();
  assert.equal(pages.length, 2);
  assert.ok(pages.some((p) => p.ok === 1 && JSON.parse(p.summary_json).player_stats > 0));
  assert.equal(db.prepare("SELECT details_status FROM matches WHERE slug='broken-match'").get().details_status, 'failed');
  // окончательно разобранный матч больше не перезапрашивается
  const again = await runSync(db, { fetcher, delayMs: 0, base: BASE });
  assert.equal(again.details_ok, 0);
});

test('API отдаёт детали матча, статистику, составы и историю', async () => {
  const db = openDb(':memory:'); makeRepo(db).saveDetails(extractMatchDetails(fx('cs2_match'), 'cs2', BASE), { final: true });
  makeRepo(db).saveDetails(extractMatchDetails(fx('cs2_match_waiting'), 'cs2', BASE), { final: false });
  const srv = createApp(db).listen(0); const url = `http://127.0.0.1:${srv.address().port}/api`;
  try {
    const id = db.prepare('SELECT id FROM matches WHERE source_id=132225').get().id;
    const full = await (await fetch(`${url}/matches/${id}/full`)).json();
    assert.equal(full.games.length, 2); assert.equal(full.lineups.length, 10); assert.ok(full.player_stats.length >= 10);
    assert.equal(full.history.total, 1);
    const stats = await (await fetch(`${url}/matches/${id}/stats?game_id=0`)).json();
    assert.equal(stats.players.length, 10);
    assert.equal((await fetch(`${url}/matches/${id}/stats?game_id=abc`)).status, 400);
    const games = await (await fetch(`${url}/matches/${id}/games`)).json();
    assert.equal(games.reduce((s, g) => s + g.rounds.length, 0), 35);
    const pid = db.prepare("SELECT id FROM players WHERE nickname='ZywOo'").get().id;
    const mine = await (await fetch(`${url}/matches/${id}/players/${pid}`)).json();
    assert.equal(mine.find((x) => x.scope_game_id === 0).kills, 35);
    const wid = db.prepare('SELECT id FROM matches WHERE source_id=132745').get().id;
    const w = await (await fetch(`${url}/matches/${wid}/full`)).json();
    assert.equal(w.player_stats.length, 0);
    const list = await fetch(`${url}/matches?limit=1&offset=1`);
    assert.equal(list.headers.get('x-total-count'), '2'); assert.equal((await list.json()).length, 1);
    assert.equal((await fetch(`${url}/matches/999999/full`)).status, 404);
  } finally { srv.close(); }
});

test('Текущий матч CS2: состав в формате { id, player: {...} } и карты из самого матча', () => {
  const state = { pinia: { matches: { match: { id: 7, slug: 'live', status: 'current', team1_id: 1, team2_id: 2, team1_score: 0, team2_score: 1,
    games: [{ id: 70, number: 1, map_name: 'de_cache', status: 'finished' }, { id: 71, number: 2, map_name: 'de_inferno', status: 'current' }] },
    lineup: { 1: [{ id: 11, slug: 'a', player: { slug: 'a', nickname: 'A', country: { code: 'UA' } } }] } }, games: { games: { results: [] } } } };
  const d = extractMatchDetails(state, 'cs2', BASE);
  assert.equal(d.match.status, 'live');
  assert.deepEqual(d.lineup.map((x) => [x.player_source_id, x.nickname, x.country_code]), [[11, 'A', 'UA']]);
  assert.deepEqual(d.games.map((g) => [g.number, g.status, g.winner_score]), [[1, 'finished', null], [2, 'current', null]]);
});
