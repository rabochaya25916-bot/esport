// Этап 3: разбор страниц профилей BO3.GG — команд, игроков, турниров, списков турниров и рейтингов.
// Источник — серверное состояние Nuxt (window.__NUXT__): разделы state.data и state.pinia.
// Ничего не достраиваем: если поля нет в источнике — сохраняем null.
const { GAMES, extractNuxtState, extractFromState } = require('./bo3');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const results = (v) => (v && Array.isArray(v.results) ? v.results : arr(v));
const findData = (state, prefix) => { const d = state.data || {}; const k = Object.keys(d).find((x) => x.startsWith(prefix) && d[x] && typeof d[x] === 'object'); return k ? d[k] : null; };
const pinia = (state, store) => (state.pinia && state.pinia[store]) || {};
const url = (base, game, kind, slug) => (slug ? `${base}${GAMES[game].prefix}/${kind}/${slug}` : null);
const socials = (o) => {
  const s = {}; for (const k of ['website_url', 'twitter', 'facebook', 'twitch', 'twitch_url', 'youtube_url', 'instagram_url']) if (str(o[k])) s[k.replace('_url', '')] = o[k];
  return Object.keys(s).length ? JSON.stringify(s) : null;
};
const country = (c) => (c && typeof c === 'object' ? { code: str(c.code), name: str(c.name), region: c.region ? str(c.region.name) : null } : { code: null, name: null, region: null });

function teamRef(t, game, base) {
  if (!t || !num(t.id) || !str(t.name)) return null;
  const c = country(t.country);
  return { source_id: num(t.id), game_code: game, slug: str(t.slug), name: t.name, image_url: str(t.image_url), country_code: c.code, country_name: c.name,
    rank: num(t.rank), source_url: url(base, game, 'teams', t.slug) };
}
function playerRef(p, game, base, teamId) {
  if (!p || !num(p.id) || !str(p.nickname)) return null;
  const c = country(p.country);
  return { source_id: num(p.id), game_code: game, slug: str(p.slug), nickname: p.nickname, first_name: str(p.first_name), last_name: str(p.last_name),
    country_code: c.code || str(p.country_code), country_name: c.name, image_url: str(p.image_url), is_coach: p.is_coach ? 1 : 0,
    team_source_id: teamId !== undefined ? teamId : num(p.team_id), total_prize: num(p.total_prize), source_url: url(base, game, 'players', p.slug),
    birthday: str(p.birthday), role: str(p.role), six_month_avg_rating: num(p.six_month_avg_rating), joined_team_at: str(p.joined_team_at), status: num(p.status) };
}

// Трансфер — только то, что опубликовано источником. Тип вычисляется по наличию команд, а не по коду action_type.
function transfer(t, game, base) {
  if (!t || !num(t.id) || !num(t.player_id)) return null;
  const from = num(t.team_from_id); const to = num(t.team_to_id);
  const type = from && to ? (from === to ? 'status_change' : 'move') : to ? 'join' : from ? 'leave' : 'other';
  return { source_ref: String(t.id), game_code: game, player_source_id: num(t.player_id), player_name: str(t.player_name) || (t.player && str(t.player.nickname)),
    from_team_source_id: from, from_team_name: str(t.team_from_name) || (t.team_from && str(t.team_from.name)),
    to_team_source_id: to, to_team_name: str(t.team_to_name) || (t.team_to && str(t.team_to.name)),
    change_type: type, source_action_type: num(t.action_type), is_coach: t.is_coach ? 1 : 0, event_date: str(t.action_date),
    source_url: str(t.source_url), source_created_at: str(t.created_at),
    player: playerRef(t.player, game, base, undefined), teams: [teamRef(t.team_from, game, base), teamRef(t.team_to, game, base)].filter(Boolean) };
}

