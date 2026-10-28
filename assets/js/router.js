// Маршрутизация. Ссылки в разметке пишутся как логические адреса (/team/12), а роутер превращает их
// в настоящие: /team/12 при работе через Node.js-сервер (History API) или #/team/12 на файловом хостинге.
// Старые ссылки этапов 1–3 (#/team/12) продолжают открываться в обоих режимах.
import { errorBox, empty, setMeta, ROUTER, BASE, toUrl, media, state } from './core.js';

const routes = [];
let current = null;
let gate = null;   // страница-заглушка, если сервер данных недоступен
const app = () => document.getElementById('app');

export function route(re, handler) { routes.push([re, handler]); }
export function setGate(fn) { gate = fn; }

// Текущий логический адрес: { path, search }
export function here() {
  if (ROUTER === 'hash') {
    // Предсгенерированная страница (/player/12/ — см. scripts/prerender.js) без #-адреса открывает свой раздел
    const rel = location.pathname.slice(BASE.length).replace(/(^|\/)index\.html$/, '').replace(/\/+$/, '');
    const h = location.hash.startsWith('#/') ? location.hash.slice(1) : rel ? '/' + rel + location.search : '/';
    const i = h.indexOf('?');
    return { path: decodeURI(i < 0 ? h : h.slice(0, i)).replace(/\/+$/, '') || '/', search: i < 0 ? '' : h.slice(i) };
  }
  const rel = '/' + location.pathname.slice(BASE.length);
  return { path: decodeURI(rel).replace(/\/+$/, '') || '/', search: location.search };
}

export function navigate(url, { replace = false } = {}) {
  if (!replace) history.replaceState({ ...(history.state || {}), y: window.scrollY }, '');
  history[replace ? 'replaceState' : 'pushState']({ y: 0 }, '', toUrl(url));
  render({ scroll: replace ? null : 0 });
}
// Изменить параметры адреса без перерисовки страницы (фильтры)
export function setQuery(params) {
  const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== '' && v != null && v !== false) q.set(k, v);
  history.replaceState(history.state, '', toUrl(here().path + (q.toString() ? '?' + q : '')));
}

function dispose() {
  if (!current) return;
  current.ctrl.abort();
  for (const fn of current.cleanups) { try { fn(); } catch {} }
  current = null;
}

export async function render({ scroll = null } = {}) {
  dispose();
  const { path, search } = here();
  const ctrl = new AbortController();
  const ctx = { path, query: new URLSearchParams(search), signal: ctrl.signal, app: app(), cleanups: [], ctrl };
  ctx.cleanup = (fn) => ctx.cleanups.push(fn);
  current = ctx;
  markNav(path);
  document.getElementById('nav')?.classList.remove('open');
  document.getElementById('burger')?.setAttribute('aria-expanded', 'false');
  if (state.noBackend && gate && path !== '/settings' && !/^\/(configs|config|crosshairs?)(\/|$)/.test(path)) { gate(ctx); return; }
  for (const [re, handler] of routes) {
    const m = path.match(re); if (!m) continue;
    ctx.params = m.slice(1);
    try {
      await handler(ctx);
    } catch (e) {
      if (e.name === 'AbortError' || ctrl.signal.aborted) return;
      if (e.data && e.data.noBackend && gate && !/^\/(configs|config|crosshairs?)(\/|$)/.test(path)) { state.noBackend = true; gate(ctx); return; }
      if (e.status === 404) notFound(ctx); else { ctx.app.innerHTML = errorBox(e); setMeta({ title: 'Ошибка загрузки', robots: 'noindex' }); }
    }
    if (scroll != null && !ctrl.signal.aborted) window.scrollTo(0, scroll);
    return;
  }
  notFound(ctx);
}

export function notFound(ctx) {
  setMeta({ title: 'Страница не найдена', robots: 'noindex, follow' });
  ctx.app.innerHTML = `<div class="page">${empty('Страница не найдена', 'Такой страницы нет или объект ещё не загружен из источника.')}<p style="text-align:center;margin-top:16px"><a class="btn" href="/">На главную</a></p></div>`;
}

function markNav(path) {
  const top = '/' + (path.split('/')[1] || '');
  const alias = { '/match': '/matches', '/team': '/teams', '/player': '/players', '/tournament': '/tournaments', '/transfers': '/teams', '/compare': '/rankings', '/crosshair': '/crosshairs', '/config': '/configs' };
  const key = alias[top] || top;
  document.querySelectorAll('#nav a').forEach((a) => {
    const on = (a.dataset.route || a.getAttribute('href')) === key; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
}

// Логические ссылки (/team/12) → настоящие для текущего режима; картинки из /uploads/ → адрес backend.
// Делается для всей страницы и для всего, что дорисовывается позже.
const isRoute = (h) => h && h.startsWith('/') && !h.startsWith('//') && !/^\/(api|uploads|assets)\//.test(h) && !/\.(xml|txt|svg|ico)$/.test(h);
function fixLinks(root) {
  if (!root.querySelectorAll) return;
  const list = root.matches && root.matches('a[href], img[src]') ? [root, ...root.querySelectorAll('a[href], img[src]')] : root.querySelectorAll('a[href], img[src]');
  for (const el of list) {
    if (el.tagName === 'IMG') { const s = el.getAttribute('src'); if (/^\/uploads\//.test(s)) el.setAttribute('src', media(s)); continue; }
    if (el.dataset.route) continue;
    const h = el.getAttribute('href');
    if (isRoute(h)) { el.dataset.route = h; el.setAttribute('href', toUrl(h)); }
  }
}

export function startRouter() {
  // Совместимость: #/team/12 в режиме History → /team/12; /team/12 по прямой ссылке в режиме hash → #/team/12
  if (ROUTER === 'history' && location.hash.startsWith('#/')) history.replaceState(null, '', toUrl(location.hash.slice(1)));
  fixLinks(document.body);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) fixLinks(n); })
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]'); if (!a || a.target || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    // Якорь внутри страницы (#maps) — прокрутка, а не смена страницы
    if (href.startsWith('#') && !href.startsWith('#/')) {
      const t = document.getElementById(decodeURIComponent(href.slice(1)));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    const r = a.dataset.route || (isRoute(href) ? href : null); if (!r) return;
    e.preventDefault();
    const h = here();
    if (r === h.path + h.search) return render({ scroll: null });
    navigate(r);
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-action="reload"]')) render({ scroll: null }); });
  window.addEventListener('popstate', (e) => render({ scroll: (e.state && e.state.y) || 0 }));
  if (ROUTER === 'hash') window.addEventListener('hashchange', (e) => { if (location.hash.startsWith('#/') || location.hash === '') { if (!history.state) render({ scroll: 0 }); } });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  render({ scroll: null });
}
