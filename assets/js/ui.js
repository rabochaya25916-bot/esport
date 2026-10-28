// Компоненты интерфейса: карточки матчей, строки, списки сущностей, статьи, таблицы, диаграммы.
import { BRAND } from './brand.js';
import { esc, GN, logo, avatar, fmt, time, day, dayKey, dayTitle, num, money, ago, gdot, safeImg, emptySm, state } from './core.js';

export const TOUR_ST = { current: 'Идёт', upcoming: 'Скоро', finished: 'Завершён' };
export const KIND = { article: 'Статья', guide: 'Гайд' };

export function statusBadge(m) {
  if (m.status === 'live') return '<span class="badge live">Live</span>';
  if (m.status === 'finished') return '<span class="badge">Завершён</span>';
  return `<span class="badge out">${esc(fmt(m.start_date))}</span>`;
}
const winner = (m, i) => m.status === 'finished' && m.teams[i].score != null && m.teams[1 - i].score != null ? (m.teams[i].score > m.teams[1 - i].score ? 'w' : m.teams[i].score < m.teams[1 - i].score ? 'l' : '') : '';
const tname = (t) => (t.name ? esc(t.name) : '<span class="dim">TBD</span>');

// Большая карточка (текущие матчи, сетки)
export function matchCard(m) {
  const row = (i) => { const t = m.teams[i]; const sc = m.status === 'upcoming' || t.score == null ? '' : t.score;
    return `<div class="mc-team ${winner(m, i)}">${logo(t.image_url, t.name)}<span class="nm">${tname(t)}</span><span class="sc">${sc}</span></div>`; };
  const maps = (m.games || []).filter((g) => g && (g.ws != null || g.winner_score != null)).slice(0, 5);
  return `<a class="mc ${m.status === 'live' ? 'live' : ''}" href="/match/${m.id}">
    <div class="mc-top">${gdot(m.game)}<span class="tn">${m.tournament ? logo(m.tournament.image_url, m.tournament.name, 'sm') + esc(m.tournament.name) : 'Турнир не указан'}</span>${statusBadge(m)}</div>
    ${row(0)}${row(1)}
    <div class="mc-foot"><span>${m.bo_type ? 'BO' + m.bo_type : ''}${m.tier ? ' · Tier ' + esc(String(m.tier).toUpperCase()) : ''}</span>
      ${maps.length ? `<span class="mc-maps">${maps.map((g) => `<span>${esc(g.map_name ? String(g.map_name).replace(/^de_/, '') + ' ' : '')}${g.ws ?? g.winner_score}:${g.ls ?? g.loser_score}</span>`).join('')}</span>` : `<span>${m.status === 'upcoming' ? esc(day(m.start_date)) : ''}</span>`}</div></a>`;
}

// Компактная строка (расписание, результаты)
export function matchRow(m, { showTour = true } = {}) {
  const [a, b] = m.teams; const wa = winner(m, 0); const wb = winner(m, 1);
  const score = m.status === 'upcoming' ? '<span class="dim">vs</span>' : `<span class="${wa === 'w' ? 'w' : ''}">${a.score ?? '–'}</span>:<span class="${wb === 'w' ? 'w' : ''}">${b.score ?? '–'}</span>`;
  return `<a class="mr" href="/match/${m.id}">
    <span class="t">${m.status === 'live' ? '<span class="badge live">Live</span>' : esc(time(m.start_date))}</span>
    <span class="tm">${logo(a.image_url, a.name, 'sm')}<span>${tname(a)}</span></span>
    <span class="s">${score}</span>
    <span class="tm r">${logo(b.image_url, b.name, 'sm')}<span>${tname(b)}</span></span>
    <span class="meta">${state.game === 'all' ? gdot(m.game) : ''}${showTour && m.tournament ? `<span class="tour">${esc(m.tournament.name)}</span>` : ''}${m.bo_type ? `<span>BO${m.bo_type}</span>` : ''}</span></a>`;
}
export function matchRowsByDay(ms, opts) {
  if (!ms.length) return '';
  let last = ''; const out = [];
  for (const m of ms) { const k = m.start_date ? dayKey(m.start_date) : 'none'; if (k !== last) { out.push(`<div class="dayhead">${m.start_date ? esc(dayTitle(m.start_date)) : 'Дата не указана'}</div>`); last = k; } out.push(matchRow(m, opts)); }
  return `<div class="rows">${out.join('')}</div>`;
}
export const matchGrid = (ms, emptyText) => (ms && ms.length ? `<div class="grid">${ms.map(matchCard).join('')}</div>` : emptySm(emptyText));

