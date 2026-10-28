// Этап 3: каталоги и профили команд, игроков, турниров; трансферы; рейтинги; сравнения.
// Все ссылки между сущностями строятся по внутренним id, найденным через (game_code, source_id).
// Поле origin: 'source' — показатель опубликован BO3.GG; 'derived' — вычислено Esports Hub из сохранённых данных.
module.exports = function profilesApi(r, db, h) {
  const { matchSelect, shape, parseJson, lim, off, gameOk, bad, notFound } = h;
  const page = (req, res, sql, params, map = (x) => x) => {
    const total = db.prepare(`SELECT COUNT(*) c FROM (${sql})`).get(...params).c;
    res.set('X-Total-Count', String(total));
    return db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, lim(req.query.limit, 24), off(req.query.offset)).map(map);
  };
  const teamBrief = (g, sid) => (sid == null ? null : db.prepare('SELECT id, source_id, name, image_url, game_code FROM teams WHERE game_code=? AND source_id=?').get(g, sid) || null);
  const playerBrief = (g, sid) => (sid == null ? null : db.prepare('SELECT id, source_id, nickname, image_url, country_code FROM players WHERE game_code=? AND source_id=?').get(g, sid) || null);
  const tourBrief = (g, sid) => (sid == null ? null : db.prepare('SELECT id, source_id, name, image_url, tier, start_date, end_date, source_status, prize FROM tournaments WHERE game_code=? AND source_id=?').get(g, sid) || null);
  const changeShape = (c) => ({ id: c.id, game: c.game_code, source_kind: c.source_kind, change_type: c.change_type, is_coach: c.is_coach,
    event_date: c.event_date, detected_at: c.detected_at, source_url: c.source_url,
    player: playerBrief(c.game_code, c.player_source_id) || { id: null, nickname: c.player_name },
    from_team: c.from_team_source_id ? teamBrief(c.game_code, c.from_team_source_id) || { id: null, name: c.from_team_name } : null,
    to_team: c.to_team_source_id ? teamBrief(c.game_code, c.to_team_source_id) || { id: null, name: c.to_team_name } : null });
  const statHistory = (g, entity, sid) => db.prepare('SELECT captured_at, stats_json FROM stat_snapshots WHERE game_code=? AND entity=? AND source_id=? ORDER BY id DESC LIMIT 30')
    .all(g, entity, sid).map((x) => ({ captured_at: x.captured_at, stats: parseJson(x.stats_json) }));
  // Сводка по матчам из базы (derived)
  const record = (ms, teamId) => {
    const fin = ms.filter((m) => m.status === 'finished'); let w = 0; let l = 0;
    for (const m of fin) { const me = m.teams.findIndex((t) => t.id === teamId); if (me < 0) continue; const a = m.teams[me].score; const b = m.teams[1 - me].score; if (a == null || b == null || a === b) continue; a > b ? w++ : l++; }
    return { finished: fin.length, wins: w, losses: l, winrate: w + l ? w / (w + l) : null };
  };

  // ---------------- Команды ----------------
  const TEAM_SORT = { name: 't.name COLLATE NOCASE', rank: 't.rank IS NULL, t.rank, t.name COLLATE NOCASE', earned: 't.six_month_earned IS NULL, t.six_month_earned DESC',
    matches: 'matches_count DESC, t.name COLLATE NOCASE', players: 'players_count DESC, t.name COLLATE NOCASE' };
  r.get('/teams', (req, res) => {
    const { game, q, sort = 'name', country } = req.query; if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    if (!TEAM_SORT[sort]) return bad(res, 'Сортировка: ' + Object.keys(TEAM_SORT).join(', '));
    const w = []; const p = [];
    if (game) { w.push('t.game_code=?'); p.push(game); }
    if (q) { w.push('(t.name LIKE ? OR t.acronym LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
    if (country) { w.push('t.country_code=?'); p.push(country); }
    const sql = `SELECT t.id, t.source_id, t.game_code, t.name, t.slug, t.image_url, t.country_code, t.country_name, t.rank, t.acronym, t.six_month_earned, t.profile_status, t.profile_synced_at,
      (SELECT COUNT(*) FROM match_teams mt JOIN matches m ON m.id=mt.match_id WHERE m.game_code=t.game_code AND mt.team_source_id=t.source_id) AS matches_count,
      (SELECT COUNT(*) FROM players pl WHERE pl.game_code=t.game_code AND pl.team_source_id=t.source_id) AS players_count
      FROM teams t ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${TEAM_SORT[sort]}`;
    res.json(page(req, res, sql, p));
  });

  r.get('/teams/:id', (req, res) => {
    const t = db.prepare('SELECT * FROM teams WHERE id=?').get(req.params.id); if (!t) return notFound(res);
    const g = t.game_code; const sid = t.source_id;
    const all = db.prepare(`${matchSelect} WHERE m.game_code=? AND (mt1.team_source_id=? OR mt2.team_source_id=?) ORDER BY m.start_date DESC LIMIT 300`).all(g, sid, sid).map(shape);
    const roster = db.prepare(`SELECT id, source_id, nickname, first_name, last_name, country_code, country_name, image_url, is_coach, role, six_month_avg_rating, joined_team_at, total_prize
      FROM players WHERE game_code=? AND team_source_id=? ORDER BY is_coach, nickname COLLATE NOCASE`).all(g, sid);
    const tournaments = db.prepare(`SELECT tr.id, tr.name, tr.image_url, tr.tier, tr.start_date, tr.end_date, tr.source_status, tr.prize, tt.place, tt.money,
        (SELECT COUNT(*) FROM matches m JOIN match_teams mt ON mt.match_id=m.id WHERE m.game_code=tr.game_code AND m.tournament_source_id=tr.source_id AND mt.team_source_id=?) AS matches_count
      FROM tournaments tr LEFT JOIN tournament_teams tt ON tt.game_code=tr.game_code AND tt.tournament_source_id=tr.source_id AND tt.team_source_id=?
      WHERE tr.game_code=? AND (tt.team_source_id IS NOT NULL OR tr.source_id IN (SELECT m.tournament_source_id FROM matches m JOIN match_teams mt ON mt.match_id=m.id WHERE m.game_code=? AND mt.team_source_id=?))
      ORDER BY tr.start_date DESC LIMIT 100`).all(sid, sid, g, g, sid);
    const achievements = db.prepare(`SELECT a.title, a.date, tr.id AS tournament_id, tr.name, tr.tier, tr.prize FROM team_achievements a
      LEFT JOIN tournaments tr ON tr.game_code=a.game_code AND tr.source_id=a.tournament_source_id WHERE a.game_code=? AND a.team_source_id=? ORDER BY a.date DESC`).all(g, sid);
    const changes = db.prepare(`SELECT * FROM roster_changes WHERE game_code=? AND (from_team_source_id=? OR to_team_source_id=?)
      ORDER BY COALESCE(event_date, substr(detected_at,1,10)) DESC, id DESC LIMIT 100`).all(g, sid, sid).map(changeShape);
    const rosterHistory = db.prepare('SELECT id, captured_at, players_json FROM team_roster_snapshots WHERE game_code=? AND team_source_id=? ORDER BY id DESC LIMIT 20').all(g, sid)
      .map((s) => ({ captured_at: s.captured_at, players: (parseJson(s.players_json) || []).map((p) => ({ ...p, player: playerBrief(g, p.player_source_id) })) }));
    const rankings = db.prepare('SELECT kind, ranking_date, position, score, region FROM rankings WHERE game_code=? AND team_source_id=? ORDER BY kind, ranking_date DESC LIMIT 120').all(g, sid);
    // Индивидуальная статистика игроков команды в матчах (итог матча, scope 0) — средние значения, derived
    const playerAgg = db.prepare(`SELECT s.player_source_id, MAX(s.nickname) AS nickname, COUNT(*) AS matches, AVG(s.kills) AS kills, AVG(s.deaths) AS deaths, AVG(s.assists) AS assists,
        AVG(s.adr) AS adr, AVG(s.rating) AS rating, AVG(s.gold_per_min) AS gold_per_min, AVG(s.kast) AS kast
      FROM match_player_stats s JOIN matches m ON m.id=s.match_id WHERE m.game_code=? AND s.team_source_id=? AND s.scope_game_id=0 GROUP BY s.player_source_id ORDER BY matches DESC LIMIT 30`)
      .all(g, sid).map((x) => ({ ...x, player: playerBrief(g, x.player_source_id) }));
    const { general_stats_json, map_pool_json, socials_json, staff_json, ...team } = t;
    res.json({ ...team, socials: parseJson(socials_json), staff: parseJson(staff_json) || [],
      general_stats: parseJson(general_stats_json), map_pool: parseJson(map_pool_json) || [], stat_history: statHistory(g, 'team', sid),
      record: record(all, t.id), roster, players: roster,
      live: all.filter((m) => m.status === 'live'), upcoming: all.filter((m) => m.status === 'upcoming').reverse().slice(0, 30), recent: all.filter((m) => m.status === 'finished').slice(0, 50),
      matches: all.slice(0, 30), tournaments, achievements, roster_changes: changes, roster_history: rosterHistory, rankings, player_stats: playerAgg });
  });

  // ---------------- Игроки ----------------
  const PLAYER_SORT = { nickname: 'p.nickname COLLATE NOCASE', rating: 'p.six_month_avg_rating IS NULL, p.six_month_avg_rating DESC', prize: 'p.total_prize IS NULL, p.total_prize DESC',
    matches: 'matches_count DESC, p.nickname COLLATE NOCASE' };
  r.get('/players', (req, res) => {
    const { game, q, sort = 'nickname', team_id, role } = req.query; if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    if (!PLAYER_SORT[sort]) return bad(res, 'Сортировка: ' + Object.keys(PLAYER_SORT).join(', '));
    const w = []; const p = [];
    if (game) { w.push('p.game_code=?'); p.push(game); }
    if (q) { w.push('(p.nickname LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (team_id) { w.push('t.id=?'); p.push(team_id); }
    if (role === 'coach') w.push('p.is_coach=1'); else if (role === 'player') w.push('COALESCE(p.is_coach,0)=0');
    const sql = `SELECT p.id, p.source_id, p.game_code, p.nickname, p.first_name, p.last_name, p.image_url, p.country_code, p.country_name, p.is_coach, p.role, p.six_month_avg_rating, p.total_prize,
      t.id AS team_id, t.name AS team_name, t.image_url AS team_image,
      (SELECT COUNT(*) FROM match_lineups l JOIN matches m ON m.id=l.match_id WHERE m.game_code=p.game_code AND l.player_source_id=p.source_id) AS matches_count
      FROM players p LEFT JOIN teams t ON t.game_code=p.game_code AND t.source_id=p.team_source_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${PLAYER_SORT[sort]}`;
    res.json(page(req, res, sql, p));
  });

  r.get('/players/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id); if (!p) return notFound(res);
    const g = p.game_code; const sid = p.source_id;
    const transfers = db.prepare(`SELECT * FROM roster_changes WHERE game_code=? AND player_source_id=? ORDER BY COALESCE(event_date, substr(detected_at,1,10)) DESC, id DESC`).all(g, sid).map(changeShape);
    // Предыдущие команды — только из опубликованных трансферов и обнаруженных изменений (не из догадок)
    const prev = new Map();
    for (const c of transfers) for (const tm of [c.from_team, c.to_team]) if (tm && tm.id && tm.source_id !== p.team_source_id && !prev.has(tm.id)) prev.set(tm.id, { ...tm, last_event: c.event_date || null });
    const matches = db.prepare(`${matchSelect} WHERE m.id IN (SELECT match_id FROM match_lineups WHERE player_source_id=? UNION SELECT match_id FROM match_player_stats WHERE player_source_id=?)
      AND m.game_code=? ORDER BY m.start_date DESC LIMIT 60`).all(sid, sid, g).map(shape);
    const matchStats = db.prepare(`SELECT s.match_id, s.scope_game_id, s.team_source_id, s.kills, s.deaths, s.assists, s.adr, s.rating, s.kast, s.hero, s.role, s.gold_per_min, s.creep_score, m.start_date, m.status
      FROM match_player_stats s JOIN matches m ON m.id=s.match_id WHERE m.game_code=? AND s.player_source_id=? ORDER BY m.start_date DESC, s.scope_game_id LIMIT 120`).all(g, sid);
    const agg = db.prepare(`SELECT COUNT(*) AS matches, AVG(kills) AS kills, AVG(deaths) AS deaths, AVG(assists) AS assists, AVG(adr) AS adr, AVG(rating) AS rating, AVG(kast) AS kast, AVG(gold_per_min) AS gold_per_min
      FROM match_player_stats s JOIN matches m ON m.id=s.match_id WHERE m.game_code=? AND s.player_source_id=? AND s.scope_game_id=0`).get(g, sid);
    const tournaments = db.prepare(`SELECT tr.id, tr.name, tr.image_url, tr.tier, tr.start_date, tr.end_date, tr.source_status, tt.place, tps.games_count, tps.rating, tps.kills, tps.deaths, tps.damage, tps.kd,
        t.id AS team_id, t.name AS team_name
      FROM tournaments tr
      LEFT JOIN tournament_player_stats tps ON tps.game_code=tr.game_code AND tps.tournament_source_id=tr.source_id AND tps.player_source_id=?
      LEFT JOIN tournament_teams tt ON tt.game_code=tr.game_code AND tt.tournament_source_id=tr.source_id AND EXISTS (SELECT 1 FROM json_each(COALESCE(tt.players_json,'[]')) j WHERE json_extract(j.value,'$.player_source_id')=?)
      LEFT JOIN teams t ON t.game_code=tr.game_code AND t.source_id=tt.team_source_id
      WHERE tr.game_code=? AND (tps.player_source_id IS NOT NULL OR tt.team_source_id IS NOT NULL
        OR tr.source_id IN (SELECT m.tournament_source_id FROM matches m JOIN match_lineups l ON l.match_id=m.id WHERE m.game_code=? AND l.player_source_id=?))
      ORDER BY tr.start_date DESC LIMIT 60`).all(sid, sid, g, g, sid);
    const { general_stats_json, socials_json, ...player } = p;
    res.json({ ...player, socials: parseJson(socials_json), general_stats: parseJson(general_stats_json), stat_history: statHistory(g, 'player', sid),
      team: teamBrief(g, p.team_source_id), previous_teams: [...prev.values()], transfers, matches, match_stats: matchStats,
      aggregate: agg && agg.matches ? agg : null, tournaments });
  });

  // ---------------- Турниры ----------------
  const TOUR_SORT = { start: 't.start_date IS NULL, t.start_date DESC', prize: 't.prize IS NULL, t.prize DESC', name: 't.name COLLATE NOCASE',
    matches: 'matches_count DESC', tier: 't.tier_rank IS NULL, t.tier_rank, t.start_date DESC' };
  r.get('/tournaments', (req, res) => {
    const { game, q, sort = 'start', status, tier } = req.query; if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    if (!TOUR_SORT[sort]) return bad(res, 'Сортировка: ' + Object.keys(TOUR_SORT).join(', '));
    const w = []; const p = [];
    if (game) { w.push('t.game_code=?'); p.push(game); }
    if (q) { w.push('t.name LIKE ?'); p.push(`%${q}%`); }
    if (status) { w.push('t.source_status=?'); p.push(status); }
    if (tier) { w.push('lower(t.tier)=?'); p.push(String(tier).toLowerCase()); }
    const sql = `SELECT t.id, t.source_id, t.game_code, t.name, t.image_url, t.tier, t.prize, t.start_date, t.end_date, t.source_status, t.event_type, t.profile_status,
      (SELECT COUNT(*) FROM matches m WHERE m.game_code=t.game_code AND m.tournament_source_id=t.source_id) AS matches_count,
      (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.game_code=t.game_code AND tt.tournament_source_id=t.source_id) AS teams_count
      FROM tournaments t ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${TOUR_SORT[sort]}`;
    res.json(page(req, res, sql, p));
  });

  r.get('/tournaments/:id', (req, res) => {
    const t = db.prepare('SELECT * FROM tournaments WHERE id=?').get(req.params.id); if (!t) return notFound(res);
    const g = t.game_code; const sid = t.source_id;
    const matches = db.prepare(`${matchSelect} WHERE m.game_code=? AND m.tournament_source_id=? ORDER BY m.start_date DESC LIMIT 400`).all(g, sid).map(shape);
    const bySource = new Map(db.prepare('SELECT id, source_id FROM matches WHERE game_code=? AND tournament_source_id=?').all(g, sid).map((x) => [x.source_id, x.id]));
    const byId = new Map(matches.map((m) => [m.id, m]));
    const participants = db.prepare(`SELECT tt.team_source_id, tt.place, tt.money, tt.points, tt.players_json FROM tournament_teams tt WHERE tt.game_code=? AND tt.tournament_source_id=?`).all(g, sid)
      .map((x) => ({ team: teamBrief(g, x.team_source_id), place: x.place, money: x.money, points: x.points,
        players: (parseJson(x.players_json) || []).map((pl) => ({ ...pl, player: playerBrief(g, pl.player_source_id) })) }))
      .sort((a, b) => (parseInt(a.place, 10) || 999) - (parseInt(b.place, 10) || 999) || String(a.team && a.team.name).localeCompare(String(b.team && b.team.name)));
    const stages = db.prepare('SELECT * FROM tournament_stages WHERE game_code=? AND tournament_source_id=? ORDER BY seq, start_date').all(g, sid).map((s) => ({
      id: s.source_id, title: s.title, format_type: s.format_type, status: s.status, start_date: s.start_date, end_date: s.end_date,
      rounds: db.prepare('SELECT * FROM tournament_rounds WHERE game_code=? AND stage_source_id=? ORDER BY bracket_type, round_index').all(g, s.source_id).map((rd) => ({
        id: rd.source_id, name: rd.name, round_index: rd.round_index, bracket_type: rd.bracket_type, start_at: rd.start_at,
        matches: db.prepare('SELECT * FROM tournament_round_matches WHERE game_code=? AND round_source_id=? ORDER BY position, match_source_id').all(g, rd.source_id).map((x) => {
          const mid = bySource.get(x.match_source_id);
          return { match: mid ? byId.get(mid) || null : null, position: x.position, prev_match_ids: [x.prev_match1_source_id, x.prev_match2_source_id].map((s2) => bySource.get(s2) || null) };
        }),
      })),
    }));
    const playerStats = db.prepare('SELECT * FROM tournament_player_stats WHERE game_code=? AND tournament_source_id=? ORDER BY rating DESC').all(g, sid)
      .map(({ stats_json, ...x }) => ({ ...x, player: playerBrief(g, x.player_source_id), extra: parseJson(stats_json) }));
    // Результаты команд по матчам турнира (derived): победы/поражения из сохранённых матчей
    const res2 = new Map();
    for (const m of matches) {
      if (m.status !== 'finished') continue;
      m.teams.forEach((tm, i) => { if (!tm.id) return; const o = m.teams[1 - i]; const r0 = res2.get(tm.id) || { team: { id: tm.id, name: tm.name, image_url: tm.image_url }, wins: 0, losses: 0 };
        if (tm.score != null && o.score != null && tm.score !== o.score) tm.score > o.score ? r0.wins++ : r0.losses++; res2.set(tm.id, r0); });
    }
    res.json({ ...t, participants, stages, matches, upcoming: matches.filter((m) => m.status !== 'finished').reverse(), results: matches.filter((m) => m.status === 'finished'),
      team_results: [...res2.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses), player_stats: playerStats });
  });

  // ---------------- Трансферы и изменения составов ----------------
  r.get('/transfers', (req, res) => {
    const { game, team_id, player_id, kind } = req.query; if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    if (kind && !['source', 'detected'].includes(kind)) return bad(res, 'kind: source | detected');
    const w = []; const p = [];
    if (game) { w.push('c.game_code=?'); p.push(game); }
    if (kind) { w.push('c.source_kind=?'); p.push(kind); }
    if (team_id) { const t = db.prepare('SELECT game_code, source_id FROM teams WHERE id=?').get(team_id); if (!t) return notFound(res); w.push('c.game_code=? AND (c.from_team_source_id=? OR c.to_team_source_id=?)'); p.push(t.game_code, t.source_id, t.source_id); }
    if (player_id) { const pl = db.prepare('SELECT game_code, source_id FROM players WHERE id=?').get(player_id); if (!pl) return notFound(res); w.push('c.game_code=? AND c.player_source_id=?'); p.push(pl.game_code, pl.source_id); }
    const sql = `SELECT c.* FROM roster_changes c ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY COALESCE(c.event_date, substr(c.detected_at,1,10)) DESC, c.id DESC`;
    res.json(page(req, res, sql, p, changeShape));
  });

  // ---------------- Рейтинги ----------------
  r.get('/rankings', (req, res) => {
    const game = req.query.game || 'cs2'; if (!gameOk(game)) return bad(res, 'Неизвестная дисциплина');
    const kind = req.query.kind || (game === 'cs2' ? 'valve' : 'bo3_rank');
    if (!['valve', 'bo3_rank'].includes(kind)) return bad(res, 'kind: valve | bo3_rank');
    const dates = db.prepare('SELECT DISTINCT ranking_date FROM rankings WHERE game_code=? AND kind=? ORDER BY ranking_date DESC LIMIT 200').all(game, kind).map((x) => x.ranking_date);
    const date = req.query.date || dates[0] || null;
    const rows = date ? db.prepare('SELECT * FROM rankings WHERE game_code=? AND kind=? AND ranking_date=? ORDER BY position LIMIT 200').all(game, kind, date) : [];
    const prevDate = dates[dates.indexOf(date) + 1] || null;
    const prev = prevDate ? new Map(db.prepare('SELECT team_source_id, position FROM rankings WHERE game_code=? AND kind=? AND ranking_date=?').all(game, kind, prevDate).map((x) => [x.team_source_id, x.position])) : new Map();
    res.json({ game, kind, date, dates, previous_date: prevDate,
      label: kind === 'valve' ? 'Рейтинг Valve (Regional Standings), опубликованный на BO3.GG' : 'Место команды в рейтинге BO3.GG — снимок на дату синхронизации Esports Hub',
      rows: rows.map((x) => ({ position: x.position, score: x.score, region: x.region, team: teamBrief(game, x.team_source_id),
        change: prev.has(x.team_source_id) ? prev.get(x.team_source_id) - x.position : null,
        roster: (parseJson(x.roster_json) || []).map((pl) => ({ ...pl, player: playerBrief(game, pl.player_source_id) })) })) });
  });

  // ---------------- Сравнения ----------------
  const pick = (o, keys) => keys.map(([k, label, fmt]) => ({ key: k, label, fmt, a: o.a ? o.a[k] ?? null : null, b: o.b ? o.b[k] ?? null : null }));
  const ratio = (x, y) => (x != null && y ? x / y : null);
  r.get('/compare/teams', (req, res) => {
    const A = db.prepare('SELECT * FROM teams WHERE id=?').get(req.query.a); const B = db.prepare('SELECT * FROM teams WHERE id=?').get(req.query.b);
    if (!A || !B) return notFound(res); if (A.game_code !== B.game_code) return bad(res, 'Сравнивать можно команды одной дисциплины');
    const prep = (t) => { const g = parseJson(t.general_stats_json) || {}; return { ...g, rank: t.rank, six_month_earned: t.six_month_earned,
      matches_winrate: ratio(g.matches_won_count, g.matches_count), games_winrate: ratio(g.games_won_count, g.games_count), rounds_winrate: ratio(g.rounds_won_count, g.rounds_count), kd: ratio(g.kills_sum, g.deaths_sum) }; };
    const o = { a: prep(A), b: prep(B) };
    const h2h = db.prepare(`${matchSelect} WHERE m.game_code=? AND ((mt1.team_source_id=? AND mt2.team_source_id=?) OR (mt1.team_source_id=? AND mt2.team_source_id=?)) ORDER BY m.start_date DESC LIMIT 20`)
      .all(A.game_code, A.source_id, B.source_id, B.source_id, A.source_id).map(shape);
    res.json({ a: { id: A.id, name: A.name, image_url: A.image_url }, b: { id: B.id, name: B.name, image_url: B.image_url }, game: A.game_code,
      source: pick(o, [['rank', 'Место в рейтинге BO3.GG'], ['six_month_earned', 'Призовые за 6 месяцев, $'], ['matches_count', 'Матчей'], ['matches_won_count', 'Побед в матчах'],
        ['games_count', 'Карт / игр'], ['games_won_count', 'Выиграно карт / игр'], ['events_count', 'Турниров'], ['events_won_count', 'Выиграно турниров'], ['rounds_count', 'Раундов'], ['kills_sum', 'Убийств'], ['deaths_sum', 'Смертей']]),
      derived: pick(o, [['matches_winrate', '% побед в матчах', 'pct'], ['games_winrate', '% побед на картах / в играх', 'pct'], ['rounds_winrate', '% выигранных раундов', 'pct'], ['kd', 'K/D (убийства / смерти)', 2]]),
      head_to_head: h2h });
  });
  r.get('/compare/players', (req, res) => {
    const A = db.prepare('SELECT * FROM players WHERE id=?').get(req.query.a); const B = db.prepare('SELECT * FROM players WHERE id=?').get(req.query.b);
    if (!A || !B) return notFound(res); if (A.game_code !== B.game_code) return bad(res, 'Сравнивать можно игроков одной дисциплины');
    const agg = (p) => db.prepare(`SELECT COUNT(*) AS db_matches, AVG(kills) AS avg_kills, AVG(deaths) AS avg_deaths, AVG(assists) AS avg_assists, AVG(adr) AS avg_adr, AVG(rating) AS avg_rating
      FROM match_player_stats s JOIN matches m ON m.id=s.match_id WHERE m.game_code=? AND s.player_source_id=? AND s.scope_game_id=0`).get(p.game_code, p.source_id);
    const prep = (p) => { const g = parseJson(p.general_stats_json) || {}; return { ...g, ...agg(p), six_month_avg_rating: p.six_month_avg_rating, total_prize: p.total_prize,
      kd: ratio(g.kills_sum, g.deaths_sum), adr: ratio(g.damage_sum, g.rounds_count), kpr: ratio(g.kills_sum, g.rounds_count), matches_winrate: ratio(g.matches_won_count, g.matches_count) }; };
    const o = { a: prep(A), b: prep(B) };
    res.json({ a: { id: A.id, nickname: A.nickname, image_url: A.image_url }, b: { id: B.id, nickname: B.nickname, image_url: B.image_url }, game: A.game_code,
      source: pick(o, [['six_month_avg_rating', 'Средний рейтинг BO3.GG за 6 месяцев', 2], ['total_prize', 'Призовые, $'], ['matches_count', 'Матчей'], ['matches_won_count', 'Побед в матчах'],
        ['games_count', 'Карт / игр'], ['events_count', 'Турниров'], ['kills_sum', 'Убийств'], ['deaths_sum', 'Смертей'], ['assists_sum', 'Ассистов'], ['damage_sum', 'Урона'], ['rounds_count', 'Раундов']]),
      derived: pick(o, [['kd', 'K/D', 2], ['adr', 'Урон за раунд (ADR)', 1], ['kpr', 'Убийств за раунд', 2], ['matches_winrate', '% побед в матчах', 'pct'],
        ['db_matches', 'Матчей со статистикой в базе CyberLeague'], ['avg_kills', 'Средние K за матч (база)', 1], ['avg_deaths', 'Средние D за матч (база)', 1], ['avg_rating', 'Средний рейтинг матча (база)', 2]]) });
  });
};
