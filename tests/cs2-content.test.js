// Парсеры конфигов и прицелов: разбор разметки/ответа источника, нормализация, отсутствие дублей.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const xh = require('../scripts/parsers/csconfig-crosshairs');
const cfg = require('../scripts/parsers/cybershoke-configs');

const card = (id, href, nick, date, code) => `<div id="entryID${id}" class="entryBlock"><div class="pricel-item item-${nick}">
 <a href="${href}" title="Прицел ${nick} от ${date}">
 <span class="pricel-item-img"><div class="big-field"></div></span>
 <span class="pricel-item-name">${nick}</span>
 </a>
 <div class="charecode" hidden>${code}</div>
</div></div>`;

test('CS-CONFIG: разбор карточек, дата и проверка кода', () => {
  const html = card(12153, '/crosshair/z_nan', 'z_nan', '27 октября 2026', 'CSSPeA57BvQ8fWKGwON88svASotjciDNQAsVc63T7cGsKZ')
    + card(12149, '/crosshair/abyss', 'Abyss', '6 октября 2026', 'CSGO-PYd2J-xsB3y-9uFRr-YtWWW-MaBAA')
    + card(1, '/crosshair/bad', 'bad', '1 мая 2026', 'не код');
  const rows = xh.parseList(html);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], { entry_id: 12153, nickname: 'z_nan', date: '2026-10-27', code: 'CSSPeA57BvQ8fWKGwON88svASotjciDNQAsVc63T7cGsKZ' });
  assert.strictEqual(rows[1].date, '2026-10-06');
});

test('CYBERSHOKE: нормализация без выдуманных полей', () => {
  const n = cfg.normalize({ steamid64: '76561198044118796', name: 'XANTARES', verification: true, avatar: 'https://avatars.steamstatic.com/a.jpg', count_downloads: 12070,
    unixtime_last_update: 1793088095, cfg: { bind: [], cvars: { mouse: { sensitivity: 2.3, zoom_sensitivity_ratio: 1.1 }, crosshair: { cl_crosshairsize: 1 } } } }, 'pro');
  assert.strictEqual(n.summary.id, '76561198044118796');
  assert.strictEqual(n.summary.sens, 2.3);
  assert.strictEqual(n.summary.slug, 'xantares');
  assert.strictEqual(n.summary.has_xh, true);
  assert.ok(!('dpi' in n.summary) && !('team' in n.summary));
  assert.strictEqual(cfg.normalize({ name: 'x' }, 'pro'), null);
});

test('CS-CONFIG: один игрок — одна запись, новая версия становится основной', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xh-'));
  const pages = {
    'https://cs-config.com/crosshair-pro-igrokov': card(20, '/crosshair/donk-2', 'donk', '24 октября 2026', 'CSGO-PYd2J-xsB3y-9uFRr-YtWWW-MaBAA') + card(10, '/crosshair/donk', 'Donk', '1 мая 2026', 'CSGO-2LQnD-X55VE-wSMpL-iMpD6-HfiaB'),
    'https://cs-config.com/crosshair-strimerov-i-yutuberov': card(15, '/crosshair/donk-s', 'DONK', '1 июня 2026', 'CSGO-PYd2J-xsB3y-9uFRr-YtWWW-MaBAA'),
  };
  const orig = global.fetch;
  global.fetch = async (u) => ({ ok: true, status: 200, headers: new Map(), text: async () => pages[u] || '' });
  try { await xh.run({ outDir: dir, full: true, log: () => {} }); } finally { global.fetch = orig; }
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'crosshairs.json'), 'utf8'));
  assert.strictEqual(out.items.length, 1);
  assert.strictEqual(out.items[0].entry_id, 20);
  assert.strictEqual(out.items[0].category, 'pro');
  assert.deepStrictEqual(out.items[0].history.map((h) => h.entry_id), [10]);   // дубль кода (id 15) не сохраняется
});
