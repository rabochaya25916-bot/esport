// Адаптер BO3.GG. Использует ТОЛЬКО публичные HTML-страницы, разрешённые robots.txt.
// /api/ закрыт в robots.txt — мы к нему не обращаемся. Данные берутся из
// серверного состояния страницы (window.__NUXT__), которое Nuxt встраивает в HTML.
const vm = require('vm');

const GAMES = {
  cs2:   { prefix: '' },
  dota2: { prefix: '/dota2' },
  lol:   { prefix: '/lol' },
};

// Список страниц одного цикла синхронизации (9 запросов + robots.txt).
function syncPages() {
  const pages = [];
  for (const [game, { prefix }] of Object.entries(GAMES)) {
    pages.push({ game, kind: 'matches', path: `${prefix}/matches/current` });
    pages.push({ game, kind: 'matches', path: `${prefix}/matches/finished` });
    pages.push({ game, kind: 'news', path: `${prefix}/news` });
  }
  return pages;
}

// --- robots.txt ---------------------------------------------------------
function parseRobots(txt) {
  const rules = []; let applies = false; let sawAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...rest] = line.split(':'); const v = rest.join(':').trim(); const key = k.toLowerCase();
    if (key === 'user-agent') { if (sawAgent && rules.length && !applies) {} applies = v === '*'; sawAgent = true; }
    else if (key === 'disallow' && applies && v) rules.push(v);
  }
  return rules;
}
function robotsAllows(rules, path) {
  return !rules.some((r) => {
    const re = new RegExp('^' + r.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
    return re.test(path);
  });
}

// --- извлечение ----------------------------------------------------------
function extractNuxtState(html) {
  const i = html.indexOf('window.__NUXT__=');
  if (i < 0) throw new Error('На странице нет window.__NUXT__ — структура источника изменилась');
  const j = html.indexOf('</script>', i);
  const sandbox = { window: {} };
  // Изолированный контекст без доступа к require/process; ограничение по времени.
  vm.runInNewContext(html.slice(i, j), sandbox, { timeout: 3000 });
  return sandbox.window.__NUXT__;
}

function walk(root, visit) {
  const seen = new Set(); const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== 'object' || seen.has(o)) continue;
    seen.add(o); visit(o);
    for (const k in o) stack.push(o[k]);
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v ? v : null);
function mapStatus(s) {
  if (s === 'upcoming') return 'upcoming';
  if (s === 'current' || s === 'live') return 'live';
  if (s === 'finished' || s === 'defwin') return 'finished';
  return 'other';
}

function extractFromState(state, game, base) {
  const out = { matches: new Map(), teams: new Map(), tournaments: new Map(), players: new Map(), articles: new Map() };
  const P = GAMES[game].prefix;
  const addTeam = (t) => {
    if (!t || !num(t.id) || !str(t.name)) return;
    out.teams.set(t.id, { source_id: t.id, game_code: game, slug: str(t.slug), name: t.name,
      image_url: str(t.image_url), country_code: t.country ? str(t.country.code) : null, country_name: t.country ? str(t.country.name) : null, rank: num(t.rank), source_url: t.slug ? `${base}${P}/teams/${t.slug}` : null });
  };
  walk(state.data || state, (o) => {
    // Матч: есть slug, start_date и поля team1/team2
    if (num(o.id) && str(o.slug) && 'start_date' in o && ('team1_id' in o || 'team1' in o) && str(o.status)) {
      addTeam(o.team1); addTeam(o.team2);
      const tr = o.tournament;
      if (tr && num(tr.id) && str(tr.name)) out.tournaments.set(tr.id, { source_id: tr.id, game_code: game, slug: str(tr.slug), name: tr.name,
        tier: str(tr.tier), prize: num(tr.prize), image_url: str(tr.image_url), source_url: tr.slug ? `${base}${P}/tournaments/${tr.slug}` : null });
      out.matches.set(o.id, {
        source_id: o.id, game_code: game, slug: o.slug, status: mapStatus(o.status), source_status: o.status,
        start_date: str(o.start_date), end_date: str(o.end_date), bo_type: num(o.bo_type), tier: str(o.tier), tier_rank: num(o.tier_rank),
        stage_id: num(o.stage_id), parsed_status: str(o.parsed_status), winner_team_source_id: num(o.winner_team_id),
        tournament_source_id: tr && num(tr.id) ? tr.id : num(o.tournament_id),
        games_json: Array.isArray(o.games) ? JSON.stringify(o.games.map((g) => ({ number: num(g.number), status: str(g.status), map_name: str(g.map_name) }))) : null,
        source_url: `${base}${P}/matches/${o.slug}`,
        teams: [
          { team_source_id: num(o.team1_id) ?? (o.team1 && num(o.team1.id)), score: num(o.team1_score) },
          { team_source_id: num(o.team2_id) ?? (o.team2 && num(o.team2.id)), score: num(o.team2_score) },
        ],
      });
    }
    // Игрок: nickname + team_id/discipline_id (авторы статей сюда не попадают)
    if (num(o.id) && str(o.nickname) && 'discipline_id' in o && 'is_coach' in o) {
      out.players.set(o.id, { source_id: o.id, game_code: game, team_source_id: num(o.team_id), slug: str(o.slug), nickname: o.nickname,
        first_name: str(o.first_name), last_name: str(o.last_name), country_code: o.country ? str(o.country.code) : null,
        country_name: o.country ? str(o.country.name) : null, image_url: str(o.image_url), is_coach: o.is_coach ? 1 : 0,
        total_prize: num(o.total_prize), source_url: o.slug ? `${base}${P}/players/${o.slug}` : null });
    }
    // Статья
    if (num(o.id) && str(o.title) && str(o.slug) && 'published_at' in o && 'news_category_id' in o) {
      out.articles.set(o.id, { source_id: o.id, game_code: game, slug: o.slug, title: o.title, description: str(o.description),
        image_url: str(o.title_image_url), published_at: str(o.published_at), source_url: `${base}${P}/news/${o.slug}` });
    }
  });
  const arr = (m) => [...m.values()];
  return { matches: arr(out.matches), teams: arr(out.teams), tournaments: arr(out.tournaments), players: arr(out.players), articles: arr(out.articles) };
}

function extractFromHtml(html, game, base) { return extractFromState(extractNuxtState(html), game, base); }

module.exports = { GAMES, syncPages, parseRobots, robotsAllows, extractNuxtState, extractFromState, extractFromHtml, mapStatus };
