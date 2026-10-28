const express = require('express');
const cfg = require('../config');
const { isRunning } = require('../services/sync');
const { cached } = require('../services/cache');
const { makePostsRepo } = require('../database/posts-repo');
const GAMES = ['cs2', 'dota2', 'lol'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function api(db) {
  const r = express.Router();
  const lim = (q, d = 50) => Math.min(Math.max(parseInt(q, 10) || d, 1), 200);
  const gameOk = (g) => !g || GAMES.includes(g);
  const bad = (res, m) => res.status(400).json({ error: m });
  const notFound = (res) => res.status(404).json({ error: 'Не найдено' });

  const matchSelect = `SELECT m.*, t.name AS tournament_name, t.slug AS tournament_slug, t.image_url AS tournament_image, t.id AS tournament_id,
    mt1.score AS team1_score, mt2.score AS team2_score,
    a.id AS team1_id, a.name AS team1_name, a.image_url AS team1_image,
    b.id AS team2_id, b.name AS team2_name, b.image_url AS team2_image
    FROM matches m
    LEFT JOIN tournaments t ON t.game_code=m.game_code AND t.source_id=m.tournament_source_id
    LEFT JOIN match_teams mt1 ON mt1.match_id=m.id AND mt1.position=1
    LEFT JOIN match_teams mt2 ON mt2.match_id=m.id AND mt2.position=2
    LEFT JOIN teams a ON a.game_code=m.game_code AND a.source_id=mt1.team_source_id
    LEFT JOIN teams b ON b.game_code=m.game_code AND b.source_id=mt2.team_source_id`;
  const shape = (m) => m && ({
    id: m.id, game: m.game_code, status: m.status, source_status: m.source_status, start_date: m.start_date, bo_type: m.bo_type, tier: m.tier,
    source_url: m.source_url, updated_at: m.updated_at, games: m.games_json ? JSON.parse(m.games_json) : [],
    tournament: m.tournament_id ? { id: m.tournament_id, name: m.tournament_name, image_url: m.tournament_image } : null,
    teams: [[m.team1_id, m.team1_name, m.team1_image, m.team1_score], [m.team2_id, m.team2_name, m.team2_image, m.team2_score]]
      .map(([id, name, image_url, score]) => ({ id: id || null, name: name || null, image_url: image_url || null, score: score ?? null })),
  });

  r.get('/games', (req, res) => {
    res.json(db.prepare(`SELECT g.code, g.name, (SELECT COUNT(*) FROM matches m WHERE m.game_code=g.code) AS matches_count FROM games g ORDER BY g.id`).all());
  });

  r.get('/matches', (req, res) => {
    const { game, status, date, date_from, date_to, team_id, tournament_id, tier } = req.query;
    const q = String(req.query.q || '').trim();
    if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    if (status && !['upcoming', 'live', 'finished'].includes(status)) return bad(res, 'Неизвестный статус');
    for (const d of [date, date_from, date_to]) if (d && !DATE_RE.test(d)) return bad(res, 'Дата должна быть в формате YYYY-MM-DD');
    if (q.length > 80) return bad(res, 'Слишком длинный запрос');
    const w = []; const p = [];
    if (game) { w.push('m.game_code=?'); p.push(game); }
    if (status) { w.push('m.status=?'); p.push(status); }
    if (date) { w.push('substr(m.start_date,1,10)=?'); p.push(date); }
    if (date_from) { w.push('substr(m.start_date,1,10)>=?'); p.push(date_from); }
    if (date_to) { w.push('substr(m.start_date,1,10)<=?'); p.push(date_to); }
    if (tier) { w.push('lower(m.tier)=?'); p.push(String(tier).toLowerCase()); }
    if (q) { w.push('(a.name LIKE ? OR b.name LIKE ? OR t.name LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (team_id) { w.push('(a.id=? OR b.id=?)'); p.push(team_id, team_id); }
    if (tournament_id) { w.push('t.id=?'); p.push(tournament_id); }
    const order = status === 'finished' ? 'm.start_date DESC' : status === 'upcoming' ? 'm.start_date ASC' : "CASE m.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, m.start_date ASC";
    const rows = db.prepare(`${matchSelect} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...p, lim(req.query.limit), off(req.query.offset));
    res.set('X-Total-Count', String(db.prepare(`SELECT COUNT(*) c FROM (${matchSelect} ${w.length ? 'WHERE ' + w.join(' AND ') : ''})`).get(...p).c));
    res.json(rows.map(shape));
  });
  r.get('/matches/:id', (req, res) => { const m = db.prepare(`${matchSelect} WHERE m.id=?`).get(req.params.id); m ? res.json(shape(m)) : notFound(res); });

  // ---------- Этап 2: подробности матча ----------
  const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
  const getMatch = (id) => db.prepare('SELECT id, game_code FROM matches WHERE id=?').get(id);
  const games = (mid, withRounds) => db.prepare('SELECT * FROM match_games WHERE match_id=? ORDER BY number, source_id').all(mid).map((g) => ({
    ...g,
    sides: db.prepare('SELECT ord, overtime, winner_team_name, winner_side, winner_score, loser_team_name, loser_side, loser_score FROM match_game_sides WHERE game_id=? ORDER BY ord').all(g.id),
    rounds: withRounds ? db.prepare('SELECT round_number, winner_team_name, winner_side, end_reason, winner_score, loser_score, duration_sec FROM match_rounds WHERE game_id=? ORDER BY round_number').all(g.id) : undefined,
  }));
  const lineups = (m) => db.prepare(`SELECT l.team_source_id, l.player_source_id, l.nickname, l.country_code, l.image_url, p.id AS player_id
    FROM match_lineups l LEFT JOIN players p ON p.game_code=? AND p.source_id=l.player_source_id WHERE l.match_id=? ORDER BY l.team_source_id, l.nickname COLLATE NOCASE`).all(m.game_code, m.id);
  const pstats = (m, scope) => db.prepare(`SELECT s.*, p.id AS player_id FROM match_player_stats s LEFT JOIN players p ON p.game_code=? AND p.source_id=s.player_source_id
    WHERE s.match_id=? ${scope != null ? 'AND s.scope_game_id=?' : ''} ORDER BY s.scope_game_id, s.team_source_id, COALESCE(s.rating, s.kills, 0) DESC`)
    .all(...[m.game_code, m.id, ...(scope != null ? [scope] : [])]).map(({ stats_json, ...x }) => ({ ...x, extra: parseJson(stats_json) }));
  const tstats = (m, scope) => db.prepare(`SELECT * FROM match_team_stats WHERE match_id=? ${scope != null ? 'AND scope_game_id=?' : ''} ORDER BY scope_game_id, team_source_id`)
    .all(...[m.id, ...(scope != null ? [scope] : [])]).map(({ stats_json, ...x }) => ({ ...x, extra: parseJson(stats_json) }));
  const history = (mid, limit, offset) => ({
    total: db.prepare('SELECT COUNT(*) c FROM match_snapshots WHERE match_id=?').get(mid).c,
    items: db.prepare('SELECT id, captured_at, status, source_status, team1_score, team2_score, games_summary FROM match_snapshots WHERE match_id=? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(mid, limit, offset).map(({ games_summary, ...x }) => ({ ...x, games: parseJson(games_summary) || [] })),
  });
  const off = (q) => Math.max(parseInt(q, 10) || 0, 0);
  const scopeQ = (q) => (q === undefined ? null : /^\d+$/.test(String(q)) ? Number(q) : undefined);
  const withMatch = (fn) => (req, res) => { const m = getMatch(req.params.id); if (!m) return notFound(res); fn(m, req, res); };

  r.get('/matches/:id/full', withMatch((m, req, res) => {
    const base = shape(db.prepare(`${matchSelect} WHERE m.id=?`).get(m.id));
    const row = db.prepare('SELECT end_date, parsed_status, winner_team_source_id, tier_rank, details_status, details_synced_at, details_attempts FROM matches WHERE id=?').get(m.id);
    const t = db.prepare('SELECT t.* FROM tournaments t JOIN matches m ON t.game_code=m.game_code AND t.source_id=m.tournament_source_id WHERE m.id=?').get(m.id) || null;
    const teams = db.prepare(`SELECT mt.position, t.id, t.source_id, t.name, t.image_url, t.country_name, t.rank FROM match_teams mt
      LEFT JOIN teams t ON t.game_code=? AND t.source_id=mt.team_source_id WHERE mt.match_id=? ORDER BY mt.position`).all(m.game_code, m.id);
    res.json({ ...base, ...row, tournament: t, team_details: teams, games: games(m.id, true), lineups: lineups(m),
      player_stats: pstats(m), team_stats: tstats(m), history: history(m.id, 50, 0) });
  }));
  r.get('/matches/:id/games', withMatch((m, req, res) => res.json(games(m.id, req.query.rounds !== '0'))));
  r.get('/matches/:id/lineups', withMatch((m, req, res) => res.json(lineups(m))));
  r.get('/matches/:id/stats', withMatch((m, req, res) => {
    const sc = scopeQ(req.query.game_id); if (sc === undefined) return bad(res, 'game_id должен быть числом (0 — итог матча)');
    res.json({ players: pstats(m, sc), teams: tstats(m, sc) });
  }));
  r.get('/matches/:id/history', withMatch((m, req, res) => res.json(history(m.id, lim(req.query.limit, 50), off(req.query.offset)))));
  r.get('/matches/:id/players/:pid', withMatch((m, req, res) => {
    const p = db.prepare('SELECT source_id FROM players WHERE id=?').get(req.params.pid); if (!p) return notFound(res);
    const rows = pstats(m).filter((x) => x.player_source_id === p.source_id);
    rows.length ? res.json(rows) : notFound(res);
  }));

  // Этап 3: каталоги, профили, трансферы, рейтинги, сравнения
  require('./profiles-api')(r, db, { matchSelect, shape, parseJson, lim, off, gameOk, bad, notFound });

  r.get('/articles', (req, res) => {
    const { game } = req.query; if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    res.json(db.prepare(`SELECT * FROM articles ${game ? 'WHERE game_code=?' : ''} ORDER BY published_at DESC LIMIT ?`).all(...(game ? [game] : []), lim(req.query.limit, 30)));
  });
  // ---------- Этап 4: собственные статьи и гайды (публичная часть) ----------
  const posts = makePostsRepo(db);
  require('./posts-api')(r, db, { posts, lim, off, gameOk, bad, notFound });

  // ---------- Общий поиск ----------
  const SEARCH_TYPES = ['teams', 'players', 'tournaments', 'matches', 'posts'];
  r.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim(); if (q.length < 2) return bad(res, 'Минимум 2 символа');
    if (q.length > 80) return bad(res, 'Слишком длинный запрос');
    const { game, status, date_from, date_to } = req.query;
    if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    for (const d of [date_from, date_to]) if (d && !DATE_RE.test(d)) return bad(res, 'Дата должна быть в формате YYYY-MM-DD');
    const types = req.query.type ? String(req.query.type).split(',').filter((t) => SEARCH_TYPES.includes(t)) : SEARCH_TYPES;
    if (!types.length) return bad(res, 'type: ' + SEARCH_TYPES.join(', '));
    const n = lim(req.query.limit, 20); const like = `%${q}%`;
    const gw = (col) => (game ? ` AND ${col}=?` : ''); const gp = game ? [game] : [];
    const out = { q, types, teams: [], players: [], tournaments: [], matches: [], posts: [], totals: {} };
    const run = (key, countSql, sql, params) => { out.totals[key] = db.prepare(countSql).get(...params).c; out[key] = db.prepare(sql + ' LIMIT ?').all(...params, n); };
    if (types.includes('teams')) {
      const w = `(name LIKE ? OR acronym LIKE ?)${gw('game_code')}`; const p = [like, like, ...gp];
      run('teams', `SELECT COUNT(*) c FROM teams WHERE ${w}`, `SELECT id, game_code, name, acronym, image_url, rank, country_name FROM teams WHERE ${w}
        ORDER BY rank IS NULL, rank, name COLLATE NOCASE`, p);
    }
    if (types.includes('players')) {
      const w = `(p.nickname LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)${gw('p.game_code')}`; const p = [like, like, like, ...gp];
      run('players', `SELECT COUNT(*) c FROM players p WHERE ${w}`, `SELECT p.id, p.game_code, p.nickname, p.first_name, p.last_name, p.image_url, p.country_name, p.is_coach, t.id AS team_id, t.name AS team_name
        FROM players p LEFT JOIN teams t ON t.game_code=p.game_code AND t.source_id=p.team_source_id WHERE ${w} ORDER BY p.six_month_avg_rating IS NULL, p.nickname COLLATE NOCASE`, p);
    }
    if (types.includes('tournaments')) {
      const st = status && ['current', 'upcoming', 'finished'].includes(status) ? ' AND source_status=?' : '';
      const w = `name LIKE ?${gw('game_code')}${st}${date_from ? ' AND COALESCE(end_date,start_date)>=?' : ''}${date_to ? ' AND start_date<=?' : ''}`;
      const p = [like, ...gp, ...(st ? [status] : []), ...(date_from ? [date_from] : []), ...(date_to ? [date_to + 'T23:59:59'] : [])];
      run('tournaments', `SELECT COUNT(*) c FROM tournaments WHERE ${w}`, `SELECT id, game_code, name, image_url, tier, prize, start_date, end_date, source_status FROM tournaments WHERE ${w} ORDER BY start_date IS NULL, start_date DESC`, p);
    }
    if (types.includes('matches')) {
      const st = status && ['live', 'upcoming', 'finished'].includes(status) ? ' AND m.status=?' : '';
      const w = `(a.name LIKE ? OR b.name LIKE ? OR t.name LIKE ?)${gw('m.game_code')}${st}${date_from ? ' AND substr(m.start_date,1,10)>=?' : ''}${date_to ? ' AND substr(m.start_date,1,10)<=?' : ''}`;
      const p = [like, like, like, ...gp, ...(st ? [status] : []), ...(date_from ? [date_from] : []), ...(date_to ? [date_to] : [])];
      out.totals.matches = db.prepare(`SELECT COUNT(*) c FROM (${matchSelect} WHERE ${w})`).get(...p).c;
      out.matches = db.prepare(`${matchSelect} WHERE ${w} ORDER BY CASE m.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, CASE WHEN m.status='upcoming' THEN m.start_date END ASC, m.start_date DESC LIMIT ?`).all(...p, n).map(shape);
    }
    if (types.includes('posts')) {
      const r2 = posts.list({ q, game, limit: n, offset: 0 }); out.posts = r2.rows; out.totals.posts = r2.total;
    }
    res.json(out);
  });

  // ---------- Состояние синхронизации и актуальность данных ----------
  const freshness = () => {
    const ok = db.prepare("SELECT * FROM sync_runs WHERE status IN ('success','partial') ORDER BY id DESC LIMIT 1").get() || null;
    const okFull = db.prepare("SELECT finished_at FROM sync_runs WHERE status IN ('success','partial') AND kind='full' ORDER BY id DESC LIMIT 1").get() || null;
    const last = db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get() || null;
    const lastErr = db.prepare('SELECT created_at, url, message FROM sync_errors ORDER BY id DESC LIMIT 1').get() || null;
    const at = ok ? ok.finished_at : null; const age = at ? (Date.now() - new Date(at)) / 60000 : null;
    return {
      running: isRunning(), last_success_at: at, last_full_success_at: okFull ? okFull.finished_at : null, age_min: age == null ? null : Math.round(age),
      stale: age == null || age > cfg.staleAfterMin, stale_after_min: cfg.staleAfterMin,
      last_status: last ? last.status : null, last_kind: last ? last.kind : null, last_started_at: last ? last.started_at : null,
      source_ok: !last || last.status !== 'failed', last_error: lastErr,
      schedule: { full: cfg.syncCron, live: cfg.liveSyncCron || null },
      client: { poll_sec: cfg.pollSec, poll_live_sec: cfg.pollLiveSec },
      live_count: db.prepare("SELECT COUNT(*) c FROM matches WHERE status='live'").get().c,
    };
  };
  r.get('/sync/freshness', (req, res) => res.json(freshness()));
  r.get('/sync/status', (req, res) => {
    res.json({
      ...freshness(),
      last_success: db.prepare("SELECT * FROM sync_runs WHERE status IN ('success','partial') ORDER BY id DESC LIMIT 1").get() || null,
      last_run: db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1').get() || null,
      recent_runs: db.prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 15').all(),
      recent_errors: db.prepare('SELECT * FROM sync_errors ORDER BY id DESC LIMIT 20').all(),
      recent_pages: db.prepare('SELECT * FROM sync_pages ORDER BY id DESC LIMIT 40').all().map(({ summary_json, ...x }) => ({ ...x, summary: parseJson(summary_json) })),
      counts: Object.fromEntries(['matches', 'teams', 'players', 'tournaments', 'articles', 'posts', 'match_games', 'match_rounds', 'match_player_stats', 'match_team_stats', 'match_snapshots', 'roster_changes', 'team_roster_snapshots', 'tournament_teams', 'tournament_round_matches', 'tournament_player_stats', 'rankings', 'stat_snapshots'].map((t) => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c])),
    });
  });

  // ---------- Главная: все блоки одним запросом (кэшируется на API_CACHE_SEC) ----------
  r.get('/home', (req, res) => {
    const { game } = req.query; if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    const body = cached('home:' + (game || ''), cfg.apiCacheSec, () => {
      const gw = game ? 'm.game_code=? AND ' : ''; const gp = game ? [game] : [];
      const ms = (cond, order, n) => db.prepare(`${matchSelect} WHERE ${gw}${cond} ORDER BY ${order} LIMIT ?`).all(...gp, n).map(shape);
      const nowIso = new Date().toISOString();
      const tours = db.prepare(`SELECT t.id, t.game_code, t.name, t.image_url, t.tier, t.prize, t.start_date, t.end_date, t.source_status, t.event_type,
          (SELECT COUNT(*) FROM matches m WHERE m.game_code=t.game_code AND m.tournament_source_id=t.source_id AND m.status='live') AS live_count,
          (SELECT COUNT(*) FROM matches m WHERE m.game_code=t.game_code AND m.tournament_source_id=t.source_id) AS matches_count
        FROM tournaments t WHERE ${game ? 't.game_code=? AND ' : ''}t.source_status IN ('current','upcoming')
        ORDER BY t.source_status='current' DESC, live_count DESC, t.tier_rank IS NULL, t.tier_rank, t.prize IS NULL, t.prize DESC LIMIT 8`).all(...gp);
      const topTeams = (g) => db.prepare(`SELECT id, game_code, name, acronym, image_url, rank, rank_diff, country_name FROM teams WHERE game_code=? AND rank IS NOT NULL ORDER BY rank LIMIT ?`).all(g, game ? 10 : 5);
      const counts = db.prepare(`SELECT
          (SELECT COUNT(*) FROM matches m WHERE ${gw}m.status='live') AS live,
          (SELECT COUNT(*) FROM matches m WHERE ${gw}m.status='upcoming' AND m.start_date >= ?) AS upcoming,
          (SELECT COUNT(*) FROM matches m WHERE ${gw}m.status='finished' AND m.start_date >= ?) AS finished_24h,
          (SELECT COUNT(*) FROM teams ${game ? 'WHERE game_code=?' : ''}) AS teams,
          (SELECT COUNT(*) FROM players ${game ? 'WHERE game_code=?' : ''}) AS players,
          (SELECT COUNT(*) FROM tournaments ${game ? 'WHERE game_code=?' : ''}) AS tournaments`)
        .get(...gp, ...gp, new Date(Date.now() - 3 * 3600000).toISOString(), ...gp, new Date(Date.now() - 86400000).toISOString(), ...gp, ...gp, ...gp);
      return {
        game: game || null, generated_at: nowIso, counts,
        live: ms("m.status='live'", 'm.start_date ASC', 12),
        upcoming: ms("m.status='upcoming'", 'm.start_date ASC', 10),
        finished: ms("m.status='finished'", 'm.start_date DESC', 10),
        tournaments: tours,
        top_teams: Object.fromEntries((game ? [game] : GAMES).map((g) => [g, topTeams(g)])),
        posts: posts.list({ game, limit: 6 }).rows,
        news: db.prepare(`SELECT id, game_code, title, description, image_url, published_at, source_url FROM articles ${game ? 'WHERE game_code=?' : ''} ORDER BY published_at DESC LIMIT 4`).all(...gp),
      };
    });
    res.json({ ...body, sync: freshness() });
  });

  r.use((req, res) => notFound(res));
  return r;
};
