// Часть 2: список Twitch-каналов, порядок без API, явные привязки и отсутствие ключей/посредников.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/js/data/streams-config.json'), 'utf8'));
const rankP = import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../assets/js/streams-rank.js'), 'utf8')));

test('16 уникальных каналов, PGL — один раз, первые 5 — русскоязычная группа', () => {
  const logins = cfg.channels.map((c) => c.login);
  assert.equal(logins.length, 16);
  assert.equal(new Set(logins).size, 16);
  assert.equal(logins.filter((l) => l === 'pgl').length, 1);
  assert.deepEqual(cfg.channels.filter((c) => c.group === 'ru').map((c) => c.login), ['cs2_paragon_ru', 'bysl4m', 'watchfultv', 'strogo', 'skywhywalker']);
  assert.ok(cfg.channels.filter((c) => c.group === 'ru').every((c) => c.lang === 'ru'));
});

test('порядок без API: русскоязычные первыми, внутри групп — по приоритету из конфигурации', async () => {
  const { normalizeChannels, rankChannels } = await rankP;
  const ranked = rankChannels(normalizeChannels(cfg));
  assert.equal(ranked.length, 16);
  assert.deepEqual(ranked.slice(0, 5).map((c) => c.login), ['cs2_paragon_ru', 'bysl4m', 'watchfultv', 'strogo', 'skywhywalker']);
  assert.equal(ranked[5].login, 'pgl');
  // Отключённый канал выпадает, дубли схлопываются
  const c2 = { channels: [...cfg.channels.map((x) => (x.login === 'redcs' ? { ...x, enabled: false } : x)), { login: 'PGL', priority: 1 }] };
  const r2 = rankChannels(normalizeChannels(c2));
  assert.equal(r2.length, 15);
  assert.equal(r2.filter((c) => c.login === 'pgl').length, 1);
});

test('явные привязки каналов к матчу и турниру из конфигурации', async () => {
  const { linkedLogins } = await rankP;
  const c = { ...cfg, links: [{ login: 'pgl', match_id: 7 }, { login: 'strogo', tournament_id: 45 }] };
  assert.deepEqual([...linkedLogins(c, { match: { id: 7, tournament: { id: 45 } } })].sort(), ['pgl', 'strogo']);
  assert.deepEqual([...linkedLogins(c, { tournament: { id: 45 } })], ['strogo']);
  assert.equal(linkedLogins(c, { match: { id: 8 } }).size, 0);
  // Поле tournaments у канала тоже привязывает к турниру
  const c3 = { ...cfg, channels: cfg.channels.map((x) => (x.login === 'pgl' ? { ...x, tournaments: [45] } : x)) };
  assert.ok(linkedLogins(c3, { tournament: { id: 45 } }).has('pgl'));
});

test('клиент не обращается к Twitch API и не опрашивает статус каналов периодически', () => {
  const src = fs.readFileSync(path.join(__dirname, '../assets/js/streams.js'), 'utf8');
  assert.doesNotMatch(src, /api\.twitch\.tv|helix|streams\.json|\/api\/streams/);
  // Единственный таймер — обновление собственной панели плеера, не запросы статуса
  assert.doesNotMatch(src, /setInterval\((?!sync, 1000\))/);
  // Плеер — официальный Twitch Embed JS с parent = домен сайта
  assert.match(src, /player\.twitch\.tv\/js\/embed\/v1\.js/);
  assert.match(src, /parent: \[location\.hostname\]/);
});

test('родные кнопки Twitch отключены: нет шапки канала, «Отслеживать» и «Клип»', () => {
  const src = fs.readFileSync(path.join(__dirname, '../assets/js/streams.js'), 'utf8');
  assert.match(src, /controls: false/);
  // Поверх плеера ничего не лежит (Twitch ставит видео на паузу, если кадр перекрыт)
  assert.doesNotMatch(src, /no-hover|no-clip/);
});

test('у плеера свои кнопки: пауза, звук, громкость, качество, полный экран', () => {
  const src = fs.readFileSync(path.join(__dirname, '../assets/js/streams.js'), 'utf8');
  for (const k of ['play', 'mute', 'vol', 'q', 'fs']) assert.match(src, new RegExp(`data-plr="${k}"`));
  assert.match(src, /tw\.setMuted/); assert.match(src, /tw\.setVolume/); assert.match(src, /tw\.setQuality/);
  assert.match(src, /requestFullscreen/);
});


test('в клиентском коде нет секретов Twitch', () => {
  const dir = path.join(__dirname, '../assets/js');
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.(js|json)$/.test(f) && !f.includes('vendor'));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /client_secret|TWITCH_CLIENT_SECRET|api\.twitch\.tv\/helix/, f);
});
