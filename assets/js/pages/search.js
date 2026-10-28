// Общий поиск: команды, игроки, турниры, матчи, статьи — через /api/search, с фильтрами.
import { get, esc, GN, logo, state, setMeta, skeleton, errorBox, empty, num, fmt, gdot } from '../core.js';
import { teamItem, playerItem, tourItem, matchRow, postCard, sec } from '../ui.js';
import { navigate, setQuery } from '../router.js';

// Подсказки при вводе (шапка и главная)
export function attachTypeahead(form) {
  if (!form) return;
  const input = form.querySelector('input'); const pop = form.querySelector('.qs-pop');
  let tm; let ctrl; let items = []; let sel = -1;
  const close = () => { pop.classList.remove('open'); sel = -1; };
  const go = (href) => { close(); input.blur(); navigate(href); };
  const draw = (r, q) => {
    const groups = [
      ['Команды', r.teams.map((t) => [`/team/${t.id}`, logo(t.image_url, t.name, 'sm'), esc(t.name), `${GN[t.game_code]}${t.rank ? ' · #' + t.rank : ''}`])],
      ['Игроки', r.players.map((p) => [`/player/${p.id}`, logo(p.image_url, p.nickname, 'sm'), esc(p.nickname), `${GN[p.game_code]}${p.team_name ? ' · ' + esc(p.team_name) : ''}`])],
      ['Турниры', r.tournaments.map((t) => [`/tournament/${t.id}`, logo(t.image_url, t.name, 'sm'), esc(t.name), GN[t.game_code]])],
      ['Матчи', r.matches.map((m) => [`/match/${m.id}`, gdot(m.game), `${esc(m.teams[0].name || 'TBD')} vs ${esc(m.teams[1].name || 'TBD')}`, `${m.status === 'live' ? 'LIVE' : esc(fmt(m.start_date))}${m.tournament ? ' · ' + esc(m.tournament.name) : ''}`])],
      ['Статьи', r.posts.map((p) => [`/articles/${p.slug}`, '<span class="logo ph sm">A</span>', esc(p.title), p.kind === 'guide' ? 'Гайд' : 'Статья'])],
    ].filter(([, a]) => a.length);
    items = groups.flatMap(([, a]) => a.map((x) => x[0]));
    pop.innerHTML = groups.length ? groups.map(([h, a]) => `<div class="qs-grp">${h}</div>${a.map(([href, ic, t, s]) => `<a class="qs-it" href="${href}" role="option">${ic}<div>${t}<small>${s}</small></div></a>`).join('')}`).join('')
      + `<a class="qs-all" href="/search?q=${encodeURIComponent(q)}">Все результаты →</a>` : `<div class="state sm">Ничего не найдено по «${esc(q)}»</div>`;
    pop.classList.add('open');
  };
  input.addEventListener('input', () => {
    clearTimeout(tm); const q = input.value.trim();
    if (q.length < 2) return close();
    tm = setTimeout(async () => {
      ctrl?.abort(); ctrl = new AbortController();
      try { const r = await get(`/search?limit=4&q=${encodeURIComponent(q)}${state.game !== 'all' ? '&game=' + state.game : ''}`, { signal: ctrl.signal }); if (input.value.trim() === q) draw(r, q); }
      catch (e) { if (e.name !== 'AbortError') { pop.innerHTML = `<div class="state sm err">${esc(e.message)}</div>`; pop.classList.add('open'); } }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    const links = [...pop.querySelectorAll('a')];
    if (e.key === 'Escape') return close();
    if (!pop.classList.contains('open') || !links.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links.forEach((l, i) => l.classList.toggle('sel', i === sel)); links[sel].scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); go(links[sel].getAttribute('href')); }
  });
  pop.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q.length >= 2) go('/search?q=' + encodeURIComponent(q)); });
}

