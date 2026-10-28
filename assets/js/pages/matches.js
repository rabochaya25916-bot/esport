// Раздел «Матчи»: список с фильтрами и страница отдельного матча (карты, составы, статистика, раунды).
import { get, getPage, gq, state, esc, GN, logo, fmt, day, time, num, setMeta, skeleton, errorBox, empty, emptySm } from '../core.js';
import { matchCard, matchRowsByDay, statusBadge, sec, kv, tbl, bar, drvTag } from '../ui.js';
import { setQuery } from '../router.js';
import { poller } from '../poll.js';
import { mountStreams } from '../streams.js';
import * as SEO from '../seo-templates.js';
import { BRAND } from '../brand.js';
import { setSeo, seoOrigin } from '../core.js';

const STATUSES = [['', 'Все'], ['live', 'Сейчас'], ['upcoming', 'Предстоящие'], ['finished', 'Завершённые']];
const PER = 50;

export async function list(ctx) {
  const q = ctx.query;
  const st = { status: q.get('status') || '', date: q.get('date') || '', date_from: q.get('date_from') || '', date_to: q.get('date_to') || '', tier: q.get('tier') || '', q: q.get('q') || '', view: q.get('view') || 'rows', page: Math.max(1, parseInt(q.get('page'), 10) || 1) };
  const title = `Матчи${state.game !== 'all' ? ' ' + GN[state.game] : ''}`;
  setMeta({ title: `${title} — расписание и результаты`, description: 'Расписание и результаты матчей CS2, Dota 2 и LoL с фильтрами по дате, статусу и уровню турнира.' });
  ctx.app.innerHTML = `<div class="page"><div class="sec-h" style="margin-bottom:4px"><h1 class="h1" style="margin:0">${esc(title)}</h1><span class="updated" id="mUpd"></span></div>
    <p class="lead">Текущие, предстоящие и завершённые встречи .</p>
    <div class="toolbar" id="mf">
      <div class="seg" role="tablist">${STATUSES.map(([k, l]) => `<button type="button" data-s="${k}" class="${k === st.status ? 'on' : ''}">${k === 'live' ? '<span class="dot bad"></span>' : ''}${l}</button>`).join('')}</div>
      <input class="inp grow" id="mq" type="search" placeholder="Команда или турнир" value="${esc(st.q)}" maxlength="80" aria-label="Команда или турнир">
      <label class="lbl">Дата <input class="inp" type="date" id="md" value="${esc(st.date)}"></label>
      <label class="lbl">с <input class="inp" type="date" id="mfrom" value="${esc(st.date_from)}"></label>
      <label class="lbl">по <input class="inp" type="date" id="mto" value="${esc(st.date_to)}"></label>
      <select class="sel" id="mt" aria-label="Уровень">${[['', 'Любой tier'], ['s', 'Tier S'], ['a', 'Tier A'], ['b', 'Tier B'], ['c', 'Tier C']].map(([k, l]) => `<option value="${k}" ${k === st.tier ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="seg">${[['rows', 'Список'], ['grid', 'Карточки']].map(([k, l]) => `<button type="button" data-v="${k}" class="${k === st.view ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn ghost sm" type="button" id="mreset">Сбросить</button>
    </div><div id="ml">${skeleton(4)}</div><div id="mp"></div></div>`;
  const $ = (s) => ctx.app.querySelector(s);
  let data = [];
  const load = async (silent) => {
    setQuery({ ...st, view: st.view === 'rows' ? '' : st.view, page: st.page > 1 ? st.page : '' });
    if (!silent) $('#ml').innerHTML = skeleton(4);
    const qs = [gq(), st.status && 'status=' + st.status, ...['date', 'date_from', 'date_to', 'tier'].map((k) => st[k] && `${k}=${st[k]}`), st.q && 'q=' + encodeURIComponent(st.q), `limit=${PER}`, `offset=${(st.page - 1) * PER}`].filter(Boolean).join('&');
    try {
      const r = await getPage('/matches?' + qs, { signal: ctx.signal }); data = r.data;
      const pages = Math.max(1, Math.ceil(r.total / PER));
      $('#ml').innerHTML = !data.length ? empty('Матчей не найдено', st.status === 'live' ? 'Сейчас нет текущих матчей. Данные обновляются по расписанию синхронизации.' : 'Измените фильтры или дождитесь следующей синхронизации из источника.')
        : st.view === 'grid' ? `<div class="grid">${data.map(matchCard).join('')}</div>` : `<div class="card card-b flush">${matchRowsByDay(data)}</div>`;
      $('#mp').innerHTML = pages > 1 ? `<div class="pager"><button class="btn sm" data-p="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''}>← Назад</button><span>${st.page} / ${pages} · всего ${num(r.total)}</span><button class="btn sm" data-p="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''}>Вперёд →</button></div>` : `<div class="pager"><span>всего ${num(r.total)}</span></div>`;
      $('#mp').querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { st.page = Number(b.dataset.p); load(); window.scrollTo(0, 0); }));
      $('#mUpd').textContent = `обновлено в ${time(new Date())}`;
    } catch (e) { if (e.name !== 'AbortError' && !silent) $('#ml').innerHTML = errorBox(e); }
  };
  const reset = (patch) => { Object.assign(st, patch, { page: 1 }); load(); };
  ctx.app.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { ctx.app.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); reset({ status: b.dataset.s }); }));
  ctx.app.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { ctx.app.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); st.view = b.dataset.v; load(true); }));
  let tm; $('#mq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => reset({ q: e.target.value.trim() }), 300); };
  $('#md').onchange = (e) => { $('#mfrom').value = ''; $('#mto').value = ''; reset({ date: e.target.value, date_from: '', date_to: '' }); };
  $('#mfrom').onchange = (e) => { $('#md').value = ''; reset({ date_from: e.target.value, date: '' }); };
  $('#mto').onchange = (e) => { $('#md').value = ''; reset({ date_to: e.target.value, date: '' }); };
  $('#mt').onchange = (e) => reset({ tier: e.target.value });
  $('#mreset').onclick = () => { ['#mq', '#md', '#mfrom', '#mto', '#mt'].forEach((s) => ($(s).value = '')); reset({ q: '', date: '', date_from: '', date_to: '', tier: '' }); };
  await load();
  poller(() => load(true), { live: () => data.some((m) => m.status === 'live'), signal: ctx.signal });
}

