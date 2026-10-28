import { BRAND } from '../brand.js';
import { playerSetupSection, fillPlayerSetup } from './cs2.js';
import { mountStreams } from '../streams.js';
// Каталоги и профили: команды, игроки, турниры.
import * as SEO from '../seo-templates.js';
import { setSeo, seoOrigin } from '../core.js';
import { findConfig } from './cs2.js';
import { decode as xhDecode } from '../crosshair.js';
import { get, getPage, gq, state, esc, GN, logo, avatar, fmt, day, ago, num, money, pct, setMeta, skeleton, errorBox, empty, emptySm, safeHref } from '../core.js';
import { teamItem, playerItem, tourItem, matchGrid, matchRowsByDay, sec, kv, tbl, bar, bars, sparkline, srcTag, drvTag, teamLink, playerLink, TOUR_ST, pager } from '../ui.js';
import { setQuery } from '../router.js';

// ---------- Общий каталог с поиском, сортировкой, фильтрами и пагинацией ----------
export function catalog({ kind, title, lead, sorts, filters = [], render, layout = 'list', per = 24, meta }) {
  return async (ctx) => {
    const q = ctx.query;
    const st = { q: q.get('q') || '', sort: q.get('sort') || sorts[0][0], page: Math.max(1, parseInt(q.get('page'), 10) || 1) };
    for (const f of filters) st[f.key] = q.get(f.key) || '';
    setMeta(meta);
    ctx.app.innerHTML = `<div class="page"><h1>${title}${state.game !== 'all' ? ' · ' + GN[state.game] : ''}</h1><p class="lead">${lead}</p>
      <div class="toolbar"><input class="inp grow" id="cq" type="search" placeholder="Поиск по названию" value="${esc(st.q)}" maxlength="80" aria-label="Поиск">
      <label class="lbl">Сортировка <select class="sel" id="cs">${sorts.map(([k, l]) => `<option value="${k}" ${k === st.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${filters.map((f) => `<label class="lbl">${f.label} <select class="sel" data-f="${f.key}">${f.options.map(([k, l]) => `<option value="${k}" ${k === st[f.key] ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`).join('')}</div>
      <div id="cb">${skeleton(9, 'list')}</div><div id="cp"></div></div>`;
    const box = ctx.app.querySelector('#cb'); const pg = ctx.app.querySelector('#cp');
    const load = async () => {
      setQuery({ ...st, page: st.page > 1 ? st.page : '', sort: st.sort === sorts[0][0] ? '' : st.sort });
      box.innerHTML = skeleton(9, 'list');
      try {
        const qs = [gq(), st.q && 'q=' + encodeURIComponent(st.q), 'sort=' + st.sort, `limit=${per}`, `offset=${(st.page - 1) * per}`, ...filters.map((f) => st[f.key] && `${f.key}=${encodeURIComponent(st[f.key])}`)].filter(Boolean).join('&');
        const { data, total } = await getPage(`/${kind}?${qs}`, { signal: ctx.signal });
        const pages = Math.max(1, Math.ceil(total / per));
        box.innerHTML = data.length ? (layout === 'table' ? render(data) : `<div class="list">${data.map(render).join('')}</div>`)
          : st.q ? empty('Ничего не найдено', `По запросу «${st.q}» совпадений нет.`) : empty('Пока пусто', 'Данные появятся после синхронизации из источника.');
        pg.innerHTML = pager(st.page, pages, total);
        pg.querySelectorAll('[data-page]').forEach((b) => (b.onclick = () => { st.page = Number(b.dataset.page); load(); window.scrollTo(0, 0); }));
      } catch (e) { if (e.name !== 'AbortError') { box.innerHTML = errorBox(e); pg.innerHTML = ''; } }
    };
    let tm; ctx.app.querySelector('#cq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load(); }, 300); };
    ctx.app.querySelector('#cs').onchange = (e) => { st.sort = e.target.value; st.page = 1; load(); };
    ctx.app.querySelectorAll('select[data-f]').forEach((s) => (s.onchange = () => { st[s.dataset.f] = s.value; st.page = 1; load(); }));
    await load();
  };
}

export const teams = catalog({ kind: 'teams', title: 'Команды', lead: 'Каталог команд. Профили обновляются по расписанию синхронизации.', render: teamItem,
  meta: { title: 'Команды — составы и статистика', description: 'Каталог киберспортивных команд CS2, Dota 2 и LoL: составы, рейтинг, матчи и статистика.' },
  sorts: [['rank', 'Рейтинг'], ['name', 'Название'], ['earned', 'Призовые за 6 мес.'], ['matches', 'Матчей в базе'], ['players', 'Игроков в составе']] });
export const players = catalog({ kind: 'players', title: 'Игроки', lead: 'Игроки и тренеры из составов, матчей и профилей.', render: playerItem,
  meta: { title: 'Игроки — профили и статистика', description: 'Профили игроков и тренеров CS2, Dota 2 и LoL: команды, трансферы, статистика по матчам.' },
  sorts: [['nickname', 'Никнейм'], ['rating', 'Рейтинг за 6 мес.'], ['prize', 'Призовые'], ['matches', 'Матчей в базе']],
  filters: [{ key: 'role', label: 'Роль', options: [['', 'Все'], ['player', 'Игроки'], ['coach', 'Тренеры']] }] });
export const tournaments = catalog({ kind: 'tournaments', title: 'Турниры', lead: 'Турниры: текущие, предстоящие и завершённые.', render: tourItem,
  meta: { title: 'Турниры — сетки, участники, призовые', description: 'Текущие, предстоящие и завершённые турниры CS2, Dota 2 и LoL с сетками и результатами.' },
  sorts: [['start', 'Дата начала'], ['prize', 'Призовой фонд'], ['tier', 'Уровень (tier)'], ['matches', 'Матчей в базе'], ['name', 'Название']],
  filters: [{ key: 'status', label: 'Статус', options: [['', 'Все'], ['current', 'Идут'], ['upcoming', 'Скоро'], ['finished', 'Завершены']] }, { key: 'tier', label: 'Tier', options: [['', 'Любой'], ['s', 'S'], ['a', 'A'], ['b', 'B'], ['c', 'C']] }] });

// ---------- Общие куски профилей ----------
const CH = { join: 'Переход в команду', leave: 'Уход из команды', move: 'Переход', status_change: 'Изменение статуса', joined_detected: 'Появился в составе', left_detected: 'Исчез из состава', other: 'Изменение' };
export const changesTable = (rows, withPlayer = true) => (rows.length ? tbl(`<tr><th>Дата события</th>${withPlayer ? '<th>Игрок</th>' : ''}<th>Изменение</th><th>Откуда</th><th>Куда</th><th>Тип записи</th></tr>${rows.map((c) => `<tr>
  <td class="mono">${c.event_date ? esc(day(c.event_date)) : '<span class="dim">не указана</span>'}</td>${withPlayer ? `<td>${playerLink(c.player)}${c.is_coach ? ' <span class="tag">тренер</span>' : ''}</td>` : ''}
  <td>${CH[c.change_type] || esc(c.change_type)}</td><td>${c.from_team ? teamLink(c.from_team) : '—'}</td><td>${c.to_team ? teamLink(c.to_team) : '—'}</td>
  <td>${c.source_kind === 'source' ? `<span class="tag src">официально</span>` : `<span class="tag drv" title="Обнаружено по разнице снимков состава. Это не официальное объявление.">обнаружено ${esc(day(c.detected_at))}</span>`}</td></tr>`).join('')}`)
  + '<p class="note">«Официально» — трансфер объявлен, дата официальная. «Обнаружено» — система заметила изменение между снимками состава; указана дата обнаружения, а не дата перехода.</p>'
  : emptySm('Изменений состава пока не зафиксировано.'));
const SOC = { website: 'Сайт', twitter: 'X / Twitter', facebook: 'Facebook', twitch: 'Twitch', youtube: 'YouTube', instagram: 'Instagram' };
const socials = (s) => (s ? Object.entries(s).filter(([, v]) => /^https?:\/\//.test(v)).map(([k, v]) => `<a class="btn sm" href="${esc(v)}" target="_blank" rel="noopener nofollow">${SOC[k] || esc(k)} ↗</a>`).join(' ') : '');
function generalStats(g) {
  if (!g) return emptySm('Не опубликованы общую статистику для этого профиля.');
  const rows = [['Матчей', g.matches_count], ['Победы / поражения', g.matches_count != null ? `${num(g.matches_won_count)} / ${num(g.matches_lost_count)}` : null], ['Карт / игр', g.games_count],
    ['Победы / поражения на картах', g.games_count != null ? `${num(g.games_won_count)} / ${num(g.games_lost_count)}` : null], ['Турниров', g.events_count], ['Выиграно турниров', g.events_won_count],
    ['Раундов (выиграно)', g.rounds_count != null ? `${num(g.rounds_count)} (${num(g.rounds_won_count)})` : null], ['K / D / A', g.kills_sum != null ? `${num(g.kills_sum)} / ${num(g.deaths_sum)} / ${num(g.assists_sum)}` : null], ['Урона', g.damage_sum != null ? num(g.damage_sum) : null]];
  const wr = g.matches_count ? g.matches_won_count / g.matches_count : null; const mr = g.games_count ? g.games_won_count / g.games_count : null; const rr = g.rounds_count ? g.rounds_won_count / g.rounds_count : null;
  const derived = `<div class="bars">${[['Победы в матчах', wr], ['Победы на картах', mr], ['Выигранные раунды', rr]].filter(([, v]) => v != null).map(([l, v]) => `<div class="b"><span>${l}</span>${bar(v, 1)}<span>${pct(v)}</span></div>`).join('')}</div>
    ${kv([['K/D', g.deaths_sum ? num(g.kills_sum / g.deaths_sum, 2) : null], ['ADR (урон за раунд)', g.rounds_count && g.damage_sum != null ? num(g.damage_sum / g.rounds_count, 1) : null]])}`;
  return `<div class="cols"><div class="panel">${srcTag}${kv(rows.map(([k, v]) => [k, typeof v === 'number' ? num(v) : v]))}</div><div class="panel">${drvTag}<div style="margin-top:12px">${derived}</div></div></div><p class="note">Период статистики определяется источником (на странице профиля — последние 6 месяцев).</p>`;
}
const statHistory = (h) => (h && h.length > 1 ? `<h3>Снимки статистики</h3>${tbl(`<tr><th>Снимок</th><th class="num">Матчей</th><th class="num">Побед</th><th class="num">Карт</th><th class="num">K / D</th></tr>${h.map((x) => `<tr><td class="mono">${esc(fmt(x.captured_at))}</td><td class="num">${num(x.stats.matches_count)}</td><td class="num">${num(x.stats.matches_won_count)}</td><td class="num">${num(x.stats.games_count)}</td><td class="num">${num(x.stats.kills_sum)} / ${num(x.stats.deaths_sum)}</td></tr>`).join('')}`)}` : '');
const footer = (synced, extra, src) => `<p class="note" style="margin-top:22px">${synced ? 'Профиль обновлён ' + esc(ago(synced)) + ' · ' : ''}${extra}</p>`;

// ---------- Команда ----------
export async function team(ctx) {
  ctx.app.innerHTML = `<div class="page">${skeleton(1, 'grid')}${skeleton(6, 'list')}</div>`;
  const t = await get('/teams/' + ctx.params[0], { signal: ctx.signal });
  { const cfgs = (t.roster || []).map((x) => (t.game_code === 'cs2' ? findConfig(x) : null)).filter(Boolean);
    setSeo(SEO.team(BRAND.name, { name: t.name, game: t.game_code, country: t.country_name, rank: t.rank, roster_count: (t.roster || []).length, roster_synced_at: t.profile_synced_at || t.updated_at,
      has_player_configs: cfgs.length > 0, has_player_crosshairs: cfgs.some((c) => { try { return !!xhDecode(c.crosshair); } catch { return false; } }), matches_count: 1, path: `/team/${t.id}` }, seoOrigin()), `/team/${t.id}`); }
  const rec = t.record;
  const pl = t.roster.filter((p) => !p.is_coach); const coaches = t.roster.filter((p) => p.is_coach);
  const rosterCard = (p) => `<a class="pcard" href="/player/${p.id}">${avatar(p.image_url, p.nickname, 68)}<b>${esc(p.nickname)}</b><small>${esc([p.first_name, p.last_name].filter(Boolean).join(' '))}</small><small>${esc(p.country_name || p.country_code || '')}${p.role ? ' · ' + esc(p.role) : ''}${p.is_coach ? ' · тренер' : ''}</small>${p.six_month_avg_rating != null ? `<small class="mono" title="Средний рейтинг за 6 месяцев">★ ${num(p.six_month_avg_rating, 2)}</small>` : ''}</a>`;
  const valve = t.rankings.filter((r) => r.kind === 'valve'); const bo3r = t.rankings.filter((r) => r.kind === 'bo3_rank');
  const rk = (rows, label) => (rows.length ? `<h3>${label}</h3>${rows.length > 2 ? `<div class="panel" style="padding:10px 14px">${sparkline(rows.slice().reverse().map((r) => -r.position))}<p class="note" style="margin:4px 0 0">Чем выше линия, тем выше место.</p></div>` : ''}${tbl(`<tr><th>Дата</th><th class="num">Место</th>${rows.some((r) => r.score != null) ? '<th class="num">Очки</th>' : ''}</tr>${rows.map((r) => `<tr><td class="mono">${esc(day(r.ranking_date))}</td><td class="num">#${r.position}</td>${rows.some((x) => x.score != null) ? `<td class="num">${num(r.score, 1)}</td>` : ''}</tr>`).join('')}`)}` : '');
  const pool = t.map_pool.filter((m) => m.maps_count);
  const mapPool = pool.length ? `<div class="cols"><div class="panel"><h3 style="margin-top:0">% побед по картам ${drvTag}</h3>${bars(pool.map((m) => ({ label: String(m.map).replace(/^de_/, ''), value: m.win_maps_count / m.maps_count })), { fmtV: pct, max: 1 })}</div>
    <div>${tbl(`<tr><th>Карта</th><th class="num">Сыграно</th><th class="num">Побед</th><th class="num">Пики</th><th class="num">Баны</th><th class="num">CT</th><th class="num">T</th></tr>${pool.map((m) => `<tr><td>${esc(String(m.map).replace(/^de_/, ''))}</td><td class="num">${num(m.maps_count)}</td><td class="num">${num(m.win_maps_count)}</td><td class="num">${num(m.picked_maps)}</td><td class="num">${num(m.banned_maps)}</td><td class="num">${m.ct_rounds_count ? `${num(m.ct_round_wins)}/${num(m.ct_rounds_count)}` : '—'}</td><td class="num">${m.t_rounds_count ? `${num(m.t_round_wins)}/${num(m.t_rounds_count)}` : '—'}</td></tr>`).join('')}`)}</div></div><p class="note">Счётчики —, «% побед» — расчёт.</p>` : '';
  const pAgg = t.player_stats.length ? tbl(`<tr><th>Игрок</th><th class="num">Матчей</th><th class="num">K</th><th class="num">D</th><th class="num">A</th>${t.game_code === 'cs2' ? '<th class="num">ADR</th><th class="num">Рейтинг</th>' : '<th class="num">GPM</th>'}</tr>${t.player_stats.map((s) => `<tr><td>${playerLink(s.player || { nickname: s.nickname })}</td><td class="num">${s.matches}</td><td class="num">${num(s.kills, 1)}</td><td class="num">${num(s.deaths, 1)}</td><td class="num">${num(s.assists, 1)}</td>${t.game_code === 'cs2' ? `<td class="num">${num(s.adr, 1)}</td><td class="num">${num(s.rating, 2)}</td>` : `<td class="num">${num(s.gold_per_min)}</td>`}</tr>`).join('')}`) + `<p class="note">Средние значения за матч по матчам со статистикой в базе ${BRAND.name} (расчёт).</p>` : emptySm('Статистика игроков по матчам этой команды ещё не загружена.');
  const tours = t.tournaments.length ? tbl(`<tr><th>Турнир</th><th>Даты</th><th>Статус</th><th>Место</th><th class="num">Призовые</th><th class="num">Матчей</th></tr>${t.tournaments.map((x) => `<tr><td><a class="ent" href="/tournament/${x.id}">${logo(x.image_url, x.name, 'sm')}${esc(x.name)}</a></td><td class="mono">${esc(day(x.start_date))}${x.end_date ? ' – ' + esc(day(x.end_date)) : ''}</td><td>${TOUR_ST[x.source_status] || esc(x.source_status || '—')}</td><td>${esc(x.place || '—')}</td><td class="num">${money(x.money)}</td><td class="num">${x.matches_count}</td></tr>`).join('')}`) : emptySm('Турниры команды пока не загружены.');
  const ach = t.achievements.length ? tbl(`<tr><th>Дата</th><th>Турнир</th><th>Результат</th><th class="num">Призовой фонд</th></tr>${t.achievements.map((a) => `<tr><td class="mono">${esc(day(a.date))}</td><td>${a.tournament_id ? `<a class="ent" href="/tournament/${a.tournament_id}">${esc(a.name)}</a>` : esc(a.name || '—')}</td><td>${a.title === 'winner' ? '🏆 Победа' : esc(a.title || '—')}</td><td class="num">${money(a.prize)}</td></tr>`).join('')}`) : '';
  const rhist = t.roster_history.length ? tbl(`<tr><th>Снимок</th><th>Состав</th></tr>${t.roster_history.map((s) => `<tr><td class="mono">${esc(fmt(s.captured_at))}</td><td>${s.players.map((p) => playerLink(p.player || { nickname: p.nickname })).join(', ')}</td></tr>`).join('')}`) : '';
  const wr = rec.wins + rec.losses ? rec.wins / (rec.wins + rec.losses) : null;
  ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/teams">Команды</a><span>${GN[t.game_code]}</span></nav>
    <div class="profile">${logo(t.image_url, t.name, 'xl')}<div class="pmain"><h1>${esc(t.name)}${t.acronym && t.acronym !== t.name ? ` <span class="mut">${esc(t.acronym)}</span>` : ''}</h1>
      <div class="chips">${t.rank ? `<span class="chip" title="Место в рейтинге">#${t.rank}${t.rank_diff ? ` <small class="${t.rank_diff > 0 ? 'up' : 'down'}">${t.rank_diff > 0 ? '▲' : '▼'}${Math.abs(t.rank_diff)}</small>` : ''}</span>` : ''}${t.country_name ? `<span class="chip">${esc(t.country_name)}</span>` : ''}${t.region_name ? `<span class="chip">${esc(t.region_name)}</span>` : ''}${t.est_date ? `<span class="chip">Основана ${esc(day(t.est_date))}</span>` : ''}${t.six_month_earned != null ? `<span class="chip">Призовые за 6 мес.: ${money(t.six_month_earned)}</span>` : ''}</div>
      <div class="soc">${socials(t.socials)}</div></div>
      <div class="rec"><b class="mono">${rec.wins}–${rec.losses}</b><small class="mut">победы–поражения в базе ${drvTag}</small>${wr != null ? `<div style="margin-top:8px">${bar(wr, 1)}<small class="mono mut">${pct(wr)}</small></div>` : ''}</div></div>
    <nav class="tabs"><a href="#roster">Состав</a><a href="#tmatches">Матчи</a><a href="#tstats">Статистика</a><a href="#ttours">Турниры</a><a href="#tchanges">Трансферы</a></nav>
    ${sec('Текущий состав', pl.length ? `<div class="pgrid">${pl.map(rosterCard).join('')}</div>` : emptySm('Состав не опубликован источником или ещё не загружен.'), { id: 'roster' })}
    ${coaches.length || t.staff.length ? sec('Тренеры и штаб', `<div class="pgrid">${coaches.map(rosterCard).join('')}${t.staff.filter((s) => !coaches.some((c) => c.nickname === s.nickname)).map((s) => `<div class="pcard">${avatar(s.image_url, s.nickname, 68)}<b>${esc(s.nickname)}</b><small>${esc([s.first_name, s.last_name].filter(Boolean).join(' '))}</small><small>${esc(s.role || 'штаб')}</small></div>`).join('')}</div>`) : ''}
    ${t.live.length ? sec('Сейчас', matchGrid(t.live)) : ''}
    <div id="tmatches" class="cols">${sec('Будущие матчи', t.upcoming.length ? `<div class="card card-b flush">${matchRowsByDay(t.upcoming.slice(0, 10))}</div>` : emptySm('Запланированных матчей в базе нет.'))}
      ${sec('Последние матчи', t.recent.length ? `<div class="card card-b flush">${matchRowsByDay(t.recent.slice(0, 10))}</div>` : emptySm('Завершённых матчей в базе нет.'))}</div>
    ${t.recent.length > 10 ? sec('История результатов', tbl(`<tr><th>Дата</th><th>Соперник</th><th class="num">Счёт</th><th>Турнир</th></tr>${t.recent.map((m) => { const me = m.teams.findIndex((x) => x.id === t.id); const o = m.teams[1 - me] || {}; const a = (m.teams[me] || {}).score; const b = o.score; return `<tr><td class="mono">${esc(day(m.start_date))}</td><td>${teamLink(o)}</td><td class="num ${a > b ? 'win' : a < b ? 'loss' : ''}"><a href="/match/${m.id}">${a ?? '–'} : ${b ?? '–'}</a></td><td>${m.tournament ? `<a href="/tournament/${m.tournament.id}">${esc(m.tournament.name)}</a>` : '—'}</td></tr>`; }).join('')}`)) : ''}
    ${sec('Командная статистика', generalStats(t.general_stats) + statHistory(t.stat_history), { id: 'tstats' })}
    ${mapPool ? sec('Пул карт', mapPool) : ''}
    ${sec('Статистика игроков', pAgg)}
    ${sec('Турниры и выступления', tours, { id: 'ttours' })}
    ${ach ? sec('Достижения', ach) : ''}
    ${valve.length || bo3r.length ? sec('Рейтинги', rk(valve, 'Рейтинг Valve ') + rk(bo3r, `Место в рейтинге — снимки ${BRAND.name} по датам синхронизации`)) : ''}
    ${sec('История изменений состава', changesTable(t.roster_changes) + (rhist ? '<h3>Снимки состава</h3>' + rhist : ''), { id: 'tchanges' })}
    ${footer(t.profile_synced_at, `<a class="btn sm" href="/compare?type=teams&a=${t.id}">Сравнить</a>`, t.source_url)}</div>`;
}

// ---------- Игрок ----------
export async function player(ctx) {
  ctx.app.innerHTML = `<div class="page">${skeleton(1, 'grid')}${skeleton(4)}</div>`;
  const p = await get('/players/' + ctx.params[0], { signal: ctx.signal });
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
  { const c = p.game_code === 'cs2' ? findConfig(p) : null; let xh = false; try { xh = !!(c && xhDecode(c.crosshair)); } catch {}
    setSeo(SEO.player(BRAND.name, { nickname: p.nickname, real_name: name || null, team: p.team && p.team.name, team_id: p.team && p.team.id, game: p.game_code, country: p.country_name, role: p.is_coach ? 'тренер' : null,
      birthday: p.birthday, has_config: !!c, has_crosshair: xh, matches_count: new Set((p.match_stats || []).map((s) => s.match_id)).size, path: `/player/${p.id}` }, seoOrigin()), `/player/${p.id}`); }
  const a = p.aggregate;
  const series = p.match_stats.filter((s) => s.scope_game_id === 0).slice().reverse();
  const key = p.game_code === 'cs2' ? 'rating' : 'kills';
  const trend = series.length > 2 ? `<div class="panel" style="margin-bottom:14px"><div class="sec-h" style="margin:0 0 6px"><b>${p.game_code === 'cs2' ? 'Рейтинг по матчам' : 'Убийства по матчам'}</b>${drvTag}<span class="mut mono" style="margin-left:auto">${series.length} матч.</span></div>${sparkline(series.map((s) => s[key]))}</div>` : '';
  const ms = p.match_stats.length ? tbl(`<tr><th>Дата</th><th>Матч</th><th>Часть</th><th class="num">K/D/A</th><th class="num">${p.game_code === 'cs2' ? 'ADR · Рейтинг' : p.game_code === 'dota2' ? 'Герой · GPM' : 'Чемпион · CS'}</th></tr>${p.match_stats.map((s) => `<tr><td class="mono">${esc(fmt(s.start_date))}</td><td><a href="/match/${s.match_id}">открыть →</a></td><td>${s.scope_game_id === 0 ? 'итог матча' : 'карта / игра'}</td><td class="num">${s.kills ?? '–'}/${s.deaths ?? '–'}/${s.assists ?? '–'}</td><td class="num">${p.game_code === 'cs2' ? `${num(s.adr, 1)} · ${num(s.rating, 2)}` : p.game_code === 'dota2' ? `${esc(s.hero || '–')} · ${num(s.gold_per_min)}` : `${esc(s.hero || '–')} · ${num(s.creep_score)}`}</td></tr>`).join('')}`) : emptySm('Индивидуальная статистика по матчам ещё не загружена.');
  const aggBlk = a ? `${drvTag}${kv([['Матчей со статистикой', a.matches], ['Средние K / D / A', `${num(a.kills, 1)} / ${num(a.deaths, 1)} / ${num(a.assists, 1)}`], ['Средний ADR', a.adr != null ? num(a.adr, 1) : null], ['Средний рейтинг матча', a.rating != null ? num(a.rating, 2) : null], ['Средний GPM', a.gold_per_min != null ? num(a.gold_per_min) : null]])}` : '';
  const tours = p.tournaments.length ? tbl(`<tr><th>Турнир</th><th>Даты</th><th>Команда</th><th>Место</th><th class="num">Карт</th><th class="num">Рейтинг</th><th class="num">K/D</th></tr>${p.tournaments.map((x) => `<tr><td><a class="ent" href="/tournament/${x.id}">${logo(x.image_url, x.name, 'sm')}${esc(x.name)}</a></td><td class="mono">${esc(day(x.start_date))}</td><td>${x.team_id ? `<a href="/team/${x.team_id}">${esc(x.team_name)}</a>` : '—'}</td><td>${esc(x.place || '—')}</td><td class="num">${num(x.games_count)}</td><td class="num">${num(x.rating, 2)}</td><td class="num">${num(x.kd, 2)}</td></tr>`).join('')}`) + '<p class="note">Рейтинг и K/D на турнире — средние показатели.</p>' : emptySm('Участие в турнирах пока не установлено.');
  ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/players">Игроки</a><span>${GN[p.game_code]}</span>${p.team ? `<span><a href="/team/${p.team.id}">${esc(p.team.name)}</a></span>` : ''}</nav>
    <div class="profile">${avatar(p.image_url, p.nickname, 110)}<div class="pmain"><h1>${esc(p.nickname)}</h1><div class="mut">${esc(name)}</div>
      <div class="chips">${p.team ? `<a class="chip" href="/team/${p.team.id}">${logo(p.team.image_url, p.team.name, 'sm')} ${esc(p.team.name)}</a>` : '<span class="chip">Без команды</span>'}${p.country_name ? `<span class="chip">${esc(p.country_name)}</span>` : ''}${p.is_coach ? '<span class="chip">Тренер</span>' : ''}${p.role ? `<span class="chip">${esc(p.role)}</span>` : ''}</div>
      <div class="soc">${socials(p.socials)}</div></div>
      ${p.six_month_avg_rating != null ? `<div class="rec"><b class="mono">${num(p.six_month_avg_rating, 2)}</b><small class="mut">рейтинг за 6 мес. ${srcTag}</small></div>` : ''}</div>
    <div class="cols">${sec('Сведения', `<div class="panel">${kv([['Дисциплина', GN[p.game_code]], ['Текущая команда', p.team ? teamLink(p.team) : 'нет данных'], ['В команде с', p.joined_team_at ? esc(day(p.joined_team_at)) : null], ['Страна', esc(p.country_name || '')], ['Дата рождения', p.birthday ? esc(day(p.birthday)) : null],
      ['Роль', p.role ? esc(p.role) : p.is_coach ? 'Тренер' : null], ['Призовые', p.total_prize != null ? money(p.total_prize) : null]])}</div>`)}
      ${sec('Предыдущие команды', p.previous_teams.length ? `<div class="chips">${p.previous_teams.map((t) => `<a class="chip" href="/team/${t.id}">${logo(t.image_url, t.name, 'sm')} ${esc(t.name)}</a>`).join('')}</div>` : emptySm('История команд не установлена по данным источника.'), { note: 'Только по опубликованным трансферам и обнаруженным изменениям составов.' })}</div>
    ${playerSetupSection(p)}
    ${sec('Последние матчи', p.matches.length ? `<div class="card card-b flush">${matchRowsByDay(p.matches.slice(0, 12))}</div>` : emptySm('Матчей с участием игрока в базе нет.'))}
    ${sec('Статистика', generalStats(p.general_stats) + (aggBlk ? `<h3>По матчам в базе ${BRAND.name}</h3><div class="panel">${aggBlk}</div>` : '') + statHistory(p.stat_history))}
    ${sec('Индивидуальные показатели по матчам', trend + ms)}
    ${sec('Участие в турнирах', tours)}
    ${sec('История трансферов', changesTable(p.transfers, false))}
    ${footer(p.profile_synced_at, `<a class="btn sm" href="/compare?type=players&a=${p.id}">Сравнить</a>`, p.source_url)}</div>`;
  fillPlayerSetup(ctx.app, p);
}

// ---------- Турнир ----------
export async function tournament(ctx) {
  ctx.app.innerHTML = `<div class="page">${skeleton(1, 'grid')}${skeleton(4)}</div>`;
  const t = await get('/tournaments/' + ctx.params[0], { signal: ctx.signal });
  setSeo(SEO.tournament(BRAND.name, { name: t.name, game: t.game_code, start_date: t.start_date, end_date: t.end_date, prize: t.prize, teams_count: (t.participants || []).length, path: `/tournament/${t.id}` }, seoOrigin()), `/tournament/${t.id}`);
  const bm = (x) => { const m = x.match; if (!m) return '<div class="bm dim">матч не загружен</div>';
    const row = (tm, o) => `<div class="br ${m.status === 'finished' && tm.score > o.score ? 'w' : ''}">${logo(tm.image_url, tm.name, 'sm')}<span>${tm.name ? esc(tm.name) : 'TBD'}</span><b class="mono">${m.status === 'upcoming' ? '' : tm.score ?? ''}</b></div>`;
    return `<a class="bm" href="/match/${m.id}">${row(m.teams[0], m.teams[1])}${row(m.teams[1], m.teams[0])}<small class="dim mono">${esc(fmt(m.start_date))}${m.bo_type ? ' · BO' + m.bo_type : ''}${m.status === 'live' ? ' · <span class="loss">LIVE</span>' : ''}</small></a>`; };
  const order = ['upper', 'default', 'lower'];
  const stages = t.stages.length ? t.stages.map((s) => {
    const groups = {}; for (const r of s.rounds) (groups[r.bracket_type || 'default'] = groups[r.bracket_type || 'default'] || []).push(r);
    return `<h3>${esc(s.title || 'Стадия')} <span class="mut" style="font-weight:500">${esc(s.format_type || '')}${s.status ? ' · ' + (TOUR_ST[s.status] || esc(s.status)) : ''}${s.start_date ? ' · ' + esc(day(s.start_date)) : ''}</span></h3>
      ${Object.entries(groups).sort(([x], [y]) => (order.indexOf(x) + 1 || 9) - (order.indexOf(y) + 1 || 9)).map(([bt, rounds]) => `${Object.keys(groups).length > 1 ? `<div class="mut" style="margin:6px 0">${bt === 'upper' ? 'Верхняя сетка' : bt === 'lower' ? 'Нижняя сетка' : esc(bt)}</div>` : ''}<div class="bracket">${rounds.map((r) => `<div class="bcol"><div class="bh">${esc(r.name || 'Раунд')}</div>${r.matches.map(bm).join('')}</div>`).join('')}</div>`).join('')}`;
  }).join('') : emptySm('Сетка и стадии этого турнира не опубликованы источником или ещё не загружены.');
  const hasPts = t.participants.some((x) => x.points != null);
  const parts = t.participants.length ? tbl(`<tr><th>Место</th><th>Команда</th><th class="num">Призовые</th>${hasPts ? '<th class="num">Очки</th>' : ''}<th>Заявка</th></tr>${t.participants.map((x) => `<tr><td>${esc(x.place || '—')}</td><td>${teamLink(x.team)}</td><td class="num">${money(x.money)}</td>${hasPts ? `<td class="num">${num(x.points)}</td>` : ''}<td>${x.players.length ? x.players.map((pl) => playerLink(pl.player || { nickname: pl.nickname }) + (pl.is_coach ? ' <span class="tag">тренер</span>' : '') + (pl.is_standin ? ' <span class="tag">замена</span>' : '')).join(', ') : '<span class="dim">—</span>'}</td></tr>`).join('')}`) : emptySm('Список участников не опубликован.');
  const tr = t.team_results.length ? tbl(`<tr><th>Команда</th><th class="num">Побед</th><th class="num">Поражений</th><th>Доля побед</th></tr>${t.team_results.map((r) => `<tr><td>${teamLink(r.team)}</td><td class="num">${r.wins}</td><td class="num">${r.losses}</td><td>${bar(r.wins, r.wins + r.losses || 1)}</td></tr>`).join('')}`) + `<p class="note">Подсчитано по завершённым матчам турнира в базе ${BRAND.name} (расчёт).</p>` : '';
  const maxR = Math.max(1.5, ...t.player_stats.map((s) => s.rating || 0));
  const ps = t.player_stats.length ? tbl(`<tr><th>Игрок</th><th class="num">Карт</th><th class="num">Рейтинг</th><th class="num">K / раунд</th><th class="num">D / раунд</th><th class="num">Урон / раунд</th><th class="num">K/D</th></tr>${t.player_stats.map((s) => `<tr><td>${playerLink(s.player)}</td><td class="num">${num(s.games_count)}</td><td class="num"><div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">${bar(s.rating || 0, maxR)}<b>${num(s.rating, 2)}</b></div></td><td class="num">${num(s.kills, 2)}</td><td class="num">${num(s.deaths, 2)}</td><td class="num">${num(s.damage, 1)}</td><td class="num">${num(s.kd, 2)}</td></tr>`).join('')}`) + '<p class="note">Средние показатели игроков на турнире .</p>' : emptySm('Статистика игроков на турнире не опубликована или ещё не загружена.');
  ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/tournaments">Турниры</a><span>${GN[t.game_code]}</span></nav>
    <div class="profile">${logo(t.image_url, t.name, 'xl')}<div class="pmain"><h1>${esc(t.name)}</h1>
      <div class="chips">${t.source_status ? `<span class="chip">${TOUR_ST[t.source_status] || esc(t.source_status)}</span>` : ''}${t.tier ? `<span class="chip">Tier ${esc(String(t.tier).toUpperCase())}</span>` : ''}${t.event_type ? `<span class="chip">${t.event_type === 'lan' ? 'LAN' : 'Онлайн'}</span>` : ''}${t.region_name ? `<span class="chip">${esc(t.region_name)}</span>` : ''}${t.start_date ? `<span class="chip">${esc(day(t.start_date))}${t.end_date ? ' – ' + esc(day(t.end_date)) : ''}</span>` : ''}</div></div>
      ${t.prize != null ? `<div class="rec"><b class="mono">${money(t.prize)}</b><small class="mut">призовой фонд</small></div>` : ''}</div>
    <nav class="tabs"><a href="#bracket">Сетка</a><a href="#parts">Участники</a><a href="#sched">Расписание</a><a href="#results">Результаты</a><a href="#pstats">Статистика</a></nav>
    ${sec('Основная информация', `<div class="panel">${kv([['Дисциплина', GN[t.game_code]], ['Даты', t.start_date ? `${esc(day(t.start_date))}${t.end_date ? ' – ' + esc(day(t.end_date)) : ''}` : null], ['Призовой фонд', t.prize != null ? money(t.prize) : null],
      ['Командам / игрокам', t.teams_prize != null || t.players_prize != null ? `${money(t.teams_prize)} / ${money(t.players_prize)}` : null], ['Участников', t.participants.length || null], ['Матчей в базе', t.matches.length]])}</div>`)}
    ${t.game_code === 'cs2' ? sec('Трансляции', '<div id="tStreams"></div>', { id: 'streams-sec' }) : ''}
    ${sec('Стадии и сетка', stages, { id: 'bracket' })}
    ${sec('Участники и результаты', parts + (tr ? '<h3>Результаты команд по матчам</h3>' + tr : ''), { id: 'parts' })}
    <div class="cols">${sec('Расписание', t.upcoming.length ? `<div class="card card-b flush">${matchRowsByDay(t.upcoming, { showTour: false })}</div>` : emptySm('Предстоящих матчей нет.'), { id: 'sched' })}
    ${sec('Результаты матчей', t.results.length ? `<div class="card card-b flush">${matchRowsByDay(t.results.slice(0, 30), { showTour: false })}</div>` : emptySm('Завершённых матчей в базе нет.'), { id: 'results' })}</div>
    ${sec('Статистика игроков на турнире', ps, { id: 'pstats' })}
    ${footer(t.profile_synced_at, '', t.source_url)}</div>`;
  { const sb = ctx.app.querySelector('#tStreams'); if (sb && t.game_code === 'cs2') mountStreams(sb, { tournament: t, game: t.game_code }, { signal: ctx.signal }); }
}
