// Ядро клиента: обращения к API, форматирование, безопасная вставка текста, настройки пользователя.
// Все данные страниц берутся только из backend API — в браузере нет синхронизации из источника.
//
// Сайт может работать двумя способами:
//  • Node.js-сервер отдаёт и страницы, и API (рекомендуется) — адреса вида /team/12;
//  • index.html лежит на обычном файловом хостинге (в т.ч. в подпапке, например /0/29/), а API — на отдельном
//    Node.js-сервере, адрес которого указан в <meta name="api-base">. Тогда адреса страниц вида #/team/12,
//    потому что файловый хостинг не умеет открывать index.html по адресу /team/12.
export const BASE = new URL('../../', import.meta.url).pathname;                         // папка сайта: '/' или '/0/29/'
const metaApi = (document.querySelector('meta[name="api-base"]')?.content || '').trim().replace(/\/+$/, '');
export const SERVER = metaApi || location.origin + BASE.replace(/\/$/, '');              // адрес backend
export const API = SERVER + '/api';
export const API_CONFIGURED = !!metaApi;
// Сайт без сервера: данные берутся из файла data/esports.db, который GitHub обновляет по расписанию
export const STATIC = !metaApi && !document.querySelector('meta[name="eh-server"]') && document.querySelector('meta[name="data-mode"]')?.content === 'static';
export const CROSS = (() => { try { return new URL(SERVER).origin !== location.origin; } catch { return false; } })();
// history — настоящие адреса (/player/12): Node.js-сервер или index.php на PHP-хостинге (он добавляет <meta name="router" content="history">).
export const ROUTER = document.querySelector('meta[name="eh-server"]') || document.querySelector('meta[name="router"]')?.content === 'history' ? 'history' : 'hash';
// Логический адрес страницы ('/team/12') → настоящая ссылка для текущего режима
export const toUrl = (p) => (ROUTER === 'history' ? BASE.replace(/\/$/, '') + p : BASE + '#' + p);
// Файлы, загруженные в админ-панели, хранятся на backend
export const media = (u) => (/^\/uploads\//.test(String(u || '')) ? SERVER + u : u);
export const GN = { cs2: 'CS2', dota2: 'Dota 2', lol: 'LoL' };
export const GAMES = ['cs2', 'dota2', 'lol'];

// ---------- Настройки пользователя (хранятся в браузере) ----------
const PREF_KEY = 'eh-prefs';
const DEFAULT_PREFS = { game: 'all', autoRefresh: true, pollSec: 0, hour12: false, compact: false, theme: 'light' };
export const prefs = (() => { try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { ...DEFAULT_PREFS }; } })();
if (localStorage.getItem('eh-game') && !localStorage.getItem(PREF_KEY)) prefs.game = localStorage.getItem('eh-game'); // перенос со старой версии
export function savePrefs(patch) { Object.assign(prefs, patch); try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} }
export const state = { game: GAMES.includes(prefs.game) ? prefs.game : 'all', freshness: null };
export const gq = (g = state.game) => (g === 'all' ? '' : `game=${g}`);

// ---------- Экранирование ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
// Ссылки из данных источника: только http(s)
export const safeHref = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');
export const safeImg = (u) => (/^(https?:\/\/|\/uploads\/)/i.test(String(u || '')) ? esc(media(u)) : '');

