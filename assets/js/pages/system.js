// Служебные страницы: состояние синхронизации (публичное) и пользовательские настройки.
import { get, esc, fmt, ago, num, prefs, savePrefs, state, setMeta, skeleton, emptySm, toast, GN } from '../core.js';
import { sec, tbl, kv } from '../ui.js';
import { poller } from '../poll.js';

const COUNTS = { matches: 'Матчи', teams: 'Команды', players: 'Игроки', tournaments: 'Турниры', posts: 'Собственные статьи', articles: 'Анонсы новостей', match_games: 'Карты / игры', match_rounds: 'Раунды CS2',
  match_player_stats: 'Строки статистики игроков', match_team_stats: 'Строки командной статистики', match_snapshots: 'Снимки истории матчей', roster_changes: 'Изменения составов', team_roster_snapshots: 'Снимки составов',
  tournament_teams: 'Участники турниров', tournament_round_matches: 'Матчи в сетках', tournament_player_stats: 'Статистика игроков на турнирах', rankings: 'Строки рейтингов', stat_snapshots: 'Снимки статистики профилей' };
const STATUS = { success: ['ok', 'успешно'], partial: ['warn', 'частично'], failed: ['bad', 'ошибка'], running: ['spin', 'идёт'] };

export async function syncPage(ctx) {
  setMeta({ title: 'Состояние данных', description: 'Когда данные последний раз обновлялись из источника и есть ли ошибки синхронизации.' });
  ctx.app.innerHTML = `<div class="page"><h1>Состояние данных</h1>${skeleton(2)}</div>`;
  const draw = async () => {
    const s = await get('/sync/status', { signal: ctx.signal });
    const st = s.running ? 'spin' : !s.last_success_at ? 'bad' : !s.source_ok ? 'bad' : s.stale ? 'warn' : 'ok';
    ctx.app.innerHTML = `<div class="page"><h1>Состояние данных</h1>
      <p class="lead">Сервер сам забирает данные с публичных страниц по расписанию (только разрешённые robots.txt). Сайт показывает то, что уже сохранено в базе, поэтому при недоступности источника данные остаются доступными.</p>
      <div class="cols">
        <div class="panel"><div class="status-line" style="font-size:15px;color:var(--fg)"><span class="dot ${st}"></span>${s.running ? 'Идёт синхронизация' : !s.last_success_at ? 'Данные ещё не загружены' : !s.source_ok ? 'Источник недоступен — показаны сохранённые данные' : s.stale ? 'Данные устарели' : 'Данные актуальны'}</div>
          ${kv([['Последнее успешное обновление', s.last_success_at ? `${esc(fmt(s.last_success_at))} <span class="mut">(${esc(ago(s.last_success_at))})</span>` : 'ещё не было'],
            ['Последний полный цикл', s.last_full_success_at ? esc(fmt(s.last_full_success_at)) : '—'],
            ['Данные считаются устаревшими через', `${s.stale_after_min} мин без успешного обновления`],
            ['Расписание полного цикла', `<span class="mono">${esc(s.schedule.full)}</span>`],
            ['Проверка текущих матчей', s.schedule.live ? `<span class="mono">${esc(s.schedule.live)}</span> (только когда есть live или скоро начало)` : 'выключена'],
            ['Браузер опрашивает сайт', `раз в ${s.client.poll_sec} с, при live — раз в ${s.client.poll_live_sec} с`]])}
          ${s.last_error ? `<div class="alert err" style="margin-top:12px">Последняя ошибка ${esc(ago(s.last_error.created_at))}: ${esc(s.last_error.message)}</div>` : ''}</div>
        <div class="panel"><h3 style="margin-top:0">Что сохранено в базе</h3>${kv(Object.entries(s.counts).map(([k, v]) => [COUNTS[k] || esc(k), `<span class="mono">${num(v)}</span>`]))}</div>
      </div>
      ${sec('Последние запуски', s.recent_runs.length ? tbl(`<tr><th>Начало</th><th>Тип</th><th>Результат</th><th class="num">Страниц ок / ошибок</th><th class="num">Матчей</th><th class="num">Подробностей</th><th class="num">Профилей</th></tr>${s.recent_runs.map((r) => `<tr><td class="mono">${esc(fmt(r.started_at))}</td><td>${r.kind === 'live' ? 'текущие матчи' : 'полный цикл'}</td><td><span class="status-line"><span class="dot ${(STATUS[r.status] || [''])[0]}"></span>${(STATUS[r.status] || ['', esc(r.status)])[1]}</span></td><td class="num">${r.pages_ok} / ${r.pages_failed}</td><td class="num">${num(r.matches_upserted)}</td><td class="num">${num(r.details_ok)}${r.details_failed ? ` / <span class="loss">${r.details_failed}</span>` : ''}</td><td class="num">${num(r.profiles_ok)}${r.profiles_failed ? ` / <span class="loss">${r.profiles_failed}</span>` : ''}</td></tr>`).join('')}`) : emptySm('Запусков ещё не было.'))}
      ${sec('Что получено (последние страницы)', s.recent_pages && s.recent_pages.length ? tbl(`<tr><th>Время</th><th>Тип</th><th>Адрес</th><th>Результат</th></tr>${s.recent_pages.map((p) => `<tr><td class="mono">${esc(fmt(p.created_at))}</td><td>${esc(p.kind)}</td><td class="mono" style="font-size:12px;word-break:break-all">${esc(p.url)}</td><td class="mono" style="font-size:12px">${p.ok ? '<span class="win">✓</span> ' : '<span class="loss">✗</span> '}${esc(p.summary ? Object.entries(p.summary).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join('/') : v)).join(', ') : '')}</td></tr>`).join('')}`) : emptySm('Журнал пуст.'))}
      ${sec('Журнал ошибок', s.recent_errors.length ? tbl(`<tr><th>Время</th><th>Адрес</th><th>Сообщение</th></tr>${s.recent_errors.map((e) => `<tr><td class="mono">${esc(fmt(e.created_at))}</td><td class="mono" style="font-size:12px;word-break:break-all">${esc(e.url)}</td><td>${esc(e.message)}</td></tr>`).join('')}`) : emptySm('Ошибок нет.'))}</div>`;
  };
  await draw();
  poller(draw, { live: () => true, signal: ctx.signal });
}

