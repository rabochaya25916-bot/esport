// Обновление разделов «Конфиги» и «Прицелы» CS2. Два независимых парсера: ошибка одного не мешает другому,
// при недоступности источника остаются последние успешно загруженные данные.
//
//   node scripts/update-cs2-content.js                 — обновить то, что устарело (конфиги — раз в 6 ч, прицелы — раз в 12 ч)
//   node scripts/update-cs2-content.js --force         — обновить оба сейчас
//   node scripts/update-cs2-content.js --only=configs  — только конфиги (или --only=crosshairs)
//   node scripts/update-cs2-content.js --import=файл.json — ручной импорт прицелов, если источник недоступен:
//        [{ "nickname": "s1mple", "code": "CSGO-…", "date": "2026-10-01", "url": "https://…", "category": "pro" }]
//
// Интервалы: CONFIGS_EVERY_H (6), CROSSHAIRS_EVERY_H (12), CROSSHAIRS_FULL_EVERY_H (168 — полный обход раз в неделю).
'use strict';
const path = require('path');
const { readJson, writeJsonAtomic, nickKey, slugify } = require('./parsers/common');
const configs = require('./parsers/cybershoke-configs');
const crosshairs = require('./parsers/csconfig-crosshairs');

const OUT = path.join(__dirname, '..', 'assets', 'js', 'data', 'cs2');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const hours = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 36e5 : Infinity);
const H = (k, d) => Number(process.env[k] || d);

function importCrosshairs(file) {
  const rows = readJson(path.resolve(file), null);
  if (!Array.isArray(rows)) throw new Error('Файл импорта должен содержать JSON-массив');
  const target = path.join(OUT, 'crosshairs.json');
  const cur = readJson(target, { items: [] });
  const map = new Map(cur.items.map((c) => [c.key, c])); let n = 0;
  for (const r of rows) {
    if (!r || !r.nickname || !crosshairs.CODE_RE.test(String(r.code || '').trim())) continue;
    const key = nickKey(r.nickname); const old = map.get(key);
    map.set(key, { ...(old || {}), key, slug: slugify(r.nickname), nickname: String(r.nickname).trim(), category: r.category || (old && old.category) || 'pro',
      entry_id: (old && old.entry_id) || 0, code: String(r.code).trim(), date: r.date || null, history: (old && old.history) || [], imported: true });
    n++;
  }
  const items = [...map.values()];
  writeJsonAtomic(target, { ...cur, count: items.length, items, last_import_at: new Date().toISOString() });
  console.log(`Импортировано прицелов: ${n}`);
}

(async () => {
  const images = async () => { try { (await import('./parsers/crosshair-images.mjs')).renderAll(); } catch (e) { console.error('[crosshair images]', e.message); } };
  if (args.import) { importCrosshairs(args.import); return images(); }
  const status = readJson(path.join(OUT, 'status.json'), {});
  let failed = 0;
  if (!args.only || args.only === 'configs') {
    const prev = readJson(path.join(OUT, 'configs.json'), {});
    if (args.force || hours(prev.last_success_at) >= H('CONFIGS_EVERY_H', 6)) {
      try { const r = await configs.run({ outDir: OUT }); status.configs = { ok: true, at: r.last_success_at, count: r.count }; }
      catch (e) { failed++; status.configs = { ...(status.configs || {}), ok: false, error: e.message, failed_at: new Date().toISOString() }; console.error('[configs]', e.message); }
    } else console.log('[cybershoke] данные свежие, пропуск');
  }
  if (!args.only || args.only === 'crosshairs') {
    const prev = readJson(path.join(OUT, 'crosshairs.json'), {});
    if (args.force || prev.full_cursor || hours(prev.last_success_at) >= H('CROSSHAIRS_EVERY_H', 12)) {
      const full = !!args.full || process.env.CROSSHAIRS_FULL === '1' || hours(prev.last_full_at) >= H('CROSSHAIRS_FULL_EVERY_H', 168) || !!prev.full_cursor;
      try { const r = await crosshairs.run({ outDir: OUT, full }); status.crosshairs = { ok: true, at: r.last_success_at, count: r.count, full }; }
      catch (e) { failed++; status.crosshairs = { ...(status.crosshairs || {}), ok: false, error: e.message, failed_at: new Date().toISOString() }; console.error('[crosshairs]', e.message); }
    } else console.log('[crosshairs] данные свежие, пропуск');
  }
  await images();
  writeJsonAtomic(path.join(OUT, 'status.json'), status);
  // Сбой источника не роняет публикацию сайта: остаются прошлые данные
  if (failed && args.strict) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
