// Разбор страницы отдельного матча BO3.GG (/matches/<slug>, /dota2/matches/<slug>, /lol/matches/<slug>).
// Данные берутся из pinia-состояния, встроенного в HTML публичной страницы. Набор полей у каждой
// дисциплины свой — CS2, Dota 2 и LoL разбираются разными функциями. Отсутствующее поле = null,
// ничего не вычисляется «на глаз» и не подставляется.
const { extractNuxtState, mapStatus, GAMES } = require('./bo3');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (num(v) == null ? null : Math.round(v));
const str = (v) => (typeof v === 'string' && v ? v : null);
const arr = (v) => (Array.isArray(v) ? v : Array.isArray(v?.results) ? v.results : []);
const bool = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' ? (v ? 1 : 0) : null);
const SKIP = /(^|_)(id|ids)$|_at$|image|icon|data$|^ps_|grid_id/;
// Все скалярные числовые поля объекта — для stats_json (без идентификаторов и служебных дат)
function scalars(o) {
  const r = {};
  if (!o || typeof o !== 'object') return r;
  for (const [k, v] of Object.entries(o)) {
    if (SKIP.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) r[k] = v;
    else if (typeof v === 'boolean') r[k] = v;
    else if (k === 'multikills' && v && typeof v === 'object') r[k] = { ...v };
  }
  return r;
}
const json = (o) => (o && Object.keys(o).length ? JSON.stringify(o) : null);

function teamOf(t, game, base) {
  if (!t || !num(t.id) || !str(t.name)) return null;
  return { source_id: t.id, game_code: game, slug: str(t.slug), name: t.name, image_url: str(t.image_url),
    country_code: str(t.country?.code), country_name: str(t.country?.name), rank: num(t.rank),
    source_url: t.slug ? `${base}${GAMES[game].prefix}/teams/${t.slug}` : null };
}

// Составы: CS2 отдаёт игроков напрямую, LoL/Dota — как { player: {...} }
function lineupOf(lineup) {
  const out = [];
  if (!lineup || typeof lineup !== 'object') return out;
  for (const [teamId, list] of Object.entries(lineup)) {
    const tid = Number(teamId); if (!Number.isFinite(tid)) continue;
    for (const raw of arr(list)) {
      // Варианты: { id, nickname, ... } | { player: { id, nickname } } | { id, slug, player: { nickname } } (текущий матч)
      const p = raw && raw.player && str(raw.player.nickname) ? { ...raw, ...raw.player, id: num(raw.player.id) ?? num(raw.id) } : raw;
      if (!p || !num(p.id) || !str(p.nickname)) continue;
      out.push({ team_source_id: tid, player_source_id: p.id, nickname: p.nickname, slug: str(p.slug),
        country_code: str(p.country?.code), image_url: str(p.image_url), first_name: str(p.first_name), last_name: str(p.last_name) });
    }
  }
  return out;
}

function baseStat(o) {
  return { role: null, hero: null, hero_image_url: null, kills: int(o.kills), deaths: int(o.deaths ?? o.death), assists: int(o.assists),
    adr: null, rating: null, kast: null, headshots: null, first_kills: null, first_deaths: null, gold_per_min: null, xp_per_min: null,
    last_hits: null, denies: null, net_worth: null, hero_damage: null, creep_score: null, gold_earned: null, kill_participation: null };
}

