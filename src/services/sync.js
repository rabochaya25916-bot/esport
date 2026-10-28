const cfg = require('../config');
const bo3 = require('../parser/bo3');
const details = require('../parser/details');
const { makeRepo } = require('../database/repository');
const profiles = require('../parser/profiles');
const { makeProfileRepo } = require('../database/profiles-repo');
const { fetchText, sleep } = require('./http');
const cache = require('./cache');

let running = false; // защита от параллельных синхронизаций

// Какие матчи разбирать подробно в этом цикле:
//  - все текущие (live) — чтобы фиксировать изменения счёта/статуса;
//  - завершённые без окончательной статистики — повторная проверка, пока источник не закончит разбор
//    (не более detailMaxAttempts попыток на матч).
function detailCandidates(db, { limit, maxAttempts }) {
  return db.prepare(`SELECT id, game_code, slug FROM matches
    WHERE slug IS NOT NULL AND (status='live' OR (status='finished' AND COALESCE(details_status,'') <> 'final' AND details_attempts < ?))
    ORDER BY CASE status WHEN 'live' THEN 0 ELSE 1 END, details_attempts ASC, start_date DESC LIMIT ?`).all(maxAttempts, limit);
}

async function runSync(db, { fetcher = fetchText, delayMs = cfg.requestDelayMs, base = cfg.sourceBase,
  detailLimit = cfg.detailLimit, detailMaxAttempts = cfg.detailMaxAttempts,
  profileLimit = cfg.profileLimit, profileTtlHours = cfg.profileTtlHours, profileMaxAttempts = cfg.profileMaxAttempts, profiles: withProfiles = true } = {}) {
  if (running) return { skipped: true, reason: 'Синхронизация уже выполняется' };
  running = true;
  const now = () => new Date().toISOString();
  const runId = db.prepare("INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')").run(now()).lastInsertRowid;
  const logErr = (url, msg) => db.prepare('INSERT INTO sync_errors (run_id, created_at, url, message) VALUES (?,?,?,?)').run(runId, now(), url, String(msg).slice(0, 1000));
  const logPage = (url, kind, ok, summary) => db.prepare('INSERT INTO sync_pages (run_id, created_at, url, kind, ok, summary_json) VALUES (?,?,?,?,?,?)')
    .run(runId, now(), url, kind, ok ? 1 : 0, summary ? JSON.stringify(summary) : null);
  const repo = makeRepo(db);
  const tot = { pages_ok: 0, pages_failed: 0, matches: 0, teams: 0, players: 0, tournaments: 0, articles: 0,
    details_ok: 0, details_failed: 0, games: 0, player_stats: 0, snapshots: 0, profiles_ok: 0, profiles_failed: 0, roster_changes: 0 };
  const prepo = makeProfileRepo(db);
  try {
    let rules;
    try { rules = bo3.parseRobots(await fetcher(`${base}/robots.txt`)); }
    catch (e) { throw new Error('Не удалось прочитать robots.txt — синхронизация отменена: ' + e.message); }

    // 1) Списки матчей и новости
    for (const p of bo3.syncPages()) {
      const url = base + p.path;
      if (!bo3.robotsAllows(rules, p.path)) { logErr(url, 'Запрещено robots.txt — пропущено'); logPage(url, 'list', false, { error: 'robots.txt' }); tot.pages_failed++; continue; }
      try {
        const data = bo3.extractFromHtml(await fetcher(url), p.game, base);
        const c = repo.saveBatch(data);
        for (const k of ['matches', 'teams', 'players', 'tournaments', 'articles']) tot[k] += c[k];
        tot.snapshots += c.snapshots;
        tot.pages_ok++; logPage(url, 'list', true, c);
      } catch (e) { logErr(url, e.message); logPage(url, 'list', false, { error: e.message }); tot.pages_failed++; }
      if (delayMs) await sleep(delayMs);
    }

    // 2) Подробные страницы матчей. Сбой одной страницы не прерывает обработку остальных.
    for (const m of detailCandidates(db, { limit: detailLimit, maxAttempts: detailMaxAttempts })) {
      const path = `${bo3.GAMES[m.game_code].prefix}/matches/${m.slug}`;
      const url = base + path;
      if (!bo3.robotsAllows(rules, path)) { logErr(url, 'Запрещено robots.txt — пропущено'); continue; }
      try {
        const d = details.extractMatchDetailsFromHtml(await fetcher(url), m.game_code, base);
        const final = details.isFinal(d);
        const c = repo.saveDetails(d, { final, base });
        tot.details_ok++; tot.games += c.games; tot.player_stats += c.player_stats; tot.snapshots += c.snapshots;
        logPage(url, 'match', true, { ...c, final, parsed_status: d.match.parsed_status, game_states: d.games.map((g) => g.state) });
      } catch (e) {
        repo.markDetailsFailed(m.id); logErr(url, e.message); logPage(url, 'match', false, { error: e.message }); tot.details_failed++;
      }
      if (delayMs) await sleep(delayMs);
    }

    // 3) Этап 3: списки турниров и рейтинг, затем профили команд / турниров / игроков (инкрементально, с лимитом за цикл).
    const listPages = [];
    if (withProfiles) {
    for (const [game, { prefix }] of Object.entries(bo3.GAMES)) listPages.push({ game, path: `${prefix}/tournaments/current`, parse: profiles.parseTournamentListHtml, save: prepo.saveTournamentList, kind: 'tournament_list' });
    listPages.push({ game: 'cs2', path: '/teams/valve-rankings/world', parse: profiles.parseValveRankingHtml, save: prepo.saveValveRanking, kind: 'ranking' });
    for (const p of listPages) {
      const url = base + p.path;
      if (!bo3.robotsAllows(rules, p.path)) { logErr(url, 'Запрещено robots.txt — пропущено'); continue; }
      try { const c = p.save(p.parse(await fetcher(url), p.game, base), p.game); tot.pages_ok++; logPage(url, p.kind, true, c); }
      catch (e) { logErr(url, e.message); logPage(url, p.kind, false, { error: e.message }); tot.pages_failed++; }
      if (delayMs) await sleep(delayMs);
    }
    const kinds = [
      { table: 'teams', seg: 'teams', parse: profiles.parseTeamHtml, save: prepo.saveTeamProfile, kind: 'team' },
      { table: 'tournaments', seg: 'tournaments', parse: profiles.parseTournamentHtml, save: prepo.saveTournamentProfile, kind: 'tournament' },
      { table: 'players', seg: 'players', parse: profiles.parsePlayerHtml, save: prepo.savePlayerProfile, kind: 'player' },
    ];
    for (const k of kinds) {
      // Очередь выбирается заново для каждого вида: профили команд добавляют игроков, турниры — команды.
      for (const e of prepo.dueProfiles(k.table, { limit: profileLimit, ttlHours: profileTtlHours, maxAttempts: profileMaxAttempts })) {
        const path = `${bo3.GAMES[e.game_code].prefix}/${k.seg}/${e.slug}`; const url = base + path;
        if (!bo3.robotsAllows(rules, path)) { logErr(url, 'Запрещено robots.txt — пропущено'); prepo.markProfile(k.table, e.game_code, e.source_id, 'missing'); continue; }
        try {
          const d = k.parse(await fetcher(url), e.game_code, base);
          const own = d[k.kind];
          // Страница отдала другую сущность (переименование/редирект) — не смешиваем записи, помечаем исходную как недоступную.
          if (own.source_id !== e.source_id) { prepo.markProfile(k.table, e.game_code, e.source_id, 'missing'); throw new Error(`Страница ${path} принадлежит другому объекту (id ${own.source_id})`); }
          const c = k.save(d); tot.profiles_ok++; tot.roster_changes += c.detected_changes || 0; logPage(url, k.kind, true, c);
        } catch (err) {
          if (err.status === 404 || err.status === 410) prepo.markProfile(k.table, e.game_code, e.source_id, 'missing');
          else if (!/другому объекту/.test(err.message)) prepo.markProfile(k.table, e.game_code, e.source_id, 'failed');
          tot.profiles_failed++; logErr(url, err.message); logPage(url, k.kind, false, { error: err.message });
        }
        if (delayMs) await sleep(delayMs);
      }
    }
    }

    const failed = tot.pages_failed + tot.details_failed + tot.profiles_failed; const ok = tot.pages_ok + tot.details_ok + tot.profiles_ok;
    const status = failed === 0 ? 'success' : ok > 0 ? 'partial' : 'failed';
    finish(status); return { runId, status, ...tot };
  } catch (e) {
    logErr(base, e.message); finish('failed'); return { runId, status: 'failed', error: e.message };
  } finally { running = false; cache.bump(); }

  function finish(status) {
    db.prepare(`UPDATE sync_runs SET finished_at=?, status=?, pages_ok=?, pages_failed=?, matches_upserted=?, teams_upserted=?,
      players_upserted=?, tournaments_upserted=?, articles_upserted=?, details_ok=?, details_failed=?, games_upserted=?, player_stats_upserted=?, snapshots_created=?, profiles_ok=?, profiles_failed=?, roster_changes_detected=? WHERE id=?`)
      .run(now(), status, tot.pages_ok, tot.pages_failed, tot.matches, tot.teams, tot.players, tot.tournaments, tot.articles,
        tot.details_ok, tot.details_failed, tot.games, tot.player_stats, tot.snapshots, tot.profiles_ok, tot.profiles_failed, tot.roster_changes, runId);
  }
}
// Этап 4: быстрая проверка текущих матчей между полными циклами.
// Читает только /matches/current трёх дисциплин и страницы матчей со статусом live (не более liveDetailLimit).
// Не запускается, если идёт полная синхронизация; пишет запуск в sync_runs с kind='live'.
async function runLiveSync(db, { fetcher = fetchText, delayMs = cfg.requestDelayMs, base = cfg.sourceBase, liveDetailLimit = cfg.liveDetailLimit } = {}) {
  if (running) return { skipped: true, reason: 'Синхронизация уже выполняется' };
  running = true;
  const now = () => new Date().toISOString();
  const runId = db.prepare("INSERT INTO sync_runs (started_at, status, kind) VALUES (?, 'running', 'live')").run(now()).lastInsertRowid;
  const logErr = (url, msg) => db.prepare('INSERT INTO sync_errors (run_id, created_at, url, message) VALUES (?,?,?,?)').run(runId, now(), url, String(msg).slice(0, 1000));
  const logPage = (url, kind, ok, summary) => db.prepare('INSERT INTO sync_pages (run_id, created_at, url, kind, ok, summary_json) VALUES (?,?,?,?,?,?)')
    .run(runId, now(), url, kind, ok ? 1 : 0, summary ? JSON.stringify(summary) : null);
  const repo = makeRepo(db);
  const tot = { pages_ok: 0, pages_failed: 0, matches: 0, details_ok: 0, details_failed: 0, games: 0, player_stats: 0, snapshots: 0 };
  const finish = (status) => db.prepare(`UPDATE sync_runs SET finished_at=?, status=?, pages_ok=?, pages_failed=?, matches_upserted=?, details_ok=?, details_failed=?,
      games_upserted=?, player_stats_upserted=?, snapshots_created=? WHERE id=?`)
    .run(now(), status, tot.pages_ok, tot.pages_failed, tot.matches, tot.details_ok, tot.details_failed, tot.games, tot.player_stats, tot.snapshots, runId);
  try {
    let rules;
    try { rules = bo3.parseRobots(await fetcher(`${base}/robots.txt`)); }
    catch (e) { throw new Error('Не удалось прочитать robots.txt — проверка отменена: ' + e.message); }
    for (const p of bo3.syncPages().filter((x) => /\/matches\/current$/.test(x.path))) {
      const url = base + p.path;
      if (!bo3.robotsAllows(rules, p.path)) { logErr(url, 'Запрещено robots.txt — пропущено'); tot.pages_failed++; continue; }
      try { const c = repo.saveBatch(bo3.extractFromHtml(await fetcher(url), p.game, base)); tot.matches += c.matches; tot.snapshots += c.snapshots; tot.pages_ok++; logPage(url, 'list', true, c); }
      catch (e) { logErr(url, e.message); logPage(url, 'list', false, { error: e.message }); tot.pages_failed++; }
      if (delayMs) await sleep(delayMs);
    }
    const live = db.prepare("SELECT id, game_code, slug FROM matches WHERE status='live' AND slug IS NOT NULL ORDER BY details_synced_at IS NOT NULL, details_synced_at ASC LIMIT ?").all(liveDetailLimit);
    for (const m of live) {
      const path = `${bo3.GAMES[m.game_code].prefix}/matches/${m.slug}`; const url = base + path;
      if (!bo3.robotsAllows(rules, path)) { logErr(url, 'Запрещено robots.txt — пропущено'); continue; }
      try {
        const d = details.extractMatchDetailsFromHtml(await fetcher(url), m.game_code, base);
        const c = repo.saveDetails(d, { final: details.isFinal(d), base });
        tot.details_ok++; tot.games += c.games; tot.player_stats += c.player_stats; tot.snapshots += c.snapshots;
        logPage(url, 'match', true, { ...c, parsed_status: d.match.parsed_status });
      } catch (e) { repo.markDetailsFailed(m.id); logErr(url, e.message); logPage(url, 'match', false, { error: e.message }); tot.details_failed++; }
      if (delayMs) await sleep(delayMs);
    }
    const failed = tot.pages_failed + tot.details_failed; const ok = tot.pages_ok + tot.details_ok;
    const status = failed === 0 ? 'success' : ok > 0 ? 'partial' : 'failed';
    finish(status); return { runId, kind: 'live', status, ...tot };
  } catch (e) { logErr(base, e.message); finish('failed'); return { runId, kind: 'live', status: 'failed', error: e.message }; }
  finally { running = false; cache.bump(); }
}

const isRunning = () => running;
module.exports = { runSync, runLiveSync, isRunning, detailCandidates };
