// Upsert-операции: повторная синхронизация обновляет записи по (game_code, source_id), без дублей.
// Поля, которых нет в очередном ответе источника (null), не затирают ранее сохранённые значения.
const crypto = require('crypto');
const now = () => new Date().toISOString();

const MATCH_DEFAULTS = { end_date: null, winner_team_source_id: null, parsed_status: null, stage_id: null, tier_rank: null, games_json: null };
const TOUR_DEFAULTS = { start_date: null, end_date: null, event_type: null, source_status: null, description: null };
const TEAM_DEFAULTS = { country_code: null, country_name: null, rank: null };
const STAT_COLS = ['role', 'hero', 'hero_image_url', 'kills', 'deaths', 'assists', 'adr', 'rating', 'kast', 'headshots', 'first_kills', 'first_deaths',
  'gold_per_min', 'xp_per_min', 'last_hits', 'denies', 'net_worth', 'hero_damage', 'creep_score', 'gold_earned', 'kill_participation', 'stats_json'];
const TEAM_STAT_COLS = ['side', 'kills', 'deaths', 'assists', 'gold', 'towers', 'dragons', 'barons', 'roshans', 'first_blood', 'first_tower', 'stats_json'];
const pick = (o, cols) => Object.fromEntries(cols.map((c) => [c, o[c] ?? null]));