// ---------- CS2 ----------
function cs2(state, out) {
  const P = state.pinia || {};
  // Для текущих матчей список карт есть только в самом матче (без счёта по картам)
  const games = arr(P.games?.games).length ? arr(P.games.games) : arr(P.matches?.match?.games);
  for (const g of games) {
    if (!num(g.id)) continue;
    const w = g.winner_team_clan?.team_id ?? g.winner_team_clan?.team?.id; const l = g.loser_team_clan?.team_id ?? g.loser_team_clan?.team?.id;
    out.games.push({ source_id: g.id, number: num(g.number), map_name: str(g.map_name), status: str(g.status), state: str(g.state),
      begin_at: str(g.begin_at), end_at: null,
      // CS2: длительность приходит в наносекундах
      duration_sec: num(g.duration) != null ? Math.round(g.duration / 1e9) : null,
      winner_team_source_id: num(w), loser_team_source_id: num(l),
      winner_score: num(g.winner_clan_score), loser_score: num(g.loser_clan_score), rounds_count: num(g.rounds_count),
      sides: arr(g.game_side_results).filter((s) => num(s.order) != null).map((s) => ({ ord: s.order, overtime: bool(s.overtime),
        winner_team_name: str(s.winner_clan_name), winner_side: str(s.winner_clan_side), winner_score: num(s.winner_clan_score),
        loser_team_name: str(s.loser_clan_name), loser_side: str(s.loser_clan_side), loser_score: num(s.loser_clan_score) })),
      // В раундах сторона закодирована числом: 2 = T, 3 = CT (как в демо-файлах CS2)
      rounds: arr(g.game_rounds).filter((r) => num(r.round_number) != null).map((r) => ({ round_number: r.round_number,
        winner_team_name: str(r.winner_clan_name), winner_side: r.winner_clan_side === 3 ? 'CT' : r.winner_clan_side === 2 ? 'T' : str(r.winner_clan_side),
        end_reason: str(r.end_reason), winner_score: num(r.winner_clan_score), loser_score: num(r.loser_clan_score),
        duration_sec: num(r.round_duration) != null ? Math.round(r.round_duration / 1e7) / 100 : null })),
    });
  }
  const byGameId = new Map(out.games.map((g) => [g.source_id, g]));
  const teamsStats = arr(P.matches?.teamsWithPlayersStats).length ? arr(P.matches.teamsWithPlayersStats) : arr(P.matches?.playersStatsByTeam);
  for (const t of teamsStats) {
    for (const s of arr(t.players)) {
      const pl = s.steam_profile?.player; const pid = num(pl?.id) ?? num(s.steam_profile?.player_id);
      if (pid == null) continue;
      const team = num(s.team_clan?.team_id) ?? num(t.id);
      const st = { ...baseStat(s), adr: num(s.adr), rating: num(s.player_rating), kast: num(s.kast), headshots: int(s.headshots),
        first_kills: int(s.first_kills), first_deaths: int(s.first_death) };
      out.playerStats.push({ scope: 0, player_source_id: pid, team_source_id: team, nickname: str(pl?.nickname) ?? str(s.steam_profile?.nickname), ...st, stats_json: json(scalars(s)) });
      if (pl && !out.lineup.some((x) => x.player_source_id === pid) && team != null) out.lineup.push({ team_source_id: team, player_source_id: pid, nickname: pl.nickname, slug: str(pl.slug), country_code: str(pl.country?.code), image_url: str(pl.image_url), first_name: str(pl.first_name), last_name: str(pl.last_name) });
      // На странице матча по каждой карте BO3.GG публикует только рейтинг игрока
      for (const gp of arr(s.steam_profile?.game_steam_profiles)) {
        if (!byGameId.has(gp.game_id) || num(gp.player_rating) == null) continue;
        out.playerStats.push({ scope: gp.game_id, player_source_id: pid, team_source_id: team, nickname: str(pl?.nickname), ...baseStat({}),
          rating: num(gp.player_rating), stats_json: null });
      }
    }
  }
}

