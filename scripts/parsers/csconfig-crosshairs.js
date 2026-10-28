// Парсер прицелов CS-CONFIG (https://cs-config.com/crosshair-cs2/). Независим от парсера конфигов.
// Источник — публичные HTML-страницы категорий (обычная разметка, без авторизации):
//   /crosshair-pro-igrokov?pageN            — PRO-игроки
//   /crosshair-strimerov-i-yutuberov?pageN  — стримеры и ютуберы
// Из каждой карточки берутся: id записи, ник, адрес страницы, дата из заголовка «Прицел X от 6 октября 2026», код прицела.
// У одного игрока на источнике бывает несколько версий прицела — сохраняется последняя и до 5 предыдущих (history).
// Быстрый режим (по умолчанию): страницы читаются от новых к старым и обход останавливается, когда подряд идут
// страницы без новых записей. Полный обход — CROSSHAIRS_FULL=1 (раз в неделю, см. scripts/update-cs2-content.js).
'use strict';
const path = require('path');
const { fetchRetry, sleep, readJson, writeJsonAtomic, nickKey, slugify } = require('./common');

const BASE = 'https://cs-config.com';
const CATEGORIES = [['pro', '/crosshair-pro-igrokov'], ['streamer', '/crosshair-strimerov-i-yutuberov']];
const MAX_PAGES = Number(process.env.CSCONFIG_MAX_PAGES || 400);
const BUDGET_MS = Number(process.env.CSCONFIG_TIME_BUDGET_S || 480) * 1000;   // полный обход длинный: по истечении времени сохраняем позицию и продолжаем в следующий запуск
const MONTHS = { 'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12 };
const CODE_RE = /^(CSGO(-[A-Za-z0-9]{5}){5}|CS[A-HJ-Za-fh-km-z2-9]{44})$/;   // классический и новый формат кода CS2

const decodeHtml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
function ruDate(title) {
  const m = String(title).match(/от\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i); if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Разбор одной страницы списка → [{ entry_id, nickname, url, date, code }]
function parseList(html) {
  const out = [];
  const re = /<div id="entryID(\d+)" class="entryBlock">([\s\S]*?)<\/div><\/div>/g; let m;
  while ((m = re.exec(html))) {
    const b = m[2];
    const href = (b.match(/<a href="([^"]+)"/) || [])[1];
    const title = decodeHtml((b.match(/title="([^"]*)"/) || [])[1]);
    const nick = decodeHtml((b.match(/class="pricel-item-name">([^<]*)</) || [])[1]);
    const code = decodeHtml((b.match(/class="charecode"[^>]*>([^<]*)</) || [])[1]);
    if (!href || !nick || !CODE_RE.test(code)) continue;     // без корректного кода запись не сохраняется
    out.push({ entry_id: Number(m[1]), nickname: nick, date: ruDate(title), code });
  }
  return out;
}
const lastPage = (html, cat) => Math.max(1, ...[...html.matchAll(/\?page(\d+)/g)].map((x) => Number(x[1])));

async function fetchHtml(url) { const r = await fetchRetry(url, { headers: { Accept: 'text/html' } }, { label: url }); return r.text(); }

async function run({ outDir, full = false, log = console.log } = {}) {
  const file = path.join(outDir, 'crosshairs.json');
  const prev = readJson(file, { items: [] });
  const byKey = new Map((prev.items || []).map((c) => [c.key, c]));
  const knownEntries = new Set((prev.items || []).flatMap((c) => [c.entry_id, ...(c.history || []).map((h) => h.entry_id)]));
  const errors = []; let pages = 0, added = 0; const started = Date.now();
  let cursor = full ? prev.full_cursor || null : null; let stopped = null;
  const save = (extra = {}) => {
    const items = [...byKey.values()].sort((a, b) => b.entry_id - a.entry_id);
    const out = { last_success_at: prev.last_success_at || null, last_full_at: prev.last_full_at || null, partial_errors: errors, count: items.length, items, ...extra };
    writeJsonAtomic(file, out); return out;
  };

  for (const [category, catPath] of CATEGORIES) {
    if (stopped) break;
    if (cursor && cursor.category !== category && CATEGORIES.findIndex(([c]) => c === cursor.category) > CATEGORIES.findIndex(([c]) => c === category)) continue;
    try {
      let total = 1, quiet = 0;
      const startPage = cursor && cursor.category === category ? cursor.page : 1; cursor = null;
      if (startPage > 1) total = startPage;
      for (let p = startPage; p <= Math.min(total, MAX_PAGES); p++) {
        if (full && Date.now() - started > BUDGET_MS) { stopped = { category, page: p }; break; }
        const html = await fetchHtml(BASE + catPath + (p > 1 ? `?page${p}` : '')); pages++;
        if (p === startPage) total = Math.max(total, lastPage(html));
        if (pages % 20 === 0) save({ full_cursor: full ? { category, page: p + 1 } : prev.full_cursor || null });
        const rows = parseList(html);
        if (!rows.length) break;
        let fresh = 0;
        for (const r of rows) {
          if (!knownEntries.has(r.entry_id)) { fresh++; added++; knownEntries.add(r.entry_id); }
          const key = nickKey(r.nickname);
          const cur = byKey.get(key);
          const ver = { entry_id: r.entry_id, code: r.code, date: r.date };
          if (!cur) {
            byKey.set(key, { key, slug: slugify(r.nickname), nickname: r.nickname, category, ...ver, history: [] });
            continue;
          }
          // Тот же игрок: более новая запись (больший id) становится основной, прежняя уходит в историю. Дубли кодов не копятся.
          const versions = [{ entry_id: cur.entry_id, code: cur.code, date: cur.date }, ...(cur.history || []), ver]
            .filter((v, i, a) => a.findIndex((o) => o.entry_id === v.entry_id) === i).sort((a, b) => b.entry_id - a.entry_id);
          const [top, ...rest] = versions;
          byKey.set(key, { ...cur, category: cur.category === 'pro' || category === 'pro' ? 'pro' : category, ...top,
            history: rest.filter((v, i, a) => v.code !== top.code && a.findIndex((o) => o.code === v.code) === i).slice(0, 5) });
        }
        quiet = fresh ? 0 : quiet + 1;
        if (!full && quiet >= 2) break;                    // дальше только уже известные записи
        await sleep(Number(process.env.CSCONFIG_DELAY_MS || 600));
      }
    } catch (e) { errors.push(`${category}: ${e.message}`); log(`[cs-config] ${category}: ${e.message}`); }
  }
  if (!byKey.size) throw new Error('CS-CONFIG не вернул ни одной записи: ' + errors.join('; '));
  const now = new Date().toISOString();
  const out = save({ last_success_at: errors.length === CATEGORIES.length ? prev.last_success_at : now,
    last_full_at: full && !errors.length && !stopped ? now : prev.last_full_at || null, full_cursor: stopped });
  log(`[cs-config] ${stopped ? `полный обход продолжится со страницы ${stopped.page} (${stopped.category}), ` : ''}страниц: ${pages}, новых записей: ${added}, игроков: ${out.count}${errors.length ? ', ошибки: ' + errors.join('; ') : ''}`);
  return out;
}

module.exports = { run, parseList, ruDate, CODE_RE };