// ---------------- Команда ----------------
function parseTeamState(state, game, base) {
  const ts = pinia(state, 'teams'); const t = ts.team;
  if (!t || !num(t.id)) throw new Error('На странице команды нет данных team');
  const c = country(t.country);
  const team = { ...teamRef(t, game, base), country_code: c.code, country_name: c.name, region_name: c.region, acronym: str(t.acronym), est_date: str(t.est_date),
    icon_url: str(t.icon_url), socials_json: socials(t), six_month_earned: num(t.six_month_earned), rank_diff: num(t.rank_diff) };
  const roster = arr(t.players).map((p) => playerRef(p, game, base, team.source_id)).filter(Boolean);
  const staff = arr(t.staff_member_participants).map((s) => s.staff_member && str(s.staff_member.nickname) ? {
    nickname: s.staff_member.nickname, first_name: str(s.staff_member.first_name), last_name: str(s.staff_member.last_name), role: str(s.role),
    image_url: str(s.staff_member.image_url), country_name: country(s.staff_member.country).name, player_source_id: num(s.staff_member.player_id) } : null).filter(Boolean);
  const transfers = new Map();
  for (const x of [...results(ts.transfers), ...arr(t.from_transfers)]) { const tr = transfer(x, game, base); if (tr) transfers.set(tr.source_ref, tr); }
  // история переходов каждого игрока состава (player_transfers внутри team.players)
  for (const p of arr(t.players)) for (const x of arr(p.player_transfers)) { const tr = transfer({ ...x, player_id: x.player_id ?? p.id, player_name: x.player_name ?? p.nickname }, game, base); if (tr) transfers.set(tr.source_ref, tr); }
  const achievements = arr(t.achievements).map((a) => a && a.tournament ? { title: str(a.title), date: str(a.date), tournament_source_id: num(a.tournament.id),
    tournament: { source_id: num(a.tournament.id), game_code: game, slug: str(a.tournament.slug), name: str(a.tournament.name), tier: str(a.tournament.tier), prize: num(a.tournament.prize),
      image_url: null, source_url: url(base, game, 'tournaments', a.tournament.slug) } } : null).filter((a) => a && a.tournament.name);
  const gs = ts.generalStats && typeof ts.generalStats === 'object' && !Array.isArray(ts.generalStats) && Object.keys(ts.generalStats).length ? ts.generalStats : null;
  const mapPool = arr(ts.mapPool).filter((m) => m && str(m.map));
  const listed = extractFromState({ data: state.data }, game, base); // матчи команды (последние и будущие)
  return { team, roster, staff, transfers: [...transfers.values()], achievements, general_stats: gs, map_pool: mapPool, listed };
}

// ---------------- Игрок ----------------
function parsePlayerState(state, game, base) {
  const ps = pinia(state, 'players'); const p = ps.player;
  if (!p || !num(p.id)) throw new Error('На странице игрока нет данных player');
  const player = { ...playerRef(p, game, base), socials_json: socials(p) };
  const team = teamRef(p.team, game, base);
  const roster = team ? arr(p.team.players).map((x) => playerRef(x, game, base, team.source_id)).filter(Boolean) : [];
  const transfers = results(ps.transfers).map((x) => transfer(x, game, base)).filter(Boolean);
  const gs = ps.generalStats && typeof ps.generalStats === 'object' && !Array.isArray(ps.generalStats) && Object.keys(ps.generalStats).length ? ps.generalStats : null;
  const achievements = arr(p.achievements).map((a) => a && a.tournament ? { title: str(a.title), date: str(a.date), tournament_source_id: num(a.tournament.id) } : null).filter(Boolean);
  return { player, team, roster, transfers, general_stats: gs, achievements, listed: extractFromState({ data: state.data }, game, base) };
}