const TYPES = [['', 'Все типы'], ['teams', 'Команды'], ['players', 'Игроки'], ['tournaments', 'Турниры'], ['matches', 'Матчи'], ['posts', 'Статьи']];
export async function page(ctx) {
  const st = { q: ctx.query.get('q') || '', type: ctx.query.get('type') || '', status: ctx.query.get('status') || '', date_from: ctx.query.get('date_from') || '', date_to: ctx.query.get('date_to') || '' };
  setMeta({ title: st.q ? `Поиск: ${st.q}` : 'Поиск', robots: 'noindex, follow' });
  ctx.app.innerHTML = `<div class="page"><h1>Поиск</h1><p class="lead">По командам, игрокам, турнирам, матчам и статьям${state.game !== 'all' ? ` · ${GN[state.game]}` : ''}. Дисциплину выберите в переключателе вверху.</p>
    <form class="toolbar" id="sf">
      <input class="inp grow" name="q" type="search" value="${esc(st.q)}" placeholder="Минимум 2 символа" minlength="2" maxlength="80" aria-label="Запрос">
      <select class="sel" name="type" aria-label="Тип">${TYPES.map(([k, l]) => `<option value="${k}" ${k === st.type ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="sel" name="status" aria-label="Статус"><option value="">Любой статус</option>${[['live', 'Матч: идёт'], ['upcoming', 'Матч: предстоит'], ['finished', 'Матч: завершён'], ['current', 'Турнир: идёт']].map(([k, l]) => `<option value="${k}" ${k === st.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="lbl">с <input class="inp" type="date" name="date_from" value="${esc(st.date_from)}"></label>
      <label class="lbl">по <input class="inp" type="date" name="date_to" value="${esc(st.date_to)}"></label>
      <button class="btn pri" type="submit">Найти</button>
    </form><div id="sr"></div></div>`;
  const box = ctx.app.querySelector('#sr'); const form = ctx.app.querySelector('#sf');
  const run = async () => {
    setQuery(st);
    if (st.q.length < 2) { box.innerHTML = empty('Введите запрос', 'Например: название команды, никнейм игрока или турнир.'); return; }
    box.innerHTML = skeleton(3, 'list');
    const qs = new URLSearchParams({ q: st.q, limit: st.type ? '50' : '12' });
    for (const k of ['type', 'status', 'date_from', 'date_to']) if (st[k]) qs.set(k, st[k]);
    if (state.game !== 'all') qs.set('game', state.game);
    try {
      const r = await get('/search?' + qs, { signal: ctx.signal });
      const t = r.totals; const total = Object.values(t).reduce((a, b) => a + b, 0);
      const block = (key, title, html) => (r.types.includes(key) ? sec(title, r[key].length ? html : '<div class="state sm">Нет совпадений</div>', { count: t[key] ?? 0 }) : '');
      box.innerHTML = total === 0 ? empty('Ничего не найдено', `По запросу «${st.q}» с выбранными фильтрами совпадений нет.`)
        : `<p class="mut mono">Найдено: ${num(total)}</p>`
          + block('matches', 'Матчи', `<div class="card card-b flush"><div class="rows">${r.matches.map((m) => matchRow(m)).join('')}</div></div>`)
          + block('teams', 'Команды', `<div class="list">${r.teams.map(teamItem).join('')}</div>`)
          + block('players', 'Игроки', `<div class="list">${r.players.map(playerItem).join('')}</div>`)
          + block('tournaments', 'Турниры', `<div class="list">${r.tournaments.map(tourItem).join('')}</div>`)
          + block('posts', 'Статьи и гайды', `<div class="posts">${r.posts.map((p) => postCard(p)).join('')}</div>`);
    } catch (e) { if (e.name !== 'AbortError') box.innerHTML = errorBox(e); }
  };
  form.onsubmit = (e) => { e.preventDefault(); const fd = new FormData(form); for (const k of Object.keys(st)) st[k] = String(fd.get(k) || '').trim(); run(); };
  form.querySelectorAll('select, input[type=date]').forEach((x) => (x.onchange = () => form.requestSubmit()));
  run();
}
