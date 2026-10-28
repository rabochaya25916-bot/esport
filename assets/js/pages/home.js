// Главная: текущие, предстоящие и завершённые матчи, турниры, рейтинги, статьи, новости, состояние данных.
// Все блоки — из одного запроса /api/home; страница сама обновляется периодическим опросом.
import { get, gq, state, esc, GN, ago, time, num, setMeta, skeleton, errorBox, emptySm } from '../core.js';
import { matchCard, matchRowsByDay, tourRow, rankRow, newsRow, card, sec, postCard } from '../ui.js';
import { poller, pollInterval } from '../poll.js';
import { attachTypeahead } from './search.js';
import { mountStreams } from '../streams.js';

export async function page(ctx) {
  const g = state.game;
  setMeta({ title: g === 'all' ? null : `Матчи ${GN[g]} сегодня`, description: 'Текущие, предстоящие и завершённые матчи CS2, Dota 2 и LoL, турниры, рейтинги команд, статьи и гайды.' });
  ctx.app.innerHTML = `<div class="page">
    <div class="sec-h" style="margin-bottom:6px"><h1 class="h1" style="margin:0">${g === 'all' ? 'Киберспорт сегодня' : esc(GN[g]) + ' сегодня'}</h1><span class="updated" id="hUpd"></span></div>
    <p class="lead">Матчи, турниры и статистика CS2, Dota 2 и League of Legends плюс собственные статьи и гайды.</p>
    <form class="qs" id="homeQs" role="search" action="/search" style="max-width:640px;margin-bottom:22px">
      <label class="sr-only" for="homeQ">Быстрый поиск</label>
      <input id="homeQ" name="q" type="search" placeholder="Команда, игрок, турнир, матч или статья…" autocomplete="off" minlength="2" maxlength="80" style="width:100%;padding:13px 14px 13px 38px;font-size:15px">
      <div class="qs-pop" role="listbox"></div>
    </form>
    <div id="hAlert"></div>
    <div class="kpis" id="hKpi">${'<div class="kpi skel" style="min-height:62px"></div>'.repeat(6)}</div>
    ${g === 'cs2' ? '<div id="hStreams"></div>' : ''}
    <div class="layout" style="margin-top:8px">
      <div>
        <div id="hLive">${sec('Сейчас идут', skeleton(2))}</div>

        <div id="hUp">${sec('Ближайшие матчи', skeleton(1, 'rows'))}</div>
        <div id="hFin">${sec('Последние результаты', skeleton(1, 'rows'))}</div>
        <section class="sec"><div class="sec-h"><h2>CS2: настройки игроков</h2></div><div class="quick-grid">
          <a class="quick" href="/configs"><span class="q-ic">⚙</span><div><b>Конфиги игроков</b><small>Чувствительность, разрешение, viewmodel и параметры запуска</small></div></a>
          <a class="quick" href="/crosshairs"><span class="q-ic">✛</span><div><b>Прицелы CS2</b><small>Вставьте код прицела — покажем вид и консольные команды</small></div></a>
        </div></section>
        <div id="hPosts"></div>
      </div>
      <aside class="side" id="hSide"><div class="skel" style="min-height:220px"></div><div class="skel" style="min-height:300px"></div></aside>
    </div></div>`;
  attachTypeahead(ctx.app.querySelector('#homeQs'));
  let teamTab = g === 'all' ? 'cs2' : g; let data = null;

  const draw = (d) => {
    const $ = (id) => ctx.app.querySelector('#' + id);
    const c = d.counts;
    $('hKpi').innerHTML = [['live', c.live, 'сейчас live'], ['', c.upcoming, 'предстоящих'], ['', c.finished_24h, 'сыграно за сутки'], ['', c.tournaments, 'турниров'], ['', c.teams, 'команд'], ['', c.players, 'игроков']]
      .map(([cls, v, l]) => `<div class="kpi ${cls && v ? cls : ''}"><b class="mono">${num(v)}</b><small>${l}</small></div>`).join('');
    const f = d.sync;
    $('hAlert').innerHTML = '';
    $('hLive').innerHTML = sec('Сейчас идут', d.live.length ? `<div class="grid">${d.live.map(matchCard).join('')}</div>`
      : emptySm(d.upcoming[0] ? `Сейчас нет текущих матчей. Следующий — ${d.upcoming[0].teams.map((t) => t.name || 'TBD').join(' vs ')} в ${time(d.upcoming[0].start_date)}.` : 'Сейчас нет текущих матчей.'),
    { count: d.live.length || null, more: ['/matches?status=live', 'Все текущие'] });
    $('hUp').innerHTML = sec('Ближайшие матчи', d.upcoming.length ? `<div class="card card-b flush">${matchRowsByDay(d.upcoming)}</div>` : emptySm('Предстоящих матчей в базе нет.'), { more: ['/matches?status=upcoming', 'Расписание'] });
    $('hFin').innerHTML = sec('Последние результаты', d.finished.length ? `<div class="card card-b flush">${matchRowsByDay(d.finished)}</div>` : emptySm('Завершённых матчей в базе пока нет.'), { more: ['/matches?status=finished', 'Все результаты'] });
    $('hPosts').innerHTML = sec('Статьи и гайды', d.posts.length ? `<div class="posts">${d.posts.slice(0, 4).map((p, i) => (i === 0 ? postCardWide(p) : postCardSmall(p))).join('')}</div>`
      : emptySm('Собственных публикаций пока нет. Они появятся здесь после публикации в админ-панели.'), { more: ['/articles', 'Все материалы'] });
    { const el = $('hStreams'); if (el && g !== 'cs2') el.innerHTML = ''; else if (el && !el.dataset.m) { el.dataset.m = 1; el.innerHTML = sec('Сейчас в эфире', '<div id="hStreamsBox"></div>', { id: 'streams-sec' }); mountStreams(el.querySelector('#hStreamsBox'), { game: 'cs2' }, { signal: ctx.signal }); } }
    const tg = Object.keys(d.top_teams); const teams = d.top_teams[teamTab] || [];
    $('hSide').innerHTML = [
      card('Турниры', d.tournaments.length ? d.tournaments.map(tourRow).join('') : emptySm('Текущих турниров в базе нет.'), { more: ['/tournaments?status=current', 'Все'], flush: true }),
      card('Рейтинг команд', `${tg.length > 1 ? `<div class="seg" style="margin:4px 4px 8px">${tg.map((k) => `<button type="button" data-tt="${k}" class="${k === teamTab ? 'on' : ''}">${GN[k]}</button>`).join('')}</div>` : ''}
        <div class="rank-list">${teams.length ? teams.map(rankRow).join('') : emptySm('Рейтинг ещё не загружен.')}</div>`, { more: ['/rankings', 'Рейтинги'], flush: true }),
    ].join('');
    $('hSide').querySelectorAll('[data-tt]').forEach((b) => (b.onclick = () => { teamTab = b.dataset.tt; draw(data); }));
    const u = $('hUpd'); u.textContent = `обновлено в ${time(d.generated_at)}`; u.classList.add('flash'); setTimeout(() => u.classList.remove('flash'), 1200);
  };

  const load = async () => { data = await get('/home?' + gq(g), { signal: ctx.signal }); if (!ctx.signal.aborted) draw(data); };
  try { await load(); } catch (e) { if (e.name === 'AbortError') return; ctx.app.querySelector('#hLive').innerHTML = errorBox(e); ctx.app.querySelector('#hSide').innerHTML = ''; }
  poller(load, { live: () => !!(data && data.live.length), signal: ctx.signal });
}

const postCardWide = (p) => postCard(p, { wide: true });
const postCardSmall = (p) => postCard(p);
