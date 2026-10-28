// Этап 3: профили команд/игроков/турниров, составы и трансферы, рейтинги, связи, API.
// Фикстуры — урезанные реальные состояния страниц BO3.GG (октябрь 2026).
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { openDb } = require('../src/database/db');
const P = require('../src/parser/profiles');
const { makeProfileRepo } = require('../src/database/profiles-repo');
const { runSync } = require('../src/services/sync');
const api = require('../src/routes/api');

const BASE = 'https://bo3.gg';
const fx = (n) => JSON.parse(JSON.stringify(require('./fixtures/' + n)));
const html = (state) => `<html><body><script>window.__NUXT__=${JSON.stringify(state)}</script></body></html>`;

test('команда: профиль, состав, трансферы источника, статистика, логотип', () => {
  const d = P.parseTeamState(fx('team_page.json'), 'cs2', BASE);
  assert.equal(d.team.source_id, 787);
  assert.equal(d.team.name, 'Natus Vincere');
  assert.equal(d.team.acronym, 'NAVI');
  assert.match(d.team.image_url, /^https:\/\/files\.bo3\.gg\/uploads\/team\/787\//);
  assert.ok(d.roster.length >= 5 && d.roster.every((p) => p.team_source_id === 787));
  assert.ok(d.general_stats && d.general_stats.matches_count > 0);
  const leave = d.transfers.find((t) => t.source_ref === '251807');
  assert.equal(leave.change_type, 'leave');
  assert.equal(leave.event_date, '2026-07-01');
  assert.equal(leave.to_team_source_id, null);
});

test('игрок: профиль, текущая команда, история переходов', () => {
  const d = P.parsePlayerState(fx('player_page.json'), 'cs2', BASE);
  assert.equal(d.player.nickname, 's1mple');
  assert.equal(d.player.birthday, '1997-10-02');
  assert.equal(d.team.source_id, 10844);
  const mv = d.transfers.find((t) => t.source_ref === '146902');
  assert.deepEqual([mv.change_type, mv.from_team_source_id, mv.to_team_source_id, mv.event_date], ['move', 787, 10844, '2025-07-28']);
});

test('турнир: участники, места, стадии и сетка, статистика игроков', () => {
  const d = P.parseTournamentState(fx('tournament_page.json'), 'cs2', BASE);
  assert.equal(d.tournament.prize, 776000);
  assert.equal(d.tournament.source_status, 'finished');
  assert.equal(d.participants.find((p) => p.team_source_id === 787).place, '1st');
  const qf = d.stages[0].rounds.find((r) => r.name === 'Quarterfinal');
  assert.equal(qf.matches.length, 4);
  const gf = d.stages[0].rounds.find((r) => r.name === 'Grand final').matches[0];
  assert.equal(gf.team1_source_id != null && gf.team2_source_id != null, true);
  assert.ok(qf.matches.every((m) => m.position != null), 'позиция матча в сетке из источника');
  assert.ok(d.player_stats.length > 0 && d.player_stats[0].rating != null);
});

test('рейтинг Valve и список турниров', () => {
  const r = P.parseValveRankingState(fx('valve_ranking.json'), 'cs2', BASE);
  assert.equal(r.rows[0].position, 1);
  assert.equal(r.rows[0].team_source_id, 667);
  assert.ok(r.available_dates.length > 5);
  const l = P.parseTournamentListState(fx('tournaments_list_dota2.json'), 'dota2', BASE);
  assert.ok(l.tournaments.length > 0 && l.tournaments.every((t) => t.game_code === 'dota2'));
});

test('снимки состава: первый снимок без изменений, затем обнаруженные изменения без даты события', () => {
  const db = openDb(':memory:'); const repo = makeProfileRepo(db);
  const s1 = fx('team_page.json');
  const c1 = repo.saveTeamProfile(P.parseTeamState(s1, 'cs2', BASE));
  assert.equal(c1.detected_changes, 0);
  const s2 = fx('team_page.json');
  const removed = s2.pinia.teams.team.players.shift();
  s2.pinia.teams.team.players.push({ id: 999001, slug: 'newguy', nickname: 'newguy', team_id: 787, is_coach: false });
  const c2 = repo.saveTeamProfile(P.parseTeamState(s2, 'cs2', BASE));
  assert.equal(c2.detected_changes, 2);
  const det = db.prepare("SELECT * FROM roster_changes WHERE source_kind='detected' ORDER BY change_type").all();
  assert.deepEqual(det.map((x) => x.change_type), ['joined_detected', 'left_detected']);
  assert.ok(det.every((x) => x.event_date === null && x.detected_at), 'дата события не подменяется временем обнаружения');
  assert.equal(det.find((x) => x.change_type === 'left_detected').player_source_id, removed.id);
  // ушедший игрок отвязан от команды, повторное сохранение не создаёт дублей
  assert.equal(db.prepare('SELECT team_source_id FROM players WHERE source_id=?').get(removed.id).team_source_id, null);
  assert.equal(repo.saveTeamProfile(P.parseTeamState(s2, 'cs2', BASE)).detected_changes, 0);
  const n = db.prepare("SELECT COUNT(*) c FROM roster_changes WHERE source_kind='source'").get().c;
  repo.saveTeamProfile(P.parseTeamState(s2, 'cs2', BASE));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM roster_changes WHERE source_kind='source'").get().c, n);
});

test('одинаковые никнеймы разных игроков не объединяются', () => {
  const db = openDb(':memory:'); const repo = makeProfileRepo(db);
  const a = fx('team_page.json'); a.pinia.teams.team.players = [{ id: 1, slug: 'x-1', nickname: 'Same', team_id: 787, is_coach: false }];
  repo.saveTeamProfile(P.parseTeamState(a, 'cs2', BASE));
  const b = fx('team_page.json'); b.pinia.teams.team.id = 5555; b.pinia.teams.team.slug = 'other'; b.pinia.teams.team.players = [{ id: 2, slug: 'x-2', nickname: 'Same', team_id: 5555, is_coach: false }];
  repo.saveTeamProfile(P.parseTeamState(b, 'cs2', BASE));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM players WHERE nickname='Same'").get().c, 2);
});

function fakeSource(overrides = {}) {
  const pages = {
    '/teams/natus-vincere': () => html(fx('team_page.json')),
    '/players/s1mple': () => html(fx('player_page.json')),
    '/tournaments/esl-pro-league-season-23': () => html(fx('tournament_page.json')),
    '/dota2/tournaments/current': () => html(fx('tournaments_list_dota2.json')),
    '/teams/valve-rankings/world': () => html(fx('valve_ranking.json')),
    ...overrides,
  };
  const calls = [];
  const fetcher = async (url) => {
    const path = url.replace(BASE, ''); calls.push(path);
    if (path === '/robots.txt') return 'User-agent: *\nDisallow: /api/\nDisallow: */matches/*/*/*';
    if (pages[path]) return pages[path]();
    if (/\/(teams|players|tournaments)\/[^/]+$/.test(path) && !/current$/.test(path)) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
    return html({ data: {} });
  };
  return { fetcher, calls };
}
const seed = (db) => {
  const t = new Date().toISOString();
  db.prepare("INSERT INTO teams (source_id, game_code, slug, name, updated_at) VALUES (787,'cs2','natus-vincere','Natus Vincere',?)").run(t);
  db.prepare("INSERT INTO players (source_id, game_code, slug, nickname, updated_at) VALUES (17541,'cs2','s1mple','s1mple',?)").run(t);
  db.prepare("INSERT INTO tournaments (source_id, game_code, slug, name, updated_at) VALUES (4550,'cs2','esl-pro-league-season-23','EPL S23',?)").run(t);
};

test('синхронизация профилей: сбой одной страницы не останавливает остальные, 404 → missing', async () => {
  const db = openDb(':memory:'); seed(db);
  const { fetcher, calls } = fakeSource();
  const r = await runSync(db, { fetcher, delayMs: 0, base: BASE, detailLimit: 0, profileLimit: 200, profileTtlHours: 24, profileMaxAttempts: 3 });
  assert.equal(r.status, 'partial');
  assert.ok(r.profiles_ok >= 3);
  assert.equal(db.prepare("SELECT profile_status FROM teams WHERE source_id=787").get().profile_status, 'ok');
  assert.equal(db.prepare("SELECT profile_status FROM players WHERE source_id=17541 AND game_code='cs2'").get().profile_status, 'ok');
  assert.equal(db.prepare("SELECT profile_status FROM tournaments WHERE source_id=4550").get().profile_status, 'ok');
  assert.equal(db.prepare("SELECT profile_status FROM teams WHERE source_id=667").get().profile_status, 'missing'); // Vitality из рейтинга — в фейковом источнике 404
  assert.ok(db.prepare("SELECT COUNT(*) c FROM rankings WHERE kind='valve'").get().c >= 8);
  assert.ok(!calls.some((c) => c.startsWith('/api/')), 'закрытый /api/ не запрашивается');
  // повтор: недоступные страницы не запрашиваются снова, актуальные профили не перезагружаются (TTL)
  const before = calls.length;
  await runSync(db, { fetcher, delayMs: 0, base: BASE, detailLimit: 0, profileLimit: 200, profileTtlHours: 24 });
  const second = calls.slice(before);
  assert.ok(!second.includes('/teams/vitality') && !second.includes('/teams/natus-vincere'));
});

test('API: каталоги с пагинацией, профили и связи по id', async () => {
  const db = openDb(':memory:'); seed(db);
  const { fetcher } = fakeSource();
  await runSync(db, { fetcher, delayMs: 0, base: BASE, detailLimit: 0, profileLimit: 200 });
  const app = express(); app.use('/api', api(db));
  const srv = app.listen(0); const port = srv.address().port;
  const get = async (p) => { const r = await fetch(`http://127.0.0.1:${port}/api${p}`); return { status: r.status, total: r.headers.get('x-total-count'), body: await r.json() }; };
  try {
    const list = await get('/teams?game=cs2&sort=rank&limit=5&offset=0');
    assert.equal(list.status, 200); assert.ok(Number(list.total) > 5); assert.equal(list.body.length, 5);
    const navi = (await get('/teams?q=NAVI')).body.find((t) => t.source_id === 787);
    const team = (await get('/teams/' + navi.id)).body;
    assert.ok(team.roster.length >= 5 && team.roster.every((p) => p.id));
    assert.ok(team.roster_changes.some((c) => c.source_kind === 'source'));
    assert.ok(team.tournaments.some((t) => t.place === '1st'));
    assert.ok(team.general_stats && team.recent.length + team.upcoming.length > 0);
    // Команда → игрок → профиль игрока
    const pl = (await get('/players/' + team.roster[0].id)).body;
    assert.equal(pl.team.id, navi.id);
    // Игрок → история команд
    const s1 = (await get('/players?q=s1mple&game=cs2')).body[0];
    const prof = (await get('/players/' + s1.id)).body;
    assert.ok(prof.previous_teams.some((t) => t.id === navi.id));
    // Турнир → сетка → матч → команда
    const tour = (await get('/tournaments?q=ESL Pro League Season 23')).body[0];
    const td = (await get('/tournaments/' + tour.id)).body;
    const m = td.stages[0].rounds[0].matches[0].match;
    assert.ok(m && m.id && m.teams[0].id);
    assert.equal((await get('/matches/' + m.id)).body.tournament.id, tour.id);
    const rk = (await get('/rankings?game=cs2')).body;
    assert.equal(rk.kind, 'valve'); assert.equal(rk.rows[0].position, 1);
    const cmp = (await get(`/compare/teams?a=${navi.id}&b=${td.participants[1].team.id}`)).body;
    assert.ok(cmp.source.length && cmp.derived.length);
    assert.equal((await get('/teams?sort=bogus')).status, 400);
    assert.equal((await get('/transfers?kind=source&limit=3')).body.length, 3);
  } finally { srv.close(); }
});