function makeRepo(db) {
  const st = {
    tournament: db.prepare(`INSERT INTO tournaments (source_id, game_code, slug, name, tier, prize, image_url, source_url, start_date, end_date, event_type, source_status, description, updated_at)
      VALUES (@source_id,@game_code,@slug,@name,@tier,@prize,@image_url,@source_url,@start_date,@end_date,@event_type,@source_status,@description,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET slug=excluded.slug, name=excluded.name, tier=COALESCE(excluded.tier,tier),
      prize=COALESCE(excluded.prize,prize), image_url=COALESCE(excluded.image_url,image_url), source_url=excluded.source_url,
      start_date=COALESCE(excluded.start_date,start_date), end_date=COALESCE(excluded.end_date,end_date), event_type=COALESCE(excluded.event_type,event_type),
      source_status=COALESCE(excluded.source_status,source_status), description=COALESCE(excluded.description,description), updated_at=excluded.updated_at`),
    team: db.prepare(`INSERT INTO teams (source_id, game_code, slug, name, image_url, source_url, country_code, country_name, rank, updated_at)
      VALUES (@source_id,@game_code,@slug,@name,@image_url,@source_url,@country_code,@country_name,@rank,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET slug=excluded.slug, name=excluded.name,
      image_url=COALESCE(excluded.image_url,image_url), source_url=excluded.source_url, country_code=COALESCE(excluded.country_code,country_code),
      country_name=COALESCE(excluded.country_name,country_name), rank=COALESCE(excluded.rank,rank), updated_at=excluded.updated_at`),
    player: db.prepare(`INSERT INTO players (source_id, game_code, team_source_id, slug, nickname, first_name, last_name, country_code, country_name, image_url, is_coach, total_prize, source_url, updated_at)
      VALUES (@source_id,@game_code,@team_source_id,@slug,@nickname,@first_name,@last_name,@country_code,@country_name,@image_url,@is_coach,@total_prize,@source_url,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET team_source_id=excluded.team_source_id, slug=excluded.slug, nickname=excluded.nickname,
      first_name=excluded.first_name, last_name=excluded.last_name, country_code=excluded.country_code, country_name=excluded.country_name,
      image_url=COALESCE(excluded.image_url,image_url), is_coach=excluded.is_coach, total_prize=excluded.total_prize, source_url=excluded.source_url, updated_at=excluded.updated_at`),
    // Игрок из состава матча: только дополняем, не затирая подробные данные со страниц игроков
    playerLite: db.prepare(`INSERT INTO players (source_id, game_code, team_source_id, slug, nickname, first_name, last_name, country_code, image_url, source_url, updated_at)
      VALUES (@source_id,@game_code,@team_source_id,@slug,@nickname,@first_name,@last_name,@country_code,@image_url,@source_url,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET nickname=excluded.nickname, slug=COALESCE(excluded.slug,slug),
      team_source_id=COALESCE(team_source_id, excluded.team_source_id), first_name=COALESCE(first_name,excluded.first_name), last_name=COALESCE(last_name,excluded.last_name),
      country_code=COALESCE(country_code,excluded.country_code), image_url=COALESCE(excluded.image_url,image_url), source_url=COALESCE(excluded.source_url,source_url)`),
    match: db.prepare(`INSERT INTO matches (source_id, game_code, slug, status, source_status, start_date, end_date, bo_type, tier, tier_rank, stage_id, parsed_status, winner_team_source_id, tournament_source_id, games_json, source_url, updated_at)
      VALUES (@source_id,@game_code,@slug,@status,@source_status,@start_date,@end_date,@bo_type,@tier,@tier_rank,@stage_id,@parsed_status,@winner_team_source_id,@tournament_source_id,@games_json,@source_url,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET slug=excluded.slug, status=excluded.status, source_status=excluded.source_status,
      start_date=COALESCE(excluded.start_date,start_date), end_date=COALESCE(excluded.end_date,end_date), bo_type=COALESCE(excluded.bo_type,bo_type),
      tier=COALESCE(excluded.tier,tier), tier_rank=COALESCE(excluded.tier_rank,tier_rank), stage_id=COALESCE(excluded.stage_id,stage_id),
      parsed_status=COALESCE(excluded.parsed_status,parsed_status), winner_team_source_id=COALESCE(excluded.winner_team_source_id,winner_team_source_id),
      tournament_source_id=COALESCE(excluded.tournament_source_id,tournament_source_id),
      games_json=COALESCE(excluded.games_json,games_json), source_url=excluded.source_url, updated_at=excluded.updated_at`),
    matchId: db.prepare('SELECT id FROM matches WHERE game_code=? AND source_id=?'),
    matchTeam: db.prepare(`INSERT INTO match_teams (match_id, position, team_source_id, score) VALUES (?,?,?,?)
      ON CONFLICT(match_id, position) DO UPDATE SET team_source_id=COALESCE(excluded.team_source_id,team_source_id), score=COALESCE(excluded.score,score)`),
    article: db.prepare(`INSERT INTO articles (source_id, game_code, slug, title, description, image_url, published_at, source_url, updated_at)
      VALUES (@source_id,@game_code,@slug,@title,@description,@image_url,@published_at,@source_url,@updated_at)
      ON CONFLICT(source_id) DO UPDATE SET title=excluded.title, description=excluded.description, image_url=excluded.image_url,
      published_at=excluded.published_at, source_url=excluded.source_url, updated_at=excluded.updated_at`),
    game: db.prepare(`INSERT INTO match_games (match_id, source_id, number, map_name, status, state, begin_at, end_at, duration_sec, winner_team_source_id, loser_team_source_id, winner_score, loser_score, rounds_count, updated_at)
      VALUES (@match_id,@source_id,@number,@map_name,@status,@state,@begin_at,@end_at,@duration_sec,@winner_team_source_id,@loser_team_source_id,@winner_score,@loser_score,@rounds_count,@updated_at)
      ON CONFLICT(match_id, source_id) DO UPDATE SET number=COALESCE(excluded.number,number), map_name=COALESCE(excluded.map_name,map_name), status=COALESCE(excluded.status,status),
      state=COALESCE(excluded.state,state), begin_at=COALESCE(excluded.begin_at,begin_at), end_at=COALESCE(excluded.end_at,end_at), duration_sec=COALESCE(excluded.duration_sec,duration_sec),
      winner_team_source_id=COALESCE(excluded.winner_team_source_id,winner_team_source_id), loser_team_source_id=COALESCE(excluded.loser_team_source_id,loser_team_source_id),
      winner_score=COALESCE(excluded.winner_score,winner_score), loser_score=COALESCE(excluded.loser_score,loser_score), rounds_count=COALESCE(excluded.rounds_count,rounds_count), updated_at=excluded.updated_at`),
    gameId: db.prepare('SELECT id FROM match_games WHERE match_id=? AND source_id=?'),
    side: db.prepare(`INSERT INTO match_game_sides VALUES (@game_id,@ord,@overtime,@winner_team_name,@winner_side,@winner_score,@loser_team_name,@loser_side,@loser_score)
      ON CONFLICT(game_id, ord) DO UPDATE SET overtime=excluded.overtime, winner_team_name=excluded.winner_team_name, winner_side=excluded.winner_side, winner_score=excluded.winner_score,
      loser_team_name=excluded.loser_team_name, loser_side=excluded.loser_side, loser_score=excluded.loser_score`),
    round: db.prepare(`INSERT INTO match_rounds VALUES (@game_id,@round_number,@winner_team_name,@winner_side,@end_reason,@winner_score,@loser_score,@duration_sec)
      ON CONFLICT(game_id, round_number) DO UPDATE SET winner_team_name=excluded.winner_team_name, winner_side=excluded.winner_side, end_reason=excluded.end_reason,
      winner_score=excluded.winner_score, loser_score=excluded.loser_score, duration_sec=excluded.duration_sec`),
    lineup: db.prepare(`INSERT INTO match_lineups VALUES (?,?,?,?,?,?) ON CONFLICT(match_id, player_source_id) DO UPDATE SET team_source_id=excluded.team_source_id,
      nickname=excluded.nickname, country_code=COALESCE(excluded.country_code,country_code), image_url=COALESCE(excluded.image_url,image_url)`),
    pstat: db.prepare(`INSERT INTO match_player_stats (match_id, scope_game_id, player_source_id, team_source_id, nickname, ${STAT_COLS.join(',')}, updated_at)
      VALUES (@match_id,@scope_game_id,@player_source_id,@team_source_id,@nickname,${STAT_COLS.map((c) => '@' + c).join(',')},@updated_at)
      ON CONFLICT(match_id, scope_game_id, player_source_id) DO UPDATE SET team_source_id=COALESCE(excluded.team_source_id,team_source_id), nickname=COALESCE(excluded.nickname,nickname),
      ${STAT_COLS.map((c) => `${c}=COALESCE(excluded.${c},${c})`).join(',')}, updated_at=excluded.updated_at`),
    tstat: db.prepare(`INSERT INTO match_team_stats (match_id, scope_game_id, team_source_id, ${TEAM_STAT_COLS.join(',')}, updated_at)
      VALUES (@match_id,@scope_game_id,@team_source_id,${TEAM_STAT_COLS.map((c) => '@' + c).join(',')},@updated_at)
      ON CONFLICT(match_id, scope_game_id, team_source_id) DO UPDATE SET ${TEAM_STAT_COLS.map((c) => `${c}=COALESCE(excluded.${c},${c})`).join(',')}, updated_at=excluded.updated_at`),
    snapState: db.prepare(`SELECT m.status, m.source_status, mt1.score AS s1, mt2.score AS s2 FROM matches m
      LEFT JOIN match_teams mt1 ON mt1.match_id=m.id AND mt1.position=1 LEFT JOIN match_teams mt2 ON mt2.match_id=m.id AND mt2.position=2 WHERE m.id=?`),
    snapGames: db.prepare('SELECT number, status, winner_team_source_id AS w, winner_score AS ws, loser_score AS ls FROM match_games WHERE match_id=? ORDER BY number, source_id'),
    lastSnap: db.prepare('SELECT state_hash FROM match_snapshots WHERE match_id=? ORDER BY id DESC LIMIT 1'),
    snap: db.prepare('INSERT INTO match_snapshots (match_id, captured_at, status, source_status, team1_score, team2_score, games_summary, state_hash) VALUES (?,?,?,?,?,?,?,?)'),
    detailMark: db.prepare('UPDATE matches SET details_status=?, details_attempts=details_attempts+1, details_synced_at=? WHERE id=?'),
  };

  // Записывает снимок состояния, только если наблюдаемое состояние отличается от последнего снимка
  function snapshot(matchId, t) {
    const s = st.snapState.get(matchId); if (!s) return 0;
    const games = st.snapGames.all(matchId);
    const summary = JSON.stringify(games);
    const hash = crypto.createHash('sha1').update(JSON.stringify([s.status, s.source_status, s.s1, s.s2, summary])).digest('hex');
    const last = st.lastSnap.get(matchId);
    if (last && last.state_hash === hash) return 0;
    st.snap.run(matchId, t, s.status, s.source_status, s.s1, s.s2, games.length ? summary : null, hash);
    return 1;
  }

  function upsertMatch(m, t) {
    const { teams, ...row } = m;
    st.match.run({ ...MATCH_DEFAULTS, ...row, updated_at: t });
    const { id } = st.matchId.get(m.game_code, m.source_id);
    (teams || []).forEach((mt, i) => st.matchTeam.run(id, i + 1, mt.team_source_id ?? null, mt.score ?? null));
    return id;
  }

  const saveBatch = db.transaction((b) => {
    const t = now(); const c = { matches: 0, teams: 0, players: 0, tournaments: 0, articles: 0, snapshots: 0 };
    for (const x of b.tournaments) { st.tournament.run({ ...TOUR_DEFAULTS, ...x, updated_at: t }); c.tournaments++; }
    for (const x of b.teams) { st.team.run({ ...TEAM_DEFAULTS, ...x, updated_at: t }); c.teams++; }
    for (const x of b.players) { st.player.run({ ...x, updated_at: t }); c.players++; }
    for (const m of b.matches) { const id = upsertMatch(m, t); c.snapshots += snapshot(id, t); c.matches++; }
    for (const a of b.articles) { st.article.run({ ...a, updated_at: t }); c.articles++; }
    return c;
  });

  const P = { cs2: '', dota2: '/dota2', lol: '/lol' };
  const saveDetails = db.transaction((d, { final, base = 'https://bo3.gg' } = {}) => {
    const t = now(); const game = d.match.game_code;
    const c = { games: 0, rounds: 0, lineup: 0, player_stats: 0, team_stats: 0, snapshots: 0 };
    if (d.tournament) st.tournament.run({ ...TOUR_DEFAULTS, ...d.tournament, updated_at: t });
    for (const x of d.teams) st.team.run({ ...TEAM_DEFAULTS, ...x, updated_at: t });
    const matchId = upsertMatch(d.match, t);
    for (const p of d.lineup) {
      st.lineup.run(matchId, p.team_source_id, p.player_source_id, p.nickname, p.country_code ?? null, p.image_url ?? null); c.lineup++;
      st.playerLite.run({ source_id: p.player_source_id, game_code: game, team_source_id: p.team_source_id, slug: p.slug ?? null, nickname: p.nickname,
        first_name: p.first_name ?? null, last_name: p.last_name ?? null, country_code: p.country_code ?? null, image_url: p.image_url ?? null,
        source_url: p.slug ? `${base}${P[game]}/players/${p.slug}` : null, updated_at: t });
    }
    const gameIds = new Map();
    for (const g of d.games) {
      const { sides, rounds, ...row } = g;
      st.game.run({ ...row, match_id: matchId, updated_at: t });
      const gid = st.gameId.get(matchId, g.source_id).id; gameIds.set(g.source_id, gid); c.games++;
      for (const s of sides || []) st.side.run({ ...s, game_id: gid });
      for (const r of rounds || []) { st.round.run({ ...r, game_id: gid }); c.rounds++; }
    }
    const scope = (s) => (s === 0 ? 0 : gameIds.get(s));
    for (const p of d.playerStats) {
      const sc = scope(p.scope); if (sc == null) continue;
      st.pstat.run({ match_id: matchId, scope_game_id: sc, player_source_id: p.player_source_id, team_source_id: p.team_source_id ?? null, nickname: p.nickname ?? null, ...pick(p, STAT_COLS), updated_at: t });
      c.player_stats++;
    }
    for (const x of d.teamStats) {
      const sc = scope(x.scope); if (sc == null) continue;
      st.tstat.run({ match_id: matchId, scope_game_id: sc, team_source_id: x.team_source_id, ...pick(x, TEAM_STAT_COLS), updated_at: t });
      c.team_stats++;
    }
    c.snapshots = snapshot(matchId, t);
    st.detailMark.run(final ? 'final' : 'partial', t, matchId);
    return { matchId, ...c };
  });

  const markDetailsFailed = (matchId) => st.detailMark.run('failed', now(), matchId);
  return { saveBatch, saveDetails, markDetailsFailed };
}
module.exports = { makeRepo };