// ---------------- Страница матча ----------------
export async function detail(ctx) {
  const id = ctx.params[0];
  ctx.app.innerHTML = `<div class="page">${skeleton(1, 'grid')}${skeleton(3)}</div>`;
  let m = await get(`/matches/${id}/full`, { signal: ctx.signal });
  const draw = () => {
    const [a, b] = m.teams; const t = m.tournament;
    setSeo(SEO.match(BRAND.name, { t1: a.name, t2: b.name, s1: m.status === 'upcoming' ? null : a.score, s2: m.status === 'upcoming' ? null : b.score, status: m.status, start_date: m.start_date, tournament: t && t.name, tournament_id: t && t.id,
      game: m.game, maps_count: (m.games || []).length, has_linked_streams: false, path: `/match/${m.id}` }, seoOrigin()), `/match/${m.id}`);
    const y = window.scrollY;
    ctx.app.innerHTML = `<div class="page">${renderMatch(m)}</div>`;
    drawStreams();
    if (y) window.scrollTo(0, y);
  };
  // Трансляции — только эфиры, связанные с этим матчем (явная привязка или категория + обе команды в названии), см. streams.js
  function drawStreams() {
    const box = ctx.app.querySelector('#streams'); if (!box || m.game !== 'cs2') return;
    mountStreams(box, { match: m, game: m.game }, { signal: ctx.signal });
  }
  draw();
  poller(async () => { const n = await get(`/matches/${id}/full`, { signal: ctx.signal }); if (n.updated_at !== m.updated_at || n.details_synced_at !== m.details_synced_at || n.status !== m.status) { m = n; draw(); } },
    { live: () => m.status === 'live', signal: ctx.signal });
}