// ---------- Сущности ----------
export const teamItem = (t) => `<a class="item" href="/team/${t.id}">${logo(t.image_url, t.name)}<div><b>${esc(t.name)}${t.acronym && t.acronym !== t.name ? ` <span class="mut">${esc(t.acronym)}</span>` : ''}</b>
  <small>${gdot(t.game_code)} ${GN[t.game_code] || ''}${t.rank ? ' · #' + t.rank : ''}${t.country_name ? ' · ' + esc(t.country_name) : ''}${t.matches_count != null ? ' · матчей: ' + t.matches_count : ''}</small></div></a>`;
export const playerItem = (p) => `<a class="item" href="/player/${p.id}">${logo(p.image_url, p.nickname)}<div><b>${esc(p.nickname)}${p.is_coach ? ' <span class="tag">тренер</span>' : ''}</b>
  <small>${GN[p.game_code] || ''}${p.team_name ? ' · ' + esc(p.team_name) : ''}${p.country_name ? ' · ' + esc(p.country_name) : ''}</small></div></a>`;
export const tourItem = (t) => `<a class="item" href="/tournament/${t.id}">${logo(t.image_url, t.name)}<div><b>${esc(t.name)}</b>
  <small>${GN[t.game_code] || ''}${t.source_status ? ' · ' + (TOUR_ST[t.source_status] || esc(t.source_status)) : ''}${t.tier ? ' · Tier ' + esc(String(t.tier).toUpperCase()) : ''}${t.prize ? ' · ' + money(t.prize) : ''}${t.start_date ? ' · ' + day(t.start_date) : ''}</small></div></a>`;
export const tourRow = (t) => `<a class="tour" href="/tournament/${t.id}">${logo(t.image_url, t.name, 'lg')}<div><b>${esc(t.name)}</b>
  <small>${gdot(t.game_code)} ${t.live_count ? `<span class="win">● ${t.live_count} live</span> · ` : ''}${TOUR_ST[t.source_status] || ''}${t.prize ? ' · ' + money(t.prize) : ''}${t.start_date ? ' · ' + day(t.start_date) : ''}</small></div></a>`;
export const rankRow = (t) => `<a class="rk" href="/team/${t.id}"><span class="n">${t.rank}</span>${logo(t.image_url, t.name, 'sm')}<span>${esc(t.name)}</span>
  <small class="${t.rank_diff > 0 ? 'win' : t.rank_diff < 0 ? 'loss' : 'dim'}">${t.rank_diff > 0 ? '▲' + t.rank_diff : t.rank_diff < 0 ? '▼' + -t.rank_diff : '='}</small></a>`;

export const teamLink = (t) => (t && t.id ? `<a class="ent" href="/team/${t.id}">${logo(t.image_url, t.name, 'sm')}${esc(t.name)}</a>` : t && t.name ? `<span class="mut">${esc(t.name)}</span>` : '<span class="dim">—</span>');
export const playerLink = (p) => (p && p.id ? `<a class="ent" href="/player/${p.id}">${esc(p.nickname)}</a>` : p && p.nickname ? `<span class="mut">${esc(p.nickname)}</span>` : '<span class="dim">—</span>');
export const srcTag = '';
export const drvTag = `<span class="tag drv" title="Вычислено ${BRAND.name} из сохранённых данных">расчёт</span>`;

