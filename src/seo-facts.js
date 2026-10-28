// Факты о сущностях для SEO-шаблонов (assets/js/seo-templates.js). Используется сервером (src/seo.js) и предгенерацией.
// Браузерные ES-модули без импортов (шаблоны, конфиги, разбор прицела, список каналов) загружаются в Node как data:-модули.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const esm = (rel) => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
let shared = null;
function loadShared() {
  if (!shared) shared = Promise.all([esm('assets/js/seo-templates.js'), esm('assets/js/data/configs.js'), esm('assets/js/crosshair.js'), esm('assets/js/brand.js')])
    .then(([T, C, X, B]) => ({ T, configs: C.PLAYER_CONFIGS, XH: X, BRAND: B.BRAND, streams: JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/js/data/streams-config.json'), 'utf8')), cs2: loadCs2() }));
  return shared;
}

// Данные парсеров конфигов и прицелов (scripts/update-cs2-content.js)
const CS2_DIR = path.join(ROOT, 'assets/js/data/cs2');
const readJ = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
function loadCs2() {
  const cfg = readJ(path.join(CS2_DIR, 'configs.json'), { items: [] }); const xh = readJ(path.join(CS2_DIR, 'crosshairs.json'), { items: [] });
  return { configs: cfg.items || [], crosshairs: xh.items || [], cfgBySlug: new Map((cfg.items || []).map((c) => [c.slug, c])), xhBySlug: new Map((xh.items || []).map((c) => [c.slug, c])),
    detail: (id) => (/^\d+$/.test(id) ? readJ(path.join(CS2_DIR, 'configs', id + '.json'), null) : null) };
}
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugOf = (s) => { try { return encodeURIComponent(decodeURIComponent(s).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-')); } catch { return ''; } };
const safeDecode = (XH, code) => { try { return code ? XH.decode(code) : null; } catch { return null; } };
function configFor(S, p) {
  const n = String(p.nickname || '').toLowerCase();
  return S.configs.find((c) => (c.player_id && c.player_id === p.id) || (n && String(c.nickname || '').toLowerCase() === n)) || null;
}

function makeFacts(db, S) {
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return null; } };
  const dupNick = new Map(); const dupTeam = new Map();
  try { for (const r of db.prepare('SELECT game_code, lower(nickname) n, COUNT(*) c FROM players GROUP BY 1,2 HAVING c>1').all()) dupNick.set(r.game_code + ':' + r.n, r.c); } catch {}
  try { for (const r of db.prepare('SELECT game_code, lower(name) n, COUNT(*) c FROM teams GROUP BY 1,2 HAVING c>1').all()) dupTeam.set(r.game_code + ':' + r.n, r.c); } catch {}

  function player(id) {
    const p = one(`SELECT p.*, t.id AS team_id, t.name AS team_name FROM players p LEFT JOIN teams t ON t.game_code=p.game_code AND t.source_id=p.team_source_id WHERE p.id=?`, id);
    if (!p) return null;
    const c = p.game_code === 'cs2' ? configFor(S, p) : null;
    const real = [p.first_name, p.last_name].filter(Boolean).join(' ');
    const mc = one('SELECT COUNT(DISTINCT match_id) c FROM match_player_stats WHERE player_source_id=? AND scope_game_id=0', p.source_id);
    return { id: p.id, nickname: p.nickname, real_name: real || null, team: p.team_name || null, team_id: p.team_id || null, game: p.game_code, country: p.country_name || null,
      role: p.is_coach ? 'тренер' : null, birthday: p.birthday || null, has_config: !!c, has_crosshair: !!(c && safeDecode(S.XH, c.crosshair)), matches_count: mc ? mc.c : 0,
      image: p.image_url, path: `/player/${p.id}`, disambig: dupNick.has(p.game_code + ':' + String(p.nickname).toLowerCase()) ? (p.team_name || real || null) : null, updated_at: p.updated_at };
  }
  function team(id) {
    const t = one('SELECT * FROM teams WHERE id=?', id); if (!t) return null;
    const roster = (() => { try { return db.prepare('SELECT id, nickname FROM players WHERE game_code=? AND team_source_id=?').all(t.game_code, t.source_id); } catch { return []; } })();
    const cfgs = t.game_code === 'cs2' ? roster.map((p) => configFor(S, p)).filter(Boolean) : [];
    const mc = one('SELECT COUNT(*) c FROM match_teams mt JOIN matches m ON m.id=mt.match_id WHERE m.game_code=? AND mt.team_source_id=?', t.game_code, t.source_id);
    return { id: t.id, name: t.name, game: t.game_code, country: t.country_name, rank: t.rank, roster_count: roster.length, roster_synced_at: t.profile_synced_at || t.updated_at,
      has_player_configs: cfgs.length > 0, has_player_crosshairs: cfgs.some((c) => safeDecode(S.XH, c.crosshair)), matches_count: mc ? mc.c : 0, image: t.image_url, path: `/team/${t.id}`,
      disambig: dupTeam.has(t.game_code + ':' + String(t.name).toLowerCase()) ? (t.country_name || null) : null, updated_at: t.updated_at };
  }
  function match(id) {
    const x = one(`SELECT m.id, m.game_code, m.status, m.start_date, m.updated_at, t.id AS tid, t.name AS tour, a.name AS t1, b.name AS t2, mt1.score AS s1, mt2.score AS s2,
        (SELECT COUNT(*) FROM match_games g WHERE g.match_id=m.id) AS maps FROM matches m
      LEFT JOIN tournaments t ON t.game_code=m.game_code AND t.source_id=m.tournament_source_id
      LEFT JOIN match_teams mt1 ON mt1.match_id=m.id AND mt1.position=1 LEFT JOIN match_teams mt2 ON mt2.match_id=m.id AND mt2.position=2
      LEFT JOIN teams a ON a.game_code=m.game_code AND a.source_id=mt1.team_source_id LEFT JOIN teams b ON b.game_code=m.game_code AND b.source_id=mt2.team_source_id WHERE m.id=?`, id);
    if (!x) return null;
    const links = S.streams.links || [];
    const linked = links.some((l) => l.match_id === x.id || (x.tid && l.tournament_id === x.tid)) || (S.streams.channels || []).some((c) => x.tid && (c.tournaments || []).includes(x.tid));
    return { id: x.id, t1: x.t1, t2: x.t2, s1: x.status === 'upcoming' ? null : x.s1, s2: x.status === 'upcoming' ? null : x.s2, status: x.status, start_date: x.start_date, tournament: x.tour, tournament_id: x.tid,
      game: x.game_code, maps_count: x.maps || 0, has_linked_streams: linked, path: `/match/${x.id}`, updated_at: x.updated_at };
  }
  function tournament(id) {
    const t = one('SELECT * FROM tournaments WHERE id=?', id); if (!t) return null;
    const tc = one('SELECT COUNT(*) c FROM tournament_teams WHERE game_code=? AND tournament_source_id=?', t.game_code, t.source_id);
    return { id: t.id, name: t.name, game: t.game_code, start_date: t.start_date, end_date: t.end_date, prize: t.prize, teams_count: tc ? tc.c : 0, image: t.image_url, path: `/tournament/${t.id}`, updated_at: t.updated_at };
  }
  return { player, team, match, tournament };
}

// Метаданные для логического пути. null — такой страницы нет (404).
function metaForPath(S, F, p, origin, site) {
  const T = S.T; let m;
  if (p === '/') return T.home(site, S.BRAND.tagline);
  if (T.STATIC_PAGES[p]) return T.staticPage(site, p);
  if ((m = p.match(/^\/player\/(\d+)$/))) { const f = F.player(m[1]); return f && { ...T.player(site, f, origin), image: f.image }; }
  if ((m = p.match(/^\/team\/(\d+)$/))) { const f = F.team(m[1]); return f && { ...T.team(site, f, origin), image: f.image }; }
  if ((m = p.match(/^\/match\/(\d+)$/))) { const f = F.match(m[1]); return f && T.match(site, f, origin); }
  if ((m = p.match(/^\/tournament\/(\d+)$/))) { const f = F.tournament(m[1]); return f && { ...T.tournament(site, f, origin), image: f.image }; }
  if ((m = p.match(/^\/config\/([^/]+)$/)) && S.cs2 && S.cs2.cfgBySlug.has(slugOf(m[1]))) {
    const s = S.cs2.cfgBySlug.get(slugOf(m[1])); const c = S.cs2.detail(s.id); if (!c) return null;
    const mt = T.proConfig(site, c, origin, `/config/${s.slug}`);
    const ms = (c.cvars && c.cvars.mouse) || {};
    return { ...mt, ssr: `<dl class="spec">${Object.entries(ms).map(([k, v]) => `<div><dt>${escH(k)}</dt><dd>${escH(v)}</dd></div>`).join('')}</dl><p><a href="../../crosshairs/">Прицелы CS2</a> · <a href="../../configs/">Все конфиги</a></p>` };
  }
  if ((m = p.match(/^\/crosshair\/([^/]+)$/)) && S.cs2 && S.cs2.xhBySlug.has(slugOf(m[1]))) {
    const c = S.cs2.xhBySlug.get(slugOf(m[1]));
    const mt = T.proCrosshair(site, c, safeDecode(S.XH, c.code), origin, `/crosshair/${c.slug}`);
    return mt && { ...mt, ssr: `<p>Код прицела: <code class="mono">${escH(c.code)}</code></p><p><a href="../../crosshairs/">Все прицелы CS2</a></p>` };
  }
  if ((m = p.match(/^\/config\/([^/]+)$/))) {
    const c = S.configs.find((x) => T.slugNick(x.nickname) === T.slugNick(decodeURIComponent(m[1]))); return c && T.config(site, c, origin, `/config/${T.slugNick(c.nickname)}`);
  }
  if ((m = p.match(/^\/crosshair\/([^/]+)$/))) {
    const c = S.configs.find((x) => T.slugNick(x.nickname) === T.slugNick(decodeURIComponent(m[1]))); return c ? T.crosshair(site, c, safeDecode(S.XH, c.crosshair), origin, `/crosshair/${T.slugNick(c.nickname)}`) : null;
  }
  return null;
}

module.exports = { loadShared, makeFacts, metaForPath, safeDecode };
