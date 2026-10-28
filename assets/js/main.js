import { BRAND } from './brand.js';
// Точка входа: шапка, переключатель дисциплин, быстрый поиск, индикатор актуальности данных, маршруты.
import { state, prefs, savePrefs, get, esc, ago, GAMES, API, API_CONFIGURED, setMeta } from './core.js';
import { route, render, startRouter, here, setGate } from './router.js';
import { attachTypeahead } from './pages/search.js';
import * as home from './pages/home.js';
import * as matches from './pages/matches.js';
import * as ent from './pages/entities.js';
import * as more from './pages/more.js';
import * as articles from './pages/articles.js';
import * as search from './pages/search.js';
import * as sys from './pages/system.js';
import * as adm from './pages/admin.js';
import * as cs2 from './pages/cs2.js';
import { applyBrand } from './brand.js';

applyBrand();
// Тема: светлая по умолчанию, тёмная — по выбору в настройках
document.body.classList.toggle('dark', prefs.theme === 'dark');

route(/^\/$/, home.page);
route(/^\/matches$/, matches.list);
route(/^\/match\/(\d+)$/, matches.detail);
route(/^\/teams$/, ent.teams);
route(/^\/team\/(\d+)$/, ent.team);
route(/^\/players$/, ent.players);
route(/^\/player\/(\d+)$/, ent.player);
route(/^\/tournaments$/, ent.tournaments);
route(/^\/tournament\/(\d+)$/, ent.tournament);
route(/^\/configs$/, cs2.configs);
route(/^\/crosshairs?$/, cs2.crosshairs);
route(/^\/config\/([^/]+)$/, cs2.configPage);
route(/^\/crosshair\/([^/]+)$/, cs2.crosshairPage);
route(/^\/rankings$/, more.rankings);
route(/^\/transfers$/, more.transfers);
route(/^\/compare$/, more.compare);
route(/^\/articles$/, articles.list);
route(/^\/articles\/([a-z0-9-]+)$/, articles.detail);
route(/^\/search$/, search.page);
route(/^\/settings$/, sys.settings);
route(/^\/admin(?:\/(.*))?$/, adm.page);

// ---------- Переключатель дисциплин ----------
const GAME_AWARE = /^\/($|matches|teams|players|tournaments|rankings|transfers|articles|search|compare)/;
export function setGame(g, { rerender = true } = {}) {
  state.game = GAMES.includes(g) ? g : 'all'; savePrefs({ game: state.game });
  document.body.dataset.game = state.game;
  document.querySelectorAll('#gameTabs button').forEach((b) => { const on = b.dataset.g === state.game; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  if (rerender && GAME_AWARE.test(here().path)) render();
}
document.querySelectorAll('#gameTabs button').forEach((b) => { b.setAttribute('role', 'tab'); b.onclick = () => setGame(b.dataset.g); });
setGame(state.game, { rerender: false });

// ---------- Мобильное меню ----------
const burger = document.getElementById('burger'); const nav = document.getElementById('nav');
burger.onclick = () => { const open = !nav.classList.contains('open'); nav.classList.toggle('open', open); burger.setAttribute('aria-expanded', open); };

// ---------- Быстрый поиск в шапке ----------
attachTypeahead(document.getElementById('qs'));

// ---------- Индикатор актуальности (берётся из API, обновляется периодически) ----------
const freshEl = document.getElementById('fresh');
export async function refreshFreshness() {
  try {
    const f = await get('/sync/freshness');
    state.freshness = f;
    freshEl.innerHTML = f.live_count ? `<span class="dot ok"></span><a href="/matches?status=live"><b class="win">${f.live_count} live</b></a>` : '';
    document.dispatchEvent(new CustomEvent('eh:fresh', { detail: f }));
    if (state.noBackend) { state.noBackend = false; render(); }
  } catch (e) {
    state.freshness = null;
    if (e.data && e.data.noBackend) state.noBackend = true;
    freshEl.innerHTML = `<span class="dot bad"></span><span>${state.noBackend ? 'Сервер данных не подключён' : esc(e.message)}</span>`;
  }
}

// Если сервер данных (Node.js) не найден — понятная инструкция вместо ошибок в каждом блоке
setGate((ctx) => {
  setMeta({ title: 'Сервер данных не подключён', robots: 'noindex' });
  const origin = location.origin;
  ctx.app.innerHTML = `<div class="page" style="max-width:820px">
    <h1>Сервер данных не подключён</h1>
    <p class="lead">Страница загрузилась, но не может получить матчи, команды и статьи: по адресу <code class="mono">${esc(API)}</code> нет работающего сервера ${BRAND.name}.</p>
    <div class="alert warn">Этот хостинг отдаёт только файлы. База данных, поиск, статьи и админ-панель работают на сервере Node.js — он входит в этот же архив (<code>server.js</code>), но его нужно запустить на хостинге с поддержкой Node.js.</div>
    <div class="panel"><h3 style="margin-top:0">Как подключить</h3>
      <ol class="prose" style="font-size:15px;margin:0">
        <li>Разместите этот же архив на хостинге с Node.js 18+ (VPS, Render, Railway, Timeweb Cloud Apps, Beget с Node.js и т.п.) и выполните там: <code>npm install</code>, <code>npm run admin:create</code>, <code>npm start</code>.</li>
        <li>В файле <code>.env</code> на том сервере укажите <code>CORS_ORIGINS=${esc(origin)}</code> — так он разрешит запросы с этого сайта.</li>
        <li>В <code>index.html</code> на этом сайте впишите адрес сервера: <code>&lt;meta name="api-base" content="https://адрес-вашего-сервера"&gt;</code> и загрузите файл заново.</li>
      </ol>
      <p class="note">Проще всего — открыть сайт прямо с Node.js-сервера: тогда <code>api-base</code> не нужен, у страниц будут обычные адреса, а для поисковиков — заголовки, robots.txt и sitemap.xml.</p></div>
    ${API_CONFIGURED ? '<div class="alert err" style="margin-top:16px">Адрес сервера в index.html указан, но сервер не ответил. Проверьте, что он запущен, доступен по HTTPS и что в CORS_ORIGINS указан адрес этого сайта.</div>' : ''}
    <p style="margin-top:18px"><button class="btn pri" type="button" id="retryApi">Проверить снова</button></p></div>`;
  ctx.app.querySelector('#retryApi').onclick = () => refreshFreshness();
});
await refreshFreshness();
setInterval(() => { if (!document.hidden) refreshFreshness(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFreshness(); });

if (prefs.compact) document.body.classList.add('compact');
startRouter();