// ---------- Статьи ----------
const pmeta = (p) => `<span>${esc(dayLong2(p.published_at))}</span>${p.reading_minutes ? `<span>${p.reading_minutes} мин</span>` : ''}${p.category ? `<span>${esc(p.category.name)}</span>` : ''}${p.game_code ? `<span>${GN[p.game_code]}</span>` : ''}`;
const dayLong2 = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export function postCard(p, { wide = false } = {}) {
  const img = safeImg(p.cover_url);
  return `<a class="pc ${wide ? 'wide' : ''}" href="/articles/${esc(p.slug)}">
    <div class="cv ${img ? '' : 'none'}">${img ? `<img src="${img}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}<span class="badge ${p.kind === 'guide' ? 'acc' : ''}">${KIND[p.kind] || 'Статья'}</span></div>
    <div class="bd"><h3>${esc(p.title)}</h3>${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}<div class="meta">${pmeta(p)}</div></div></a>`;
}
export const miniPost = (p) => { const img = safeImg(p.cover_url); return `<a class="mini-post" href="/articles/${esc(p.slug)}">${img ? `<img src="${img}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}<div><b>${esc(p.title)}</b><small>${KIND[p.kind] || ''} · ${esc(dayLong2(p.published_at))}</small></div></a>`; };
export const newsRow = (a) => `<a class="mini-post" href="${/^https?:\/\//.test(a.source_url) ? esc(a.source_url) : '#'}" target="_blank" rel="noopener">${safeImg(a.image_url) ? `<img src="${safeImg(a.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}<div><b>${esc(a.title)}</b><small>${esc(GN[a.game_code] || '')} · ${esc(ago(a.published_at))} ↗</small></div></a>`;

// ---------- Блоки и таблицы ----------
export const sec = (title, body, { more, note, count, id } = {}) => `<section class="sec"${id ? ` id="${id}"` : ''}><div class="sec-h"><h2>${title}</h2>${count != null ? `<span class="cnt">${count}</span>` : ''}${more ? `<a class="more" href="${more[0]}">${esc(more[1])} →</a>` : ''}</div>${note ? `<p class="note" style="margin:-6px 0 12px">${note}</p>` : ''}${body}</section>`;
export const card = (title, body, { more, flush } = {}) => `<section class="card"><div class="card-h"><h2>${title}</h2>${more ? `<a class="more" href="${more[0]}">${esc(more[1])} →</a>` : ''}</div><div class="card-b ${flush ? 'flush' : ''}">${body}</div></section>`;
export const kv = (rows) => `<div class="kv"><table>${rows.filter(([, v]) => v != null && v !== '' && v !== '—').map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table></div>`;
export const tbl = (inner) => `<div class="tbl"><table>${inner}</table></div>`;

// ---------- Диаграммы ----------
export const bar = (v, max, cls = '') => `<div class="bar ${cls}"><i style="width:${max ? Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1) : 0}%"></i></div>`;
export function sparkline(values, { h = 56, w = 300 } = {}) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)); if (v.length < 2) return '';
  const min = Math.min(...v); const max = Math.max(...v); const span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - 6 - ((y - min) / span) * (h - 12)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Динамика от ${num(v[0], 2)} до ${num(v[v.length - 1], 2)}"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}"/><path class="a" d="${d}L${w},${h}L0,${h}Z"/><path class="l" d="${d}"/></svg>`;
}
export function bars(rows, { fmtV = (x) => num(x, 0), max } = {}) {
  const m = max ?? Math.max(...rows.map((r) => r.value || 0), 0);
  return rows.length ? `<div class="bars">${rows.map((r) => `<div class="b"><span title="${esc(r.label)}">${esc(r.label)}</span>${bar(r.value || 0, m)}<span>${fmtV(r.value)}</span></div>`).join('')}</div>` : '';
}
export const pager = (page, pages, total) => (pages > 1
  ? `<div class="pager"><button class="btn sm" type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Назад</button><span>${page} / ${pages} · всего ${num(total)}</span><button class="btn sm" type="button" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Вперёд →</button></div>`
  : `<div class="pager"><span>всего ${num(total)}</span></div>`);
