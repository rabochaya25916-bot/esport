import { BRAND } from '../brand.js';
// Рейтинги, трансферы, сравнение команд и игроков.
import { get, gq, state, esc, GN, logo, num, pct, day, setMeta, skeleton, errorBox, empty, emptySm } from '../core.js';
import { sec, tbl, bar, teamLink, playerLink, srcTag, drvTag, matchRowsByDay } from '../ui.js';
import { catalog, changesTable } from './entities.js';
import { navigate } from '../router.js';

export async function rankings(ctx) {
  const g = state.game === 'all' ? (ctx.query.get('game') || 'cs2') : state.game;
  const kind = ctx.query.get('kind') || (g === 'cs2' ? 'valve' : 'bo3_rank');
  setMeta({ title: `Рейтинг команд ${GN[g]}`, description: 'Рейтинг Valve для CS2 и места команд в рейтинге по дисциплинам.' });
  ctx.app.innerHTML = `<div class="page"><h1>Рейтинги · ${GN[g]}</h1>${skeleton(1, 'grid')}</div>`;
  const r = await get(`/rankings?game=${g}&kind=${kind}${ctx.query.get('date') ? '&date=' + encodeURIComponent(ctx.query.get('date')) : ''}`, { signal: ctx.signal });
  const hasScore = r.rows.some((x) => x.score != null); const hasRoster = r.rows.some((x) => x.roster.length);
  const maxScore = Math.max(0, ...r.rows.map((x) => x.score || 0));
  ctx.app.innerHTML = `<div class="page"><h1>Рейтинги · ${GN[g]}</h1><p class="lead">${esc(r.label)}.</p>
    <div class="toolbar">${state.game === 'all' ? `<div class="seg">${['cs2', 'dota2', 'lol'].map((x) => `<a href="/rankings?game=${x}" class="${x === g ? 'on' : ''}">${GN[x]}</a>`).join('')}</div>` : ''}
      <div class="seg">${g === 'cs2' ? `<a href="/rankings?game=${g}&kind=valve" class="${kind === 'valve' ? 'on' : ''}">Valve</a>` : ''}<a href="/rankings?game=${g}&kind=bo3_rank" class="${kind === 'bo3_rank' ? 'on' : ''}">BO3.GG</a></div>
      ${r.dates.length ? `<label class="lbl">Дата <select class="sel" id="rd">${r.dates.map((d) => `<option value="${esc(d)}" ${d === r.date ? 'selected' : ''}>${esc(day(d))}</option>`).join('')}</select></label>` : ''}
      <span style="margin-left:auto" class="btns"><a class="btn sm" href="/compare?type=teams">Сравнить команды</a><a class="btn sm" href="/compare?type=players">Сравнить игроков</a></span></div>
    ${r.rows.length ? tbl(`<tr><th class="num">#</th><th>Команда</th>${hasScore ? '<th>Очки</th>' : ''}<th class="num">Изм.</th>${hasRoster ? '<th>Состав</th>' : ''}</tr>${r.rows.map((x) => `<tr><td class="num"><b>${x.position}</b></td><td>${teamLink(x.team)}</td>${hasScore ? `<td><div style="display:flex;gap:10px;align-items:center">${bar(x.score || 0, maxScore)}<span class="mono">${num(x.score, 1)}</span></div></td>` : ''}<td class="num ${x.change > 0 ? 'win' : x.change < 0 ? 'loss' : 'dim'}">${x.change == null ? '—' : x.change > 0 ? '▲' + x.change : x.change < 0 ? '▼' + -x.change : '='}</td>${hasRoster ? `<td>${x.roster.map((p) => playerLink(p.player || { nickname: p.nickname })).join(', ')}</td>` : ''}</tr>`).join('')}`)
      + `<p class="note">${kind === 'valve' ? 'Позиции и очки — как опубликованы официально. История накапливается по датам публикации.' : `Публикуются только текущее место команды; история складывается из собственных снимков ${BRAND.name} при каждой загрузке профиля. Это не официальная история рейтинга.`} «Изм.» — разница с предыдущей датой в базе (расчёт).</p>`
      : empty('Рейтинг ещё не загружен', 'Он появится после синхронизации профилей и рейтингов из источника.')}</div>`;
  const sel = ctx.app.querySelector('#rd'); if (sel) sel.onchange = () => navigate(`/rankings?game=${g}&kind=${kind}&date=${encodeURIComponent(sel.value)}`);
}

export const transfers = catalog({ kind: 'transfers', title: 'Трансферы и составы', lead: 'Переходы, официальные, и изменения составов, обнаруженные системой.', layout: 'table', per: 50,
  meta: { title: 'Трансферы и изменения составов', description: 'Переходы игроков, официальные, и изменения составов, обнаруженные системой.' },
  sorts: [['date', 'По дате']], filters: [{ key: 'kind', label: 'Тип записи', options: [['', 'Все'], ['source', 'Официально'], ['detected', 'Обнаружено системой']] }],
  render: (rows) => changesTable(rows) });

export async function compare(ctx) {
  const type = ctx.query.get('type') === 'players' ? 'players' : 'teams';
  const a = ctx.query.get('a') || ''; const b = ctx.query.get('b') || '';
  const label = type === 'teams' ? 'команду' : 'игрока';
  setMeta({ title: 'Сравнение команд и игроков', description: 'Сравнение показателей двух команд или игроков одной дисциплины.' });
  ctx.app.innerHTML = `<div class="page"><h1>Сравнение</h1><p class="lead">Официальные показатели и производные расчёты ${BRAND.name} отмечены отдельно.</p>
    <div class="toolbar"><div class="seg"><a href="/compare?type=teams" class="${type === 'teams' ? 'on' : ''}">Команды</a><a href="/compare?type=players" class="${type === 'players' ? 'on' : ''}">Игроки</a></div></div>
    <div class="cols">${['a', 'b'].map((s) => `<div class="panel"><input class="inp" data-s="${s}" placeholder="Найти ${label}…" maxlength="60" aria-label="Найти ${label}"><div class="picked" id="pk${s}"></div><div class="sugg" id="sg${s}"></div></div>`).join('')}</div><div id="cr"></div></div>`;
  const ids = { a, b };
  const go = () => navigate(`/compare?type=${type}${ids.a ? '&a=' + ids.a : ''}${ids.b ? '&b=' + ids.b : ''}`, { replace: true });
  for (const s of ['a', 'b']) {
    const inp = ctx.app.querySelector(`input[data-s="${s}"]`); let tm;
    inp.oninput = () => { clearTimeout(tm); tm = setTimeout(async () => {
      const box = ctx.app.querySelector('#sg' + s); if (inp.value.trim().length < 2) { box.innerHTML = ''; return; }
      const rows = await get(`/${type}?limit=8&q=${encodeURIComponent(inp.value.trim())}&${gq()}`).catch(() => []);
      box.innerHTML = rows.map((x) => `<button type="button" data-id="${x.id}">${logo(x.image_url, x.name || x.nickname, 'sm')} ${esc(x.name || x.nickname)} <small class="mut">${GN[x.game_code]}</small></button>`).join('') || '<span class="mut">Не найдено</span>';
      box.querySelectorAll('button').forEach((bt) => (bt.onclick = () => { ids[s] = bt.dataset.id; go(); }));
    }, 250); };
  }
  for (const s of ['a', 'b']) if (ids[s]) get(`/${type}/${ids[s]}`, { signal: ctx.signal }).then((x) => { ctx.app.querySelector('#pk' + s).innerHTML = type === 'teams' ? teamLink(x) : `${logo(x.image_url, x.nickname, 'sm')} ${playerLink(x)}`; }).catch(() => {});
  if (!a || !b) { ctx.app.querySelector('#cr').innerHTML = `<div style="margin-top:18px">${empty(`Выберите ${type === 'teams' ? 'две команды' : 'двух игроков'}`, 'Сравнивать можно только в пределах одной дисциплины.')}</div>`; return; }
  try {
    const c = await get(`/compare/${type}?a=${a}&b=${b}`, { signal: ctx.signal });
    const f = (v, fm) => (v == null ? '<span class="dim">—</span>' : fm === 'pct' ? pct(v) : num(v, typeof fm === 'number' ? fm : 0));
    const better = (m) => (m.a == null || m.b == null || m.a === m.b || /rank|deaths/.test(m.key) ? ['', ''] : m.a > m.b ? ['win', ''] : ['', 'win']);
    const na = esc(c.a.name || c.a.nickname); const nb = esc(c.b.name || c.b.nickname);
    const t = (rows) => tbl(`<tr><th>Показатель</th><th class="num">${na}</th><th style="width:28%"></th><th class="num">${nb}</th></tr>${rows.map((m) => { const [x, y] = better(m); const s = (Math.abs(m.a || 0) + Math.abs(m.b || 0)) || 1;
      return `<tr><td>${esc(m.label)}</td><td class="num ${x}">${f(m.a, m.fmt)}</td><td>${m.a != null && m.b != null ? `<div class="vs-bar"><i style="width:${(Math.abs(m.a) / s) * 100}%"></i><i style="width:${(Math.abs(m.b) / s) * 100}%"></i></div>` : ''}</td><td class="num ${y}">${f(m.b, m.fmt)}</td></tr>`; }).join('')}`);
    const has = (rows) => rows.some((m) => m.a != null || m.b != null);
    ctx.app.querySelector('#cr').innerHTML = sec(`Опубликованные показатели ${srcTag}`, has(c.source) ? t(c.source) : emptySm('Не опубликованы сопоставимых показателей.'))
      + sec(`Производные расчёты ${drvTag}`, has(c.derived) ? t(c.derived) : emptySm('Недостаточно данных для расчёта.'), { note: `Вычислены ${BRAND.name} из сохранённых данных; не являются официальными показателями.` })
      + (c.head_to_head ? sec('Личные встречи', c.head_to_head.length ? `<div class="card card-b flush">${matchRowsByDay(c.head_to_head)}</div>` : emptySm('Личных встреч в базе нет.')) : '');
  } catch (e) { if (e.name !== 'AbortError') ctx.app.querySelector('#cr').innerHTML = errorBox(e); }
}