// ---------- Форматирование ----------
const tf = () => ({ hour: '2-digit', minute: '2-digit', hour12: prefs.hour12 });
export const fmt = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: 'short', ...tf() }) : '—');
export const time = (d) => (d ? new Date(d).toLocaleTimeString('ru-RU', tf()) : '—');
export const day = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dayLong = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export function dayTitle(d) {
  const k = dayKey(d); const t = new Date(); const tk = dayKey(t);
  const y = new Date(t); y.setDate(t.getDate() - 1); const tm = new Date(t); tm.setDate(t.getDate() + 1);
  const w = new Date(d).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  return k === tk ? `Сегодня · ${w}` : k === dayKey(y) ? `Вчера · ${w}` : k === dayKey(tm) ? `Завтра · ${w}` : w;
}
export const ago = (d) => {
  if (!d) return '—';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 45) return 'только что'; if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`; return fmt(d);
};
export const num = (v, d = 0) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d > 0 && Number(v) % 1 ? Math.min(d, 1) : 0 }));
export const money = (v) => (v == null ? '—' : '$' + Number(v).toLocaleString('en-US'));
export const pct = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100; const b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };

// ---------- API ----------
export class ApiError extends Error { constructor(msg, status, data) { super(msg); this.status = status; this.data = data; } }
// ---------- Статичный режим: база загружается в браузер и перечитывается не чаще раза в 2 минуты ----------
let staticApi = null; let staticAt = 0; let staticEtag = '';
async function loadStatic() {
  if (staticApi && Date.now() - staticAt < 120000) return staticApi;
  const [{ createStaticApi }, SQL] = await Promise.all([
    import('./static-api.js'),
    window.__sqljs || (window.__sqljs = (async () => {
      await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = BASE + 'assets/vendor/sql-wasm.js'; s.onload = ok; s.onerror = fail; document.head.append(s); });
      return window.initSqlJs({ locateFile: (f) => BASE + 'assets/vendor/' + f });
    })()),
  ]);
  const res = await fetch((document.querySelector('meta[name="data-url"]')?.content || (BASE + 'data/esports.db')) + '?t=' + Date.now(), { cache: 'no-cache' });
  if (!res.ok) { if (staticApi) return staticApi; throw new ApiError('Данные ещё не опубликованы — дождитесь первого обновления (до 20 минут после настройки).', res.status, { noBackend: true }); }
  const tag = res.headers.get('etag') || res.headers.get('last-modified') || '';
  if (!staticApi || !tag || tag !== staticEtag) staticApi = createStaticApi(SQL, new Uint8Array(await res.arrayBuffer()));
  staticEtag = tag; staticAt = Date.now();
  return staticApi;
}
async function staticRequest(path, method, raw) {
  if (method !== 'GET') throw new ApiError('В этой версии сайта нет сервера: статьи добавляются файлами в папку content/posts на GitHub.', 405, {});
  const handle = await loadStatic();
  const out = handle(path);
  if (out.status >= 400) throw new ApiError((out.body && out.body.error) || 'Ошибка ' + out.status, out.status, out.body);
  const data = out.body;
  return raw ? { data, total: Number(out.headers['x-total-count'] || (Array.isArray(data) ? data.length : 0)) } : data;
}

async function request(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  if (STATIC) return staticRequest(path, method, raw);
  let res;
  const opt = { method, headers: { Accept: 'application/json', ...headers }, credentials: CROSS ? 'omit' : 'same-origin', signal };
  if (admin.token && path.startsWith('/admin/')) opt.headers.Authorization = 'Bearer ' + admin.token;
  if (body !== undefined) {
    if (body instanceof Blob) opt.body = body; else { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
  }
  try { res = await fetch(API + path, opt); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Сервер данных недоступен (' + API + '). Проверьте подключение или запустите backend (npm start).', 0, { noBackend: true });
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new ApiError('Сервер данных не отвечает по адресу ' + API + '. Сайту нужен запущенный Node.js-сервер (см. README).', res.status || 404, { noBackend: true });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Ошибка ' + res.status, res.status, data);
  return raw ? { data, total: Number(res.headers.get('X-Total-Count') || (Array.isArray(data) ? data.length : 0)) } : data;
}
export const get = (path, o) => request(path, o);
export const getPage = (path, o) => request(path, { ...o, raw: true });
// Админ-запросы: CSRF-токен сессии в заголовке
// При API на другом домене cookie не используются: токен сессии хранится только до закрытия вкладки (sessionStorage)
export const admin = { csrf: null, token: CROSS ? sessionStorage.getItem('eh-admin-token') : null };
export function setAdminToken(t) { admin.token = t || null; try { t ? sessionStorage.setItem('eh-admin-token', t) : sessionStorage.removeItem('eh-admin-token'); } catch {} }
export const send = (method, path, body) => request(path, { method, body, headers: admin.csrf ? { 'X-CSRF-Token': admin.csrf } : {} });

// ---------- Мелкие элементы разметки ----------
export function logo(url, name, cls = '') {
  const u = safeImg(url);
  return u ? `<img class="logo ${cls}" src="${u}" alt="${esc(name || '')}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="logo ph ${cls}" aria-hidden="true">${esc((name || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?')}</span>`;
}
export function avatar(url, name, px = 64) {
  const u = safeImg(url);
  return u ? `<img class="ava" src="${u}" alt="${esc(name || '')}" width="${px}" height="${px}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="logo ph ava" aria-hidden="true">${esc((name || '?').slice(0, 2).toUpperCase())}</span>`;
}
export const skeleton = (n = 6, cls = 'grid') => `<div class="${cls}">${'<div class="skel"></div>'.repeat(n)}</div>`;
export const empty = (title, text = '') => `<div class="state"><b>${esc(title)}</b>${esc(text)}</div>`;
export const emptySm = (text) => `<div class="state sm">${esc(text)}</div>`;
export const errorBox = (e) => `<div class="state err" role="alert"><b>Не удалось загрузить данные</b>${esc(e.message)}<br><button class="btn" type="button" data-action="reload">Повторить</button></div>`;
export const gdot = (g) => `<span class="gdot ${esc(g || '')}" title="${esc(GN[g] || '')}"></span>`;

