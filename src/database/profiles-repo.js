// Этап 3: сохранение профилей. Все связи — по идентификаторам источника (game_code + source_id), никогда по названиям.
const crypto = require('crypto');
const { makeRepo } = require('./repository');
const now = () => new Date().toISOString();
const hash = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');
const n = (v) => (v === undefined ? null : v);

function makeProfileRepo(db) {
  const base = makeRepo(db);
  const st = {
    // Команда: подробная запись. Пустые значения не затирают ранее сохранённые.
    team: db.prepare(`INSERT INTO teams (source_id, game_code, slug, name, image_url, source_url, country_code, country_name, rank, acronym, est_date, icon_url, region_name,
        socials_json, six_month_earned, rank_diff, staff_json, general_stats_json, map_pool_json, updated_at)
      VALUES (@source_id,@game_code,@slug,@name,@image_url,@source_url,@country_code,@country_name,@rank,@acronym,@est_date,@icon_url,@region_name,
        @socials_json,@six_month_earned,@rank_diff,@staff_json,@general_stats_json,@map_pool_json,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET slug=COALESCE(excluded.slug,slug), name=excluded.name, image_url=COALESCE(excluded.image_url,image_url),
        source_url=COALESCE(excluded.source_url,source_url), country_code=COALESCE(excluded.country_code,country_code), country_name=COALESCE(excluded.country_name,country_name),
        rank=COALESCE(excluded.rank,rank), acronym=COALESCE(excluded.acronym,acronym), est_date=COALESCE(excluded.est_date,est_date), icon_url=COALESCE(excluded.icon_url,icon_url),
        region_name=COALESCE(excluded.region_name,region_name), socials_json=COALESCE(excluded.socials_json,socials_json), six_month_earned=COALESCE(excluded.six_month_earned,six_month_earned),
        rank_diff=COALESCE(excluded.rank_diff,rank_diff), staff_json=COALESCE(excluded.staff_json,staff_json), general_stats_json=COALESCE(excluded.general_stats_json,general_stats_json),
        map_pool_json=COALESCE(excluded.map_pool_json,map_pool_json), updated_at=excluded.updated_at`),
    // Игрок. @team_auth=1 — источник авторитетен для текущей команды (страница игрока/состав команды).
    player: db.prepare(`INSERT INTO players (source_id, game_code, team_source_id, slug, nickname, first_name, last_name, country_code, country_name, image_url, is_coach, total_prize,
        source_url, birthday, role, six_month_avg_rating, joined_team_at, source_player_status, socials_json, general_stats_json, updated_at)
      VALUES (@source_id,@game_code,@team_source_id,@slug,@nickname,@first_name,@last_name,@country_code,@country_name,@image_url,@is_coach,@total_prize,
        @source_url,@birthday,@role,@six_month_avg_rating,@joined_team_at,@status,@socials_json,@general_stats_json,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET
        team_source_id=CASE WHEN @team_auth=1 THEN excluded.team_source_id ELSE COALESCE(team_source_id, excluded.team_source_id) END,
        slug=COALESCE(excluded.slug,slug), nickname=excluded.nickname, first_name=COALESCE(excluded.first_name,first_name), last_name=COALESCE(excluded.last_name,last_name),
        country_code=COALESCE(excluded.country_code,country_code), country_name=COALESCE(excluded.country_name,country_name), image_url=COALESCE(excluded.image_url,image_url),
        is_coach=CASE WHEN @team_auth=1 THEN excluded.is_coach ELSE COALESCE(is_coach, excluded.is_coach) END, total_prize=COALESCE(excluded.total_prize,total_prize),
        source_url=COALESCE(excluded.source_url,source_url), birthday=COALESCE(excluded.birthday,birthday), role=COALESCE(excluded.role,role),
        six_month_avg_rating=COALESCE(excluded.six_month_avg_rating,six_month_avg_rating), joined_team_at=COALESCE(excluded.joined_team_at,joined_team_at),
        source_player_status=COALESCE(excluded.source_player_status,source_player_status), socials_json=COALESCE(excluded.socials_json,socials_json),
        general_stats_json=COALESCE(excluded.general_stats_json,general_stats_json), updated_at=excluded.updated_at`),
    tournament: db.prepare(`INSERT INTO tournaments (source_id, game_code, slug, name, tier, prize, image_url, source_url, start_date, end_date, event_type, source_status, description,
        tier_rank, players_prize, teams_prize, banner_url, region_name, country_name, updated_at)
      VALUES (@source_id,@game_code,@slug,@name,@tier,@prize,@image_url,@source_url,@start_date,@end_date,@event_type,@source_status,@description,
        @tier_rank,@players_prize,@teams_prize,@banner_url,@region_name,@country_name,@updated_at)
      ON CONFLICT(game_code, source_id) DO UPDATE SET slug=COALESCE(excluded.slug,slug), name=excluded.name, tier=COALESCE(excluded.tier,tier), prize=COALESCE(excluded.prize,prize),
        image_url=COALESCE(excluded.image_url,image_url), source_url=COALESCE(excluded.source_url,source_url), start_date=COALESCE(excluded.start_date,start_date),
        end_date=COALESCE(excluded.end_date,end_date), event_type=COALESCE(excluded.event_type,event_type), source_status=COALESCE(excluded.source_status,source_status),
        description=COALESCE(excluded.description,description), tier_rank=COALESCE(excluded.tier_rank,tier_rank), players_prize=COALESCE(excluded.players_prize,players_prize),
        teams_prize=COALESCE(excluded.teams_prize,teams_prize), banner_url=COALESCE(excluded.banner_url,banner_url), region_name=COALESCE(excluded.region_name,region_name),
        country_name=COALESCE(excluded.country_name,country_name), updated_at=excluded.updated_at`),
    change: db.prepare(`INSERT INTO roster_changes (game_code, source_kind, source_ref, player_source_id, player_name, from_team_source_id, from_team_name, to_team_source_id, to_team_name,
        change_type, source_action_type, is_coach, event_date, source_url, source_created_at, detected_at)
      VALUES (@game_code,@source_kind,@source_ref,@player_source_id,@player_name,@from_team_source_id,@from_team_name,@to_team_source_id,@to_team_name,
        @change_type,@source_action_type,@is_coach,@event_date,@source_url,@source_created_at,@detected_at)
      ON CONFLICT(game_code, source_kind, source_ref) DO UPDATE SET player_name=COALESCE(excluded.player_name,player_name),
        from_team_source_id=excluded.from_team_source_id, from_team_name=COALESCE(excluded.from_team_name,from_team_name),
        to_team_source_id=excluded.to_team_source_id, to_team_name=COALESCE(excluded.to_team_name,to_team_name), change_type=excluded.change_type,
        event_date=COALESCE(excluded.event_date,event_date), source_url=COALESCE(excluded.source_url,source_url)`), // detected_at не меняется — это первое обнаружение
    changeExists: db.prepare('SELECT 1 FROM roster_changes WHERE game_code=? AND source_kind=? AND source_ref=?'),
    lastRoster: db.prepare('SELECT id, roster_hash, players_json FROM team_roster_snapshots WHERE game_code=? AND team_source_id=? ORDER BY id DESC LIMIT 1'),
    roster: db.prepare('INSERT INTO team_roster_snapshots (game_code, team_source_id, captured_at, roster_hash, players_json) VALUES (?,?,?,?,?)'),
    detach: db.prepare('UPDATE players SET team_source_id=NULL WHERE game_code=? AND team_source_id=? AND source_id NOT IN (SELECT value FROM json_each(?))'),
    achievement: db.prepare(`INSERT INTO team_achievements VALUES (?,?,?,?,?) ON CONFLICT DO UPDATE SET title=excluded.title, date=excluded.date`),
    lastStat: db.prepare('SELECT state_hash FROM stat_snapshots WHERE game_code=? AND entity=? AND source_id=? ORDER BY id DESC LIMIT 1'),
    stat: db.prepare('INSERT INTO stat_snapshots (game_code, entity, source_id, captured_at, stats_json, state_hash) VALUES (?,?,?,?,?,?)'),
    tteam: db.prepare(`INSERT INTO tournament_teams VALUES (@game_code,@tournament_source_id,@team_source_id,@place,@money,@points,@players_json,@updated_at)
      ON CONFLICT DO UPDATE SET place=COALESCE(excluded.place,place), money=COALESCE(excluded.money,money), points=COALESCE(excluded.points,points),
        players_json=COALESCE(excluded.players_json,players_json), updated_at=excluded.updated_at`),
    stage: db.prepare(`INSERT INTO tournament_stages VALUES (@game_code,@source_id,@tournament_source_id,@title,@format_type,@status,@start_date,@end_date,@seq)
      ON CONFLICT DO UPDATE SET title=excluded.title, format_type=excluded.format_type, status=excluded.status, start_date=excluded.start_date, end_date=excluded.end_date, seq=excluded.seq`),
    round: db.prepare(`INSERT INTO tournament_rounds VALUES (@game_code,@source_id,@stage_source_id,@name,@round_index,@bracket_type,@start_at)
      ON CONFLICT DO UPDATE SET stage_source_id=excluded.stage_source_id, name=excluded.name, round_index=excluded.round_index, bracket_type=excluded.bracket_type, start_at=excluded.start_at`),
    rmatch: db.prepare(`INSERT INTO tournament_round_matches VALUES (@game_code,@round_source_id,@match_source_id,@position,@prev_match1_source_id,@prev_match2_source_id)
      ON CONFLICT DO UPDATE SET position=excluded.position, prev_match1_source_id=excluded.prev_match1_source_id, prev_match2_source_id=excluded.prev_match2_source_id`),
    tpstat: db.prepare(`INSERT INTO tournament_player_stats VALUES (@game_code,@tournament_source_id,@player_source_id,@games_count,@rounds_count,@rating,@kills,@deaths,@assists,@damage,@kd,@stats_json,@updated_at)
      ON CONFLICT DO UPDATE SET games_count=excluded.games_count, rounds_count=excluded.rounds_count, rating=excluded.rating, kills=excluded.kills, deaths=excluded.deaths,
        assists=excluded.assists, damage=excluded.damage, kd=excluded.kd, stats_json=excluded.stats_json, updated_at=excluded.updated_at`),
    ranking: db.prepare(`INSERT INTO rankings VALUES (@game_code,@kind,@ranking_date,@team_source_id,@position,@score,@region,@roster_json,@captured_at)
      ON CONFLICT DO UPDATE SET position=excluded.position, score=excluded.score, region=excluded.region, roster_json=COALESCE(excluded.roster_json,roster_json)`),
    mark: { teams: null, players: null, tournaments: null },
  };
  for (const t of ['teams', 'players', 'tournaments']) {
    st.mark[t] = db.prepare(`UPDATE ${t} SET profile_status=?, profile_attempts=CASE WHEN ?='ok' THEN 0 ELSE profile_attempts+1 END, profile_synced_at=? WHERE game_code=? AND source_id=?`);
  }

  const teamRow = (x, t) => ({ slug: null, image_url: null, source_url: null, country_code: null, country_name: null, rank: null, acronym: null, est_date: null, icon_url: null,
    region_name: null, socials_json: null, six_month_earned: null, rank_diff: null, staff_json: null, general_stats_json: null, map_pool_json: null, ...x, updated_at: t });
  const upTeam = (x, t) => st.team.run(teamRow(x, t));
  const upPlayer = (x, t, teamAuth) => st.player.run({ team_source_id: null, slug: null, first_name: null, last_name: null, country_code: null, country_name: null, image_url: null,
    is_coach: null, total_prize: null, source_url: null, birthday: null, role: null, six_month_avg_rating: null, joined_team_at: null, status: null, socials_json: null,
    general_stats_json: null, ...x, team_auth: teamAuth ? 1 : 0, updated_at: t });
  const upTour = (x, t) => st.tournament.run({ tier: null, prize: null, image_url: null, source_url: null, start_date: null, end_date: null, event_type: null, source_status: null,
    description: null, tier_rank: null, players_prize: null, teams_prize: null, banner_url: null, region_name: null, country_name: null, slug: null, ...x, updated_at: t });
  const upChange = (c, t) => {
    const isNew = !st.changeExists.get(c.game_code, c.source_kind, c.source_ref);
    st.change.run({ player_name: null, from_team_source_id: null, from_team_name: null, to_team_source_id: null, to_team_name: null, source_action_type: null, is_coach: null,
      event_date: null, source_url: null, source_created_at: null, ...c, detected_at: t });
    return isNew ? 1 : 0;
  };
  const statSnap = (game, entity, id, stats, t) => {
    if (!stats) return 0; const h = hash(stats); const last = st.lastStat.get(game, entity, id);
    if (last && last.state_hash === h) return 0; st.stat.run(game, entity, id, t, JSON.stringify(stats), h); return 1;
  };
  const saveTransfers = (list, t) => {
    let c = 0;
    for (const tr of list) {
      for (const tm of tr.teams) upTeam(tm, t);
      if (tr.player) upPlayer(tr.player, t, false);
      const { teams, player, ...row } = tr;
      c += upChange({ ...row, source_kind: 'source' }, t);
    }
    return c;
  };
  const listed = (l) => base.saveBatch({ matches: l.matches || [], teams: [], players: l.players || [], tournaments: l.tournaments || [], articles: [] });
  const saveListedTeams = (l, t) => { for (const x of l.teams || []) upTeam(x, t); };

  // Снимок состава и обнаружение изменений между снимками.
  function rosterSnapshot(game, team, roster, t) {
    const players = roster.map((p) => ({ player_source_id: p.source_id, nickname: p.nickname, is_coach: p.is_coach ? 1 : 0 })).sort((a, b) => a.player_source_id - b.player_source_id);
    const h = hash(players.map((p) => [p.player_source_id, p.is_coach]));
    const last = st.lastRoster.get(game, team.source_id);
    if (last && last.roster_hash === h) return { snapshot: 0, detected: 0 };
    const id = st.roster.run(game, team.source_id, t, h, JSON.stringify(players)).lastInsertRowid;
    let detected = 0;
    if (last) { // первый снимок не создаёт изменений — сравнивать не с чем
      const prev = JSON.parse(last.players_json); const was = new Map(prev.map((p) => [p.player_source_id, p])); const now_ = new Map(players.map((p) => [p.player_source_id, p]));
      for (const p of players) if (!was.has(p.player_source_id)) detected += upChange({ game_code: game, source_kind: 'detected', source_ref: `${team.source_id}:${last.id}>${id}:+${p.player_source_id}`,
        player_source_id: p.player_source_id, player_name: p.nickname, to_team_source_id: team.source_id, to_team_name: team.name, change_type: 'joined_detected', is_coach: p.is_coach }, t);
      for (const p of prev) if (!now_.has(p.player_source_id)) detected += upChange({ game_code: game, source_kind: 'detected', source_ref: `${team.source_id}:${last.id}>${id}:-${p.player_source_id}`,
        player_source_id: p.player_source_id, player_name: p.nickname, from_team_source_id: team.source_id, from_team_name: team.name, change_type: 'left_detected', is_coach: p.is_coach }, t);
    }
    return { snapshot: 1, detected };
  }

  const saveTeamProfile = db.transaction((d) => {
    const t = now(); const g = d.team.game_code;
    saveListedTeams(d.listed, t); listed(d.listed);
    upTeam({ ...d.team, staff_json: d.staff.length ? JSON.stringify(d.staff) : null, general_stats_json: d.general_stats ? JSON.stringify(d.general_stats) : null,
      map_pool_json: d.map_pool.length ? JSON.stringify(d.map_pool) : null }, t);
    for (const p of d.roster) upPlayer(p, t, true);
    st.detach.run(g, d.team.source_id, JSON.stringify(d.roster.map((p) => p.source_id)));
    const transfers = saveTransfers(d.transfers, t);
    for (const a of d.achievements) { upTour(a.tournament, t); st.achievement.run(g, d.team.source_id, a.tournament_source_id, a.title, a.date); }
    const r = rosterSnapshot(g, d.team, d.roster, t);
    const stats = statSnap(g, 'team', d.team.source_id, d.general_stats, t);
    if (d.team.rank != null) st.ranking.run({ game_code: g, kind: 'bo3_rank', ranking_date: t.slice(0, 10), team_source_id: d.team.source_id, position: d.team.rank, score: null, region: null, roster_json: null, captured_at: t });
    st.mark.teams.run('ok', 'ok', t, g, d.team.source_id);
    return { roster: d.roster.length, transfers_new: transfers, roster_snapshot: r.snapshot, detected_changes: r.detected, stat_snapshot: stats, matches: d.listed.matches.length };
  });

  const savePlayerProfile = db.transaction((d) => {
    const t = now(); const g = d.player.game_code;
    saveListedTeams(d.listed, t); listed(d.listed);
    if (d.team) upTeam(d.team, t);
    upPlayer({ ...d.player, team_source_id: d.team ? d.team.source_id : null, general_stats_json: d.general_stats ? JSON.stringify(d.general_stats) : null }, t, true);
    for (const p of d.roster) if (p.source_id !== d.player.source_id) upPlayer(p, t, true);
    const transfers = saveTransfers(d.transfers, t);
    const stats = statSnap(g, 'player', d.player.source_id, d.general_stats, t);
    st.mark.players.run('ok', 'ok', t, g, d.player.source_id);
    return { transfers_new: transfers, stat_snapshot: stats, matches: d.listed.matches.length };
  });

  const saveTournamentProfile = db.transaction((d) => {
    const t = now(); const g = d.tournament.game_code; const tid = d.tournament.source_id;
    upTour(d.tournament, t);
    for (const x of d.teams) upTeam(x, t);
    for (const p of d.players) upPlayer(p, t, false);
    saveListedTeams(d.listed, t); listed(d.listed);
    for (const p of d.participants) st.tteam.run({ game_code: g, tournament_source_id: tid, team_source_id: p.team_source_id, place: n(p.place), money: n(p.money), points: n(p.points),
      players_json: p.players && p.players.length ? JSON.stringify(p.players) : null, updated_at: t });
    let bm = 0;
    for (const s of d.stages) {
      st.stage.run({ game_code: g, tournament_source_id: tid, source_id: s.source_id, title: s.title, format_type: s.format_type, status: s.status, start_date: s.start_date, end_date: s.end_date, seq: s.seq });
      for (const r of s.rounds) {
        st.round.run({ game_code: g, source_id: r.source_id, stage_source_id: s.source_id, name: r.name, round_index: r.round_index, bracket_type: r.bracket_type, start_at: r.start_at });
        for (const m of r.matches) { st.rmatch.run({ game_code: g, round_source_id: r.source_id, match_source_id: m.match_source_id, position: m.position, prev_match1_source_id: m.prev_match1_source_id, prev_match2_source_id: m.prev_match2_source_id }); bm++; }
      }
    }
    for (const s of d.player_stats) st.tpstat.run({ game_code: g, tournament_source_id: tid, ...s, updated_at: t });
    st.mark.tournaments.run('ok', 'ok', t, g, tid);
    return { participants: d.participants.length, stages: d.stages.length, bracket_matches: bm, player_stats: d.player_stats.length, matches: d.listed.matches.length };
  });

  const saveTournamentList = db.transaction((d, game) => {
    const t = now();
    for (const x of d.tournaments) upTour(x, t);
    for (const x of d.teams) upTeam(x, t);
    for (const l of d.participants) st.tteam.run({ game_code: game, ...l, place: null, money: null, points: null, players_json: null, updated_at: t });
    return { tournaments: d.tournaments.length, teams: d.teams.length };
  });

  const saveValveRanking = db.transaction((d, game) => {
    const t = now();
    for (const x of d.teams) upTeam(x, t);
    for (const p of d.players) upPlayer(p, t, false);
    for (const r of d.rows) st.ranking.run({ game_code: game, kind: 'valve', ranking_date: r.ranking_date || t.slice(0, 10), team_source_id: r.team_source_id, position: r.position,
      score: r.score, region: r.region, roster_json: JSON.stringify(r.roster), captured_at: t });
    return { rows: d.rows.length };
  });

  // Страница недоступна (404) — помечаем missing, запись и связи сохраняем.
  const markProfile = (kind, game, sourceId, status) => st.mark[kind].run(status, status, now(), game, sourceId);

  // Очередь обхода: никогда не загружавшиеся, затем самые давние; неудачные — с ограничением попыток.
  function dueProfiles(kind, { limit, ttlHours, maxAttempts }) {
    if (limit <= 0) return [];
    const cutoff = new Date(Date.now() - ttlHours * 3600e3).toISOString();
    return db.prepare(`SELECT id, game_code, source_id, slug FROM ${kind}
      WHERE slug IS NOT NULL AND source_id IS NOT NULL AND COALESCE(profile_status,'') <> 'missing' AND profile_attempts < ?
        AND (profile_synced_at IS NULL OR profile_synced_at < ? OR COALESCE(profile_status,'') = 'failed')
      ORDER BY profile_synced_at IS NOT NULL, ${kind === 'teams' ? 'rank IS NULL, rank,' : kind === 'tournaments' ? "CASE source_status WHEN 'current' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END," : ''} profile_synced_at LIMIT ?`)
      .all(maxAttempts, cutoff, limit);
  }

  return { saveTeamProfile, savePlayerProfile, saveTournamentProfile, saveTournamentList, saveValveRanking, markProfile, dueProfiles };
}
module.exports = { makeProfileRepo };