// ---------------- Турнир ----------------
function parseTournamentState(state, game, base) {
  const tsx = pinia(state, 'tournaments'); const t = tsx.tournament;
  if (!t || !num(t.id)) throw new Error('На странице турнира нет данных tournament');
  const c = country(t.country);
  const tournament = { source_id: num(t.id), game_code: game, slug: str(t.slug), name: str(t.name) || '—', tier: str(t.tier), tier_rank: num(t.tier_rank), prize: num(t.prize),
    players_prize: num(t.players_prize), teams_prize: num(t.teams_prize), image_url: str(t.image_url), banner_url: str(t.banner_image_url),
    start_date: str(t.start_date), end_date: str(t.end_date), event_type: str(t.event_type), source_status: str(t.status), description: str(t.description),
    region_name: t.region ? str(t.region.name) : null, country_name: c.name, source_url: url(base, game, 'tournaments', t.slug) };
  const teams = new Map(); const participants = new Map();
  const addTeam = (x) => { const r = teamRef(x, game, base); if (r) teams.set(r.source_id, r); return r; };
  const part = (tid) => { if (!participants.has(tid)) participants.set(tid, { team_source_id: tid, place: null, money: null, points: null, players: [] }); return participants.get(tid); };
  for (const x of arr(t.teams)) { const r = addTeam(x); if (r) part(r.source_id); }
  for (const x of [...arr(t.teams_has_tournaments), ...arr(tsx.tournamentPrizes)]) {
    const tid = num(x.team_id); if (!tid) continue; addTeam(x.teams);
    const p = part(tid); p.place = str(x.place) ?? p.place; p.money = num(x.money) ?? p.money; p.points = num(x.points) ?? p.points;
  }
  const squads = findData(state, 'get-tournament-redefined-teams-squad');
  const players = new Map();
  for (const sq of arr(squads)) {
    const tid = num(sq.team_id); if (!tid) continue;
    addTeam({ id: tid, slug: sq.team_slug, name: sq.team_name, image_url: sq.team_image_url });
    part(tid).players = arr(sq.players).map((p) => { const r = playerRef(p, game, base, null); if (r) players.set(r.source_id, r);
      return r ? { player_source_id: r.source_id, nickname: r.nickname, is_coach: r.is_coach, is_standin: p.is_standin ? 1 : 0, money: num(p.money) } : null; }).filter(Boolean);
  }
  // Стадии → раунды → матчи (сетка). Связи между матчами — prev_match*_id из источника.
  const stages = arr(t.stages).map((s) => ({
    source_id: num(s.id), title: str(s.title), format_type: str(s.format_type), status: str(s.status), start_date: str(s.start_date), end_date: str(s.end_date), seq: num(s.sequence_number),
    rounds: arr(s.rounds).map((r) => ({ source_id: num(r.id), name: str(r.name), round_index: num(r.round_index), bracket_type: str(r.bracket_type), start_at: str(r.start_at),
      matches: arr(r.matches).map((m) => { addTeam(m.team1); addTeam(m.team2);
        return { match_source_id: num(m.id), slug: str(m.slug), position: num(m.position), team1_source_id: num(m.team1_id), team2_source_id: num(m.team2_id),
          team1_score: num(m.team1_score), team2_score: num(m.team2_score), winner_team_source_id: num(m.winner_team_id), status: str(m.status), start_date: str(m.start_date),
          bo_type: num(m.bo_type), prev_match1_source_id: num(m.prev_match1_id), prev_match2_source_id: num(m.prev_match2_id) }; }).filter((m) => m.match_source_id) })).filter((r) => r.source_id),
  })).filter((s) => s.source_id);
  const top = findData(state, 'widget-top-players-minified');
  const playerStats = arr(top && top.results).map((r) => {
    const pr = playerRef(r.player, game, base, undefined); if (pr) players.set(pr.source_id, pr);
    const pid = num(r.player_id) || (pr && pr.source_id); if (!pid) return null;
    return { player_source_id: pid, games_count: num(r.games_count), rounds_count: num(r.rounds_count), rating: num(r.avg_player_rating), kills: num(r.avg_kills),
      deaths: num(r.avg_death), assists: num(r.avg_assists), damage: num(r.avg_damage), kd: num(r.avg_kd_rate), stats_json: JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== 'player' && typeof v === 'number'))) };
  }).filter(Boolean);
  // матчи турнира: из списков на странице и из сетки (pinia)
  const listed = extractFromState({ data: state.data, stages: t.stages }, game, base);
  for (const m of listed.matches) if (!m.tournament_source_id) m.tournament_source_id = tournament.source_id;
  return { tournament, teams: [...teams.values()], participants: [...participants.values()], players: [...players.values()], stages, player_stats: playerStats, listed };
}

// ---------------- Списки турниров ----------------
function parseTournamentListState(state, game, base) {
  const d = findData(state, 'table-tournaments');
  const teams = new Map(); const links = [];
  const tournaments = arr(d && d.results).filter((t) => num(t.id) && str(t.name)).map((t) => {
    for (const x of arr(t.teams)) { const r = teamRef(x, game, base); if (r) { teams.set(r.source_id, r); links.push({ tournament_source_id: num(t.id), team_source_id: r.source_id }); } }
    return { source_id: num(t.id), game_code: game, slug: str(t.slug), name: t.name, tier: str(t.tier), prize: num(t.prize), image_url: str(t.image_url),
      start_date: str(t.start_date), end_date: str(t.end_date), source_status: str(t.status), source_url: url(base, game, 'tournaments', t.slug) };
  });
  return { tournaments, teams: [...teams.values()], participants: links };
}

// ---------------- Рейтинг Valve (публикуется на BO3.GG) ----------------
function parseValveRankingState(state, game, base) {
  const d = findData(state, 'teams-ranking-');
  const rows = arr(d && d.data); const out = []; const teams = new Map(); const players = new Map();
  rows.forEach((r, i) => {
    const t = teamRef(r.team, game, base); if (!t) return; teams.set(t.source_id, t);
    for (const p of arr(r.roster_players)) { const pr = playerRef(p, game, base, undefined); if (pr) { pr.team_source_id = null; players.set(pr.source_id, pr); } }
    out.push({ position: i + 1, team_source_id: t.source_id, score: num(r.score), region: str(r.region), ranking_date: str(r.ranking_date),
      roster: arr(r.roster_players).map((p) => ({ player_source_id: num(p.id), nickname: str(p.nickname), score: num(p.score) })) });
  });
  const dates = arr(pinia(state, 'filters').valveRankingDates).filter((x) => typeof x === 'string');
  return { rows: out, teams: [...teams.values()], players: [...players.values()], available_dates: dates };
}

const fromHtml = (fn) => (html, game, base) => fn(extractNuxtState(html), game, base);
module.exports = {
  parseTeamState, parsePlayerState, parseTournamentState, parseTournamentListState, parseValveRankingState, transfer,
  parseTeamHtml: fromHtml(parseTeamState), parsePlayerHtml: fromHtml(parsePlayerState), parseTournamentHtml: fromHtml(parseTournamentState),
  parseTournamentListHtml: fromHtml(parseTournamentListState), parseValveRankingHtml: fromHtml(parseValveRankingState),
};