export function toast(text, type = '') {
  const box = document.getElementById('toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = text; box.append(el);
  setTimeout(() => el.remove(), 4200);
}

// ---------- Мета-теги страницы (для SPA-переходов; сервер отдаёт их и при первой загрузке) ----------
import { BRAND } from './brand.js';
const SITE = BRAND.name;
const setTag = (sel, attr, val) => { let m = document.head.querySelector(sel); if (!m) { m = document.createElement('meta'); m.setAttribute(attr, sel.match(/"(.+)"/)[1]); document.head.append(m); } m.setAttribute('content', val); };
// Адрес сайта для canonical: <meta name="site-url"> (если указан) или текущий домен в режиме Node.js-сервера
const SITE_URL = (document.querySelector('meta[name="site-url"]')?.content || '').trim().replace(/\/+$/, '');
// Полные метаданные страницы из assets/js/seo-templates.js: { title, description, robots, jsonld }
export function setSeo(mt, path) {
  document.title = mt.title;
  setTag('meta[name="description"]', 'name', mt.description); setTag('meta[property="og:description"]', 'property', mt.description);
  setTag('meta[property="og:title"]', 'property', mt.title); setTag('meta[name="robots"]', 'name', mt.robots || 'index, follow');
  const origin = SITE_URL || (ROUTER === 'history' ? location.origin : '');
  let c = document.head.querySelector('link[rel="canonical"]');
  if (origin && path && !/noindex/.test(mt.robots || '')) { if (!c) { c = document.createElement('link'); c.rel = 'canonical'; document.head.append(c); } c.href = origin + (BASE === '/' || SITE_URL ? '' : BASE.replace(/\/$/, '')) + path; setTag('meta[property="og:url"]', 'property', c.href); }
  else if (c) c.remove();
  document.head.querySelectorAll('script[data-ld]').forEach((x) => x.remove());
  for (const j of mt.jsonld || []) { if (!j) continue; const x = document.createElement('script'); x.type = 'application/ld+json'; x.dataset.ld = '1'; x.textContent = JSON.stringify(j); document.head.append(x); }
}
export const seoOrigin = () => SITE_URL || (ROUTER === 'history' ? location.origin : '');
// Короткая форма для разделов и служебных страниц: «Заголовок | CyberLeague»
export function setMeta({ title, description, robots = 'index, follow' }) {
  setSeo({ title: title ? `${title} | ${SITE}` : `${SITE} — ${BRAND.tagline}`, description: description || document.head.querySelector('meta[name="description"]')?.content || '', robots }, robots.startsWith('index') ? here() : null);
}
const here = () => { const h = location.hash.startsWith('#/') ? location.hash.slice(1) : '/' + location.pathname.slice(BASE.length); return h.split('?')[0].replace(/\/+$/, '') || '/'; };