function renderMatch(m) {
  const [a, b] = m.teams;
  const tname = new Map((m.team_details || []).filter((x) => x.source_id).map((x) => [x.source_id, x]));
  const nameOf = (sid) => (tname.get(sid) || {}).name || '—';
  const n = (v, d = 0) => (v == null ? '<span class="dim">—</span>' : num(v, d));
  const dur = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  const gameLabel = (g) => (m.game === 'cs2' ? `Карта ${g.number ?? ''}${g.map_name ? ' · ' + esc(String(g.map_name).replace(/^de_/, '')) : ''}` : `Игра ${g.number ?? ''}`);
  const gameById = new Map(m.games.map((g) => [g.id, g]));
  const t = m.tournament;
  const wa = m.status === 'finished' && a.score > b.score; const wb = m.status === 'finished' && b.score > a.score;
  const side = (tm, td) => `<div class="sb-team">${tm.id ? `<a href="/team/${tm.id}">` : ''}${logo(tm.image_url, tm.name)}${tm.id ? '</a>' : ''}<b>${tm.id ? `<a href="/team/${tm.id}">${esc(tm.name)}</a>` : esc(tm.name || 'TBD')}</b>${td && td.rank ? `<span class="mut mono">#${td.rank}</span>` : ''}</div>`;

  const head = `<nav class="crumbs" aria-label="Навигация"><a href="/matches">Матчи</a><span>${GN[m.game]}</span>${t ? `<span><a href="/tournament/${t.id}">${esc(t.name)}</a></span>` : ''}</nav>
    <h1 class="match-h1">${esc(a.name || 'TBD')} — ${esc(b.name || 'TBD')}</h1>
    <div class="scoreboard ${m.status === 'live' ? 'live' : ''}">${side(a, (m.team_details || [])[0])}
      <div class="sb-mid"><div class="sb-score">${m.status === 'upcoming' ? '<span class="dim">vs</span>' : `<span class="${wa ? 'w' : ''}">${a.score ?? '–'}</span>:<span class="${wb ? 'w' : ''}">${b.score ?? '–'}</span>`}</div>${statusBadge(m)}
      <small>${esc(fmt(m.start_date))}${m.bo_type ? ' · BO' + m.bo_type : ''}${m.tier ? ' · Tier ' + esc(String(m.tier).toUpperCase()) : ''}</small></div>
      ${side(b, (m.team_details || [])[1])}</div>
    <nav class="tabs" aria-label="Разделы матча"><a href="#info">Обзор</a>${m.game === 'cs2' ? '<a href="#streams-sec">Трансляции</a>' : ''}<a href="#maps">${m.game === 'cs2' ? 'Карты' : 'Игры'}</a><a href="#lineups">Составы</a><a href="#stats">Статистика</a>${m.game === 'cs2' ? '<a href="#rounds">Раунды</a>' : ''}</nav>`;

  const info = kv([['Дисциплина', GN[m.game]], ['Начало', esc(fmt(m.start_date))], ['Окончание', m.end_date ? esc(fmt(m.end_date)) : null], ['Формат', m.bo_type ? 'BO' + m.bo_type : null],
    ['Статус', `${statusBadge(m)} <span class="dim mono">${esc(m.source_status || '')}</span>`],
    ['Разбор статистики на', esc(m.parsed_status || 'нет сведений') + (m.details_status === 'final' ? ' · окончательно' : m.details_status ? ' · будет перепроверено' : '')]]);
  const tour = t ? kv([['Турнир', `<a href="/tournament/${t.id}">${esc(t.name)}</a>`], ['Даты', t.start_date ? `${esc(day(t.start_date))} — ${esc(day(t.end_date))}` : null],
    ['Формат', t.event_type ? (t.event_type === 'lan' ? 'LAN' : 'Онлайн') : null], ['Призовой фонд', t.prize != null ? `<span class="mono">$${Number(t.prize).toLocaleString('en-US')}</span>` : null], ['Tier', t.tier ? esc(String(t.tier).toUpperCase()) : null]])
    : emptySm('Турнир не указан источником.');

  const teamsIds = [...new Set([...(m.team_details || []).map((x) => x.source_id), ...m.lineups.map((l) => l.team_source_id)])].filter(Boolean);
  const lineup = m.lineups.length ? `<div class="cols">${teamsIds.map((tid) => `<div><h3>${esc(nameOf(tid))}</h3><div class="list">${m.lineups.filter((l) => l.team_source_id === tid).map((l) =>
    `<a class="item" ${l.player_id ? `href="/player/${l.player_id}"` : ''}>${logo(l.image_url, l.nickname)}<div><b>${esc(l.nickname)}</b><small>${esc(l.country_code || '')}</small></div></a>`).join('')}</div></div>`).join('')}</div>`
    : emptySm('Состав на этот матч источник не опубликовал.');

  const gamesTbl = m.games.length ? tbl(`<tr><th>#</th><th>${m.game === 'cs2' ? 'Карта' : 'Игра'}</th><th>Победитель</th><th class="num">Счёт</th><th>${m.game === 'cs2' ? 'Половины' : 'Длительность'}</th><th>Статистика</th></tr>
    ${m.games.map((g) => `<tr><td class="mono">${g.number ?? ''}</td><td>${gameLabel(g)}</td><td>${g.winner_team_source_id ? esc(nameOf(g.winner_team_source_id)) : '—'}</td>
    <td class="num">${g.winner_score != null ? `${g.winner_score} : ${g.loser_score}` : '—'}</td>
    <td class="mono">${m.game === 'cs2' ? (g.sides.length ? g.sides.map((s) => `${s.winner_score}:${s.loser_score}${s.overtime ? ' OT' : ''}`).join(' · ') : '—') : dur(g.duration_sec)}</td>
    <td class="mut">${esc(g.state || g.status || '—')}</td></tr>`).join('')}`)
    : emptySm(m.status === 'upcoming' ? 'Матч ещё не начался.' : 'Подробные результаты карт/игр ещё не получены со страницы матча.');

  const cols = m.game === 'cs2'
    ? [['K', 'kills'], ['D', 'deaths'], ['A', 'assists'], ['ADR', 'adr', 1], ['KAST', 'kast', 'pct'], ['HS', 'headshots'], ['FK', 'first_kills'], ['FD', 'first_deaths'], ['Рейтинг BO3', 'rating', 2]]
    : m.game === 'dota2'
      ? [['Герой', 'hero', 's'], ['Поз.', 'role', 's'], ['K', 'kills'], ['D', 'deaths'], ['A', 'assists'], ['LH', 'last_hits'], ['DN', 'denies'], ['GPM', 'gold_per_min'], ['XPM', 'xp_per_min'], ['Урон', 'hero_damage'], ['Net worth', 'net_worth']]
      : [['Чемпион', 'hero', 's'], ['Роль', 'role', 's'], ['K', 'kills'], ['D', 'deaths'], ['A', 'assists'], ['CS', 'creep_score'], ['Золото', 'gold_earned'], ['GPM', 'gold_per_min', 1], ['Урон', 'hero_damage'], ['KP', 'kill_participation', 'pct']];
  const maxRating = Math.max(1.6, ...m.player_stats.map((p) => p.rating || 0));
  const cell = (p, [, k, d]) => d === 's' ? `<td>${k === 'hero' && p.hero_image_url ? logo(p.hero_image_url, p.hero, 'sm') + ' ' : ''}${esc(p[k] ?? '—')}</td>`
    : d === 'pct' ? `<td class="num">${p[k] == null ? '—' : Math.round(p[k] * 100) + '%'}</td>`
    : k === 'rating' && p[k] != null ? `<td class="num"><div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">${bar(p[k], maxRating)}<b>${num(p[k], 2)}</b></div></td>` : `<td class="num">${n(p[k], d || 0)}</td>`;
  const pTable = (rows) => {
    const anyFull = rows.some((p) => cols.some(([, k]) => k !== 'rating' && p[k] != null));
    const use = anyFull ? cols : cols.filter(([, k]) => k === 'rating');
    return tbl(`<tr><th>Игрок</th>${use.map(([h, , d]) => `<th class="${d === 's' ? '' : 'num'}">${h}</th>`).join('')}</tr>${rows.map((p) => `<tr><td>${p.player_id ? `<a class="ent" href="/player/${p.player_id}">${esc(p.nickname || '#' + p.player_source_id)}</a>` : esc(p.nickname || '#' + p.player_source_id)}</td>${use.map((c) => cell(p, c)).join('')}</tr>`).join('')}`);
  };
  const byScope = new Map(); for (const p of m.player_stats) { if (!byScope.has(p.scope_game_id)) byScope.set(p.scope_game_id, []); byScope.get(p.scope_game_id).push(p); }
  const scopeTitle = (sc) => (sc === 0 ? 'Итог матча' : gameById.get(sc) ? gameLabel(gameById.get(sc)) : 'Игра');
  const scopes = [...byScope.keys()].sort((x, y) => (x === 0 ? -1 : y === 0 ? 1 : (gameById.get(x)?.number ?? 0) - (gameById.get(y)?.number ?? 0)));
  const players = scopes.length ? scopes.map((sc) => {
    const rows = byScope.get(sc); const tids = [...new Set(rows.map((r) => r.team_source_id))];
    return `<h3>${scopeTitle(sc)}${sc !== 0 && m.game === 'cs2' ? ' <span class="mut" style="font-weight:500">— по картам публикуются на странице матча только рейтинг</span>' : ''}</h3>${tids.map((tid) => `<div class="mut" style="margin:10px 0 6px;font-weight:700">${esc(nameOf(tid))}</div>${pTable(rows.filter((r) => r.team_source_id === tid))}`).join('')}`;
  }).join('') : emptySm(m.status === 'upcoming' ? 'Матч ещё не начался — статистики нет.' : 'Пока не опубликована индивидуальную статистику по этому матчу.');

  let teamBlock;
  if (m.team_stats.length) {
    const tc = m.game === 'dota2' ? [['Убийства', 'kills'], ['Рошаны', 'roshans'], ['Первая кровь', 'first_blood', 'b'], ['Первая башня', 'first_tower', 'b']]
      : [['Убийства', 'kills'], ['Смерти', 'deaths'], ['Ассисты', 'assists'], ['Золото', 'gold'], ['Башни', 'towers'], ['Драконы', 'dragons'], ['Бароны', 'barons'], ['Первая кровь', 'first_blood', 'b'], ['Первая башня', 'first_tower', 'b']];
    teamBlock = tbl(`<tr><th>Игра</th><th>Команда</th><th>Сторона</th>${tc.map(([h]) => `<th class="num">${h}</th>`).join('')}</tr>${m.team_stats.map((x) => `<tr><td>${scopeTitle(x.scope_game_id)}</td><td>${esc(nameOf(x.team_source_id))}</td><td>${esc(x.side || '—')}</td>${tc.map(([, k, d]) => `<td class="num">${x[k] == null ? '—' : d === 'b' ? (x[k] ? '✓' : '') : n(x[k])}</td>`).join('')}</tr>`).join('')}`);
  } else if (m.game === 'cs2' && byScope.has(0)) {
    const rows = byScope.get(0); const tids = [...new Set(rows.map((r) => r.team_source_id))];
    const sum = (arr, k) => (arr.some((r) => r[k] != null) ? arr.reduce((s, r) => s + (r[k] || 0), 0) : null);
    const rw = (tid) => m.games.reduce((s, g) => s + (g.winner_team_source_id === tid ? g.winner_score || 0 : g.loser_team_source_id === tid ? g.loser_score || 0 : 0), 0);
    const tv = tids.map((tid) => { const r = rows.filter((x) => x.team_source_id === tid); return { tid, rounds: m.games.length ? rw(tid) : null, ...Object.fromEntries(['kills', 'deaths', 'assists', 'headshots', 'first_kills'].map((k) => [k, sum(r, k)])) }; });
    const cmp = tv.length === 2 ? `<div style="margin-bottom:14px">${[['Раунды', 'rounds'], ['Убийства', 'kills'], ['Ассисты', 'assists'], ['Хедшоты', 'headshots'], ['Первые убийства', 'first_kills']].map(([l, k]) => {
      const x = tv[0][k] || 0; const y = tv[1][k] || 0; const s = x + y || 1;
      return `<div class="stat-row"><span class="v">${n(tv[0][k])}</span><span class="k">${l}<div class="vs-bar" style="margin-top:4px"><i style="width:${(x / s) * 100}%"></i><i style="width:${(y / s) * 100}%"></i></div></span><span class="v r">${n(tv[1][k])}</span></div>`; }).join('')}</div>` : '';
    teamBlock = `${cmp}<p class="note">${drvTag} Сумма показателей игроков команды и выигранные раунды по картам (не публикуется отдельной командной таблицы на странице матча).</p>`;
  } else teamBlock = emptySm('Командные показатели по этому матчу источник не опубликовал.');

  const withRounds = m.games.filter((g) => g.rounds && g.rounds.length);
  const reasons = { TargetBombed: 'взрыв', BombDefused: 'разминирование', CTWin: 'устранение', TerroristsWin: 'устранение', TargetSaved: 'время' };
  const rounds = m.game !== 'cs2' ? '' : sec('Раунды', withRounds.length ? withRounds.map((g) => `<h3>${gameLabel(g)}</h3><div class="rounds">${g.rounds.map((r) =>
    `<span class="rd ${r.winner_side === 'CT' ? 'ct' : r.winner_side === 'T' ? 't' : ''}" title="Раунд ${r.round_number}: ${esc(r.winner_team_name || '')} (${esc(r.winner_side || '')}) — ${esc(reasons[r.end_reason] || r.end_reason || '')}${r.duration_sec != null ? ', ' + dur(r.duration_sec) : ''}">${r.round_number}<small>${esc((r.winner_team_name || '').slice(0, 3))}</small></span>`).join('')}</div>`).join('')
    + '<p class="note">Цвет — сторона победителя раунда: синий — CT, оранжевый — T. Наведите курсор, чтобы увидеть причину и длительность.</p>' : emptySm('Пораундовые результаты для этого матча не опубликованы.'), { id: 'rounds' });

  return `${head}
    <div class="cols" id="info">${sec('Основная информация', `<div class="panel">${info}</div>`)}${sec('Турнир', `<div class="panel">${tour}</div>`)}</div>
    ${m.game === 'cs2' ? sec('Трансляции', '<div id="streams"></div>', { id: 'streams-sec' }) : ''}
    ${sec(m.game === 'cs2' ? 'Результаты карт' : 'Результаты игр', gamesTbl, { id: 'maps' })}
    ${sec('Составы', lineup, { id: 'lineups' })}
    ${sec('Статистика игроков', players, { id: 'stats' })}
    ${sec('Командные показатели', teamBlock)}
    ${rounds}`;
}