export function settings(ctx) {
  setMeta({ title: 'Настройки', robots: 'noindex, follow' });
  ctx.app.innerHTML = `<div class="page" style="max-width:720px"><h1>Настройки</h1><p class="lead">Сохраняются только в этом браузере.</p>
    <form class="panel form" id="pf">
      <label class="field"><span>Дисциплина по умолчанию</span><select class="sel" name="game">${[['all', 'Все'], ...Object.entries(GN)].map(([k, l]) => `<option value="${k}" ${k === prefs.game ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" name="autoRefresh" ${prefs.autoRefresh ? 'checked' : ''}> Автоматически обновлять страницы матчей</label>
      <label class="field"><span>Как часто обновлять</span><select class="sel" name="pollSec">${[[0, 'Как рекомендует сервер'], [30, 'Каждые 30 секунд'], [60, 'Каждую минуту'], [120, 'Каждые 2 минуты'], [300, 'Каждые 5 минут']].map(([k, l]) => `<option value="${k}" ${Number(k) === Number(prefs.pollSec) ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <small>Сайт берёт данные из своей базы; сама база обновляется из источника по расписанию сервера, поэтому слишком частое обновление не ускорит появление новых данных.</small></label>
      <label class="field"><span>Оформление</span><select class="sel" name="theme"><option value="light" ${prefs.theme !== 'dark' ? 'selected' : ''}>Светлое</option><option value="dark" ${prefs.theme === 'dark' ? 'selected' : ''}>Тёмное</option></select></label>
      <label class="chk"><input type="checkbox" name="hour12" ${prefs.hour12 ? 'checked' : ''}> 12-часовой формат времени</label>
      <div class="btns"><button class="btn pri" type="submit">Сохранить</button><button class="btn ghost" type="button" id="pr">Сбросить</button></div>
    </form>
    <p class="note">Часовой пояс: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)} — время матчей показывается в нём.</p></div>`;
  const f = ctx.app.querySelector('#pf');
  f.onsubmit = (e) => {
    e.preventDefault(); const d = new FormData(f);
    savePrefs({ game: d.get('game'), autoRefresh: d.get('autoRefresh') === 'on', pollSec: Number(d.get('pollSec')), hour12: d.get('hour12') === 'on', theme: d.get('theme') === 'dark' ? 'dark' : 'light' });
    document.body.classList.toggle('dark', prefs.theme === 'dark');
    document.querySelector(`#gameTabs button[data-g="${prefs.game}"]`)?.click();
    state.game = prefs.game; toast('Настройки сохранены');
  };
  ctx.app.querySelector('#pr').onclick = () => { localStorage.removeItem('eh-prefs'); location.reload(); };
}
