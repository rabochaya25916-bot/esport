// Парсер конфигов CYBERSHOKE (https://cybershoke.net/ru/configs).
// Источник — тот же публичный JSON, который загружает страница конфигов: POST /api/api/v1/config/list
// { page_index, group, search, order }. group: 1 — PRO-игроки, 2 — таланты (стримеры). 100 записей на страницу.
// Без авторизации, CAPTCHA и обхода ограничений: при 429 — пауза и повтор, при недоступности сохраняются прошлые данные.
//
// Результат:
//   assets/js/data/cs2/configs.json         — лёгкий список для каталога (поиск/фильтры/сортировка)
//   assets/js/data/cs2/configs/<steamid>.json — полные настройки игрока (грузятся только на странице конфига)
'use strict';
const path = require('path');
const fs = require('fs');
const { fetchRetry, sleep, readJson, writeJsonAtomic, nickKey, slugify } = require('./common');

const ENDPOINT = 'https://cybershoke.net/api/api/v1/config/list';
const GROUPS = { 1: 'pro', 2: 'talent' };
const PER_PAGE = 100;
const MAX_PAGES = Number(process.env.CYBERSHOKE_MAX_PAGES || 20);

async function fetchPage(group, page) {
  const r = await fetchRetry(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://cybershoke.net', Referer: 'https://cybershoke.net/ru/configs' },
    body: JSON.stringify({ page_index: page, group: Number(group), search: '', order: 0 }),
  }, { label: `cybershoke group=${group} page=${page}` });
  const j = await r.json();
  if (!j || !Array.isArray(j.list)) throw new Error('cybershoke: неожиданный формат ответа');
  return { list: j.list, total: Number(j.data && j.data.count_configs) || j.list.length };
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined && o[k] !== '') r[k] = o[k]; return r; };
const iso = (unix) => (unix ? new Date(Number(unix) * 1000).toISOString() : null);

// Нормализация одной записи источника. Ничего не досчитываем и не выдумываем: только то, что пришло.
function normalize(x, category) {
  const cv = (x.cfg && x.cfg.cvars) || {};
  const mouse = cv.mouse || {};
  const steam = String(x.steamid64 || '').replace(/\D/g, '');
  if (!steam || !x.name) return null;
  const summary = {
    id: steam, slug: slugify(x.name), nickname: String(x.name).trim(), key: nickKey(x.name), category,
    avatar: /^https:\/\//.test(x.avatar || '') ? x.avatar : null, verified: !!x.verification,
    updated: iso(x.unixtime_last_update), added: iso(x.unixtime_add), downloads: num(x.count_downloads),
    sens: num(mouse.sensitivity), zoom: num(mouse.zoom_sensitivity_ratio),
    has_xh: !!(cv.crosshair && Object.keys(cv.crosshair).length),
  };
  const detail = {
    ...summary,
    description: x.description && !/cybershoke|cs-config/i.test(x.description) ? String(x.description).slice(0, 500) : null,
    // Скачивание конфига источник даёт на странице профиля игрока
    cvars: {
      mouse: pick(mouse, Object.keys(mouse)),
      crosshair: cv.crosshair || {},
      viewmodel: cv.viewmodel || {},
      hud: cv.hud || {},
      radar: cv.radar || {},
      sound: cv.sound || {},
      cl_bob: cv.cl_bob || {},
      misc: cv.misc || {},
    },
    binds: x.cfg && x.cfg.bind && !Array.isArray(x.cfg.bind) ? x.cfg.bind : {},
  };
  return { summary, detail };
}

async function run({ outDir, log = console.log } = {}) {
  const listFile = path.join(outDir, 'configs.json');
  const detailDir = path.join(outDir, 'configs');
  const prev = readJson(listFile, { items: [] });
  const byId = new Map((prev.items || []).map((c) => [c.id, c]));
  const seen = new Set(); let pages = 0; const errors = [];

  for (const [group, category] of Object.entries(GROUPS)) {
    try {
      let page = 1, total = Infinity;
      while ((page - 1) * PER_PAGE < total && page <= MAX_PAGES) {
        const r = await fetchPage(group, page); pages++;
        total = r.total;
        for (const raw of r.list) {
          const n = normalize(raw, category); if (!n) continue;
          if (seen.has(n.summary.id)) continue;           // один игрок может быть в нескольких группах — без дублей
          seen.add(n.summary.id);
          const old = byId.get(n.summary.id);
          // Обновляем существующую запись вместо создания новой; детальный файл пишем только при изменении
          const detailFile = path.join(detailDir, n.summary.id + '.json');
          const changed = !old || old.updated !== n.summary.updated || !fs.existsSync(detailFile);
          if (changed) writeJsonAtomic(detailFile, n.detail);
          byId.set(n.summary.id, { ...n.summary, first_seen: (old && old.first_seen) || new Date().toISOString() });
        }
        if (!r.list.length) break;
        page++; await sleep(1500);
      }
    } catch (e) { errors.push(`${category}: ${e.message}`); log(`[cybershoke] ${category}: ${e.message}`); }
  }
  if (!seen.size) throw new Error('CYBERSHOKE не ответил ни одной записью: ' + errors.join('; '));
  // Игроки, которые пропали из источника, остаются (с пометкой), чтобы не ломать ссылки и профили
  for (const [id, c] of byId) if (!seen.has(id)) byId.set(id, { ...c, stale: true });
  const items = [...byId.values()].sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  const out = { last_success_at: new Date().toISOString(), partial_errors: errors, count: items.length, items };
  writeJsonAtomic(listFile, out);
  log(`[cybershoke] страниц: ${pages}, записей: ${items.length}${errors.length ? ', ошибки: ' + errors.join('; ') : ''}`);
  return out;
}

module.exports = { run, normalize };