// ---------- Dota 2 / LoL ----------
function moba(state, out, game) {
  const P = state.pinia || {};
  const list = arr(P.matches?.gamesWithPlayersStats).length ? arr(P.matches.gamesWithPlayersStats) : arr(P.games?.games);
  const nick = new Map(out.lineup.map((x) => [x.player_source_id, x.nickname]));
  const teamsKey = game === 'dota2' ? 'dota2_game_teams' : 'lol_game_teams';
  const playersKey = game === 'dota2' ? 'dota2_game_players' : 'lol_game_players';
  for (const g of list) {
    if (!num(g.id)) continue;
    out.games.push({ source_id: g.id, number: num(g.game_number ?? g.number), map_name: null, status: str(g.status), state: str(g.state),
      begin_at: str(g.begin_at), end_at: str(g.end_at), duration_sec: int(g.duration),
      winner_team_source_id: num(g.winner_team_id), loser_team_source_id: num(g.loser_team_id),
      winner_score: num(g.winner_score), loser_score: num(g.loser_score), rounds_count: null, sides: [], rounds: [] });
    for (const t of arr(g[teamsKey])) {
      if (!num(t.team_id)) continue;
      const side = game === 'dota2' ? (t.side === 1 ? 'Radiant' : t.side === 2 ? 'Dire' : null) : str(t.color) ?? (t.side != null ? String(t.side) : null);
      out.teamStats.push({ scope: g.id, team_source_id: t.team_id, side,
        kills: int(game === 'dota2' ? t.score : t.kills), deaths: int(t.deaths), assists: int(t.assists), gold: int(t.gold_earned),
        towers: int(game === 'dota2' ? null : t.kills_towers), dragons: int(t.dragon_kills), barons: int(t.baron_kills), roshans: int(t.roshan_kills),
        first_blood: bool(t.first_blood), first_tower: bool(t.first_tower), stats_json: json(scalars(t)) });
    }
    for (const p of arr(g[playersKey])) {
      const pid = num(p.player_id); if (pid == null) continue;
      const hero = game === 'dota2' ? p.dota2_hero : p.lol_champion;
      const st = { ...baseStat(p), role: p.role != null ? String(p.role) : null,
        hero: str(hero?.localized_name) ?? str(hero?.name), hero_image_url: str(hero?.image_url) ?? str(hero?.icon_url),
        gold_per_min: num(p.gold_per_min), xp_per_min: num(p.xp_per_min), last_hits: int(p.last_hits), denies: int(p.denies),
        net_worth: int(p.net_worth), hero_damage: int(game === 'dota2' ? p.hero_damage : p.total_damage_dealt_to_champions),
        creep_score: int(p.creep_score), gold_earned: int(p.gold_earned), kill_participation: num(p.kill_participation) };
      out.playerStats.push({ scope: g.id, player_source_id: pid, team_source_id: num(p.team_id), nickname: nick.get(pid) ?? null, ...st, stats_json: json(scalars(p)) });
    }
  }
}

function extractMatchDetails(state, game, base) {
  const m = state?.pinia?.matches?.match;
  if (!m || !num(m.id)) throw new Error('На странице матча нет данных матча (pinia.matches.match)');
  const out = { match: null, teams: [], tournament: null, lineup: lineupOf(state.pinia.matches.lineup), games: [], playerStats: [], teamStats: [] };
  for (const t of [m.team1, m.team2]) { const x = teamOf(t, game, base); if (x) out.teams.push(x); }
  const tr = m.tournament;
  if (tr && num(tr.id) && str(tr.name)) out.tournament = { source_id: tr.id, game_code: game, slug: str(tr.slug), name: tr.name, tier: str(tr.tier),
    prize: num(tr.prize), image_url: str(tr.image_url), source_url: tr.slug ? `${base}${GAMES[game].prefix}/tournaments/${tr.slug}` : null,
    start_date: str(tr.start_date), end_date: str(tr.end_date), event_type: str(tr.event_type), source_status: str(tr.status), description: str(tr.description) };
  out.match = { source_id: m.id, game_code: game, slug: str(m.slug), status: mapStatus(m.status), source_status: str(m.status),
    start_date: str(m.start_date), end_date: str(m.end_date), bo_type: num(m.bo_type), tier: str(m.tier), tier_rank: num(m.tier_rank),
    stage_id: num(m.stage_id), parsed_status: str(m.parsed_status), winner_team_source_id: num(m.winner_team_id),
    tournament_source_id: num(tr?.id) ?? num(m.tournament_id), source_url: `${base}${GAMES[game].prefix}/matches/${m.slug}`,
    teams: [{ team_source_id: num(m.team1_id) ?? num(m.team1?.id), score: num(m.team1_score) }, { team_source_id: num(m.team2_id) ?? num(m.team2?.id), score: num(m.team2_score) }] };
  if (game === 'cs2') cs2(state, out); else moba(state, out, game);
  return out;
}

// Окончательная ли статистика: матч завершён и источник сообщает о завершённом разборе всех игр
function isFinal(d) {
  if (d.match.status !== 'finished') return false;
  if (d.match.parsed_status === 'done') return true;
  if (d.match.parsed_status === 'rejected') return true; // источник явно отказался разбирать — повторять бессмысленно
  return d.games.length > 0 && d.games.every((g) => g.state === 'done' || g.state === 'no_stats');
}

const extractMatchDetailsFromHtml = (html, game, base) => extractMatchDetails(extractNuxtState(html), game, base);
module.exports = { extractMatchDetails, extractMatchDetailsFromHtml, isFinal, lineupOf, scalars };
