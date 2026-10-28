// SEO-шаблоны CyberLeague: title, description, H1, robots, хлебные крошки и Schema.org для каждой страницы.
// Один модуль для браузера (setSeo в core.js), Node.js-сервера (src/seo.js) и предгенерации (scripts/prerender.js).
// Чистые функции без импортов: получают факты о сущности и название сайта. Ничего не выдумывают —
// если данных нет, соответствующая часть текста не выводится.

const GN = { cs2: 'CS2', dota2: 'Dota 2', lol: 'League of Legends' };
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const cut = (s, n = 160) => { const t = clean(s); return t.length > n ? t.slice(0, n - 1).replace(/[\s,;:]+\S*$/, '') + '…' : t; };
const list = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' и ' + a[a.length - 1]);
const ruDay = (d) => (d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/\s*г\.$/, '') : '');
const valid = (s) => clean(s) && !/^(tbd|null|undefined|-+)$/i.test(clean(s));
const STALE_DAYS = 45;
const isStale = (d) => !d || Date.now() - Date.parse(d) > STALE_DAYS * 86400e3;

const crumbsLd = (site, crumbs, origin) => (crumbs.length ? {
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: [['Главная', '/'], ...crumbs].map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(origin && path ? { item: origin + path } : {}) })),
} : null);

// Статические разделы. key — логический путь страницы.
export const STATIC_PAGES = {
  '/': [null, 'Матчи и турниры CS2, Dota 2 и League of Legends: расписание, результаты, команды, игроки, конфиги и прицелы про-игроков.'],
  '/matches': ['Матчи CS2, Dota 2 и LoL — расписание и результаты', 'Расписание и результаты матчей с фильтрами по дисциплине, дате и статусу: счёт, карты и статистика игроков.'],
  '/teams': ['Команды — составы и статистика', 'Каталог киберспортивных команд CS2, Dota 2 и LoL: составы, рейтинг, последние матчи и статистика.'],
  '/players': ['Игроки — профили и статистика', 'Профили игроков и тренеров CS2, Dota 2 и LoL: текущие команды, переходы и статистика по матчам.'],
  '/tournaments': ['Турниры — сетки, участники и призовые', 'Текущие, предстоящие и завершённые турниры CS2, Dota 2 и LoL: сетки, участники и результаты.'],
  '/rankings': ['Рейтинги команд', 'Рейтинг Valve для CS2 и места команд в рейтинге по дисциплинам.'],
  '/transfers': ['Трансферы и изменения составов', 'Переходы игроков и изменения составов команд CS2, Dota 2 и LoL.'],
  '/compare': ['Сравнение команд и игроков', 'Сравнение показателей двух команд или двух игроков одной дисциплины.'],
  '/articles': ['Статьи и гайды', 'Авторские статьи, аналитика и гайды по CS2, Dota 2 и League of Legends.'],
  '/sync': ['Состояние данных', 'Когда данные последний раз обновлялись и есть ли ошибки синхронизации.'],
  '/configs': ['Конфиги CS2 — настройки профессиональных игроков', 'Каталог конфигов CS2: чувствительность мыши, разрешение, оборудование и другие доступные настройки игроков.'],
  '/crosshairs': ['Прицелы CS2 — коды и настройки прицелов игроков', 'Каталог прицелов CS2: поиск по нику, просмотр доступных кодов, настройки и быстрый переход к профилям игроков.'],
};
export const NOINDEX_PAGES = ['/search', '/settings', '/admin'];

export function home(site, tagline) {
  return { title: `${site} — ${tagline}`, description: STATIC_PAGES['/'][1], h1: site, robots: 'index, follow', crumbs: [],
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: site }] };
}
export function staticPage(site, path) {
  const s = STATIC_PAGES[path]; if (!s) return null;
  if (path === '/') return null;
  return { title: `${s[0]} | ${site}`, description: s[1], h1: s[0].split(' — ')[0], robots: 'index, follow', crumbs: [[s[0].split(' — ')[0], path]] };
}
export function service(site, title) { return { title: `${title} | ${site}`, description: 'Служебная страница.', robots: 'noindex, follow', crumbs: [] }; }

// f: { nickname, real_name, team, team_id, game, country, role, birthday, has_config, has_crosshair, matches_count, updated_at }
export function player(site, f, origin) {
  const g = GN[f.game] || 'CS2';
  const bio = !!(f.real_name && (f.birthday || f.country));
  const parts = ['статистика', f.has_crosshair && 'прицел', bio && 'биография', f.has_config && 'настройки'].filter(Boolean);
  const title = `${f.nickname}${f.disambig ? ` (${f.disambig})` : ''} — ${list(parts)} ${g} | ${site}`;
  const who = [f.real_name, f.role, f.country].filter(Boolean).join(', ');
  const d = [
    bio ? `Биография ${f.nickname}${who ? ` (${who})` : ''}` : `${f.nickname}${who ? ` (${who})` : ''} — игрок ${g}`,
    f.team ? `текущая команда ${f.team}` : 'без текущей команды в нашей базе',
    f.matches_count ? `статистика по ${f.matches_count} матчам` : 'статистика',
    f.has_crosshair ? 'актуальный прицел' : null,
    f.has_config ? `настройки ${g}` : null,
  ].filter(Boolean);
  const description = cut(`${d[0]}: ${d.slice(1).join(', ')}.${f.has_config || f.has_crosshair ? ` Информация об игроке и его игровых конфигурациях на ${site}.` : ''}`);
  const thin = !f.team && !f.matches_count && !f.has_config;
  const crumbs = [['Игроки', '/players'], ...(f.team && f.team_id ? [[f.team, `/team/${f.team_id}`]] : []), [f.nickname, f.path]];
  const person = { '@context': 'https://schema.org', '@type': 'Person', name: f.real_name || f.nickname, alternateName: f.nickname, ...(f.team ? { memberOf: { '@type': 'SportsTeam', name: f.team } } : {}), ...(origin && f.path ? { url: origin + f.path } : {}) };
  return { title, description, h1: f.nickname, robots: valid(f.nickname) && !thin ? 'index, follow' : 'noindex, follow', crumbs, jsonld: [person, crumbsLd(site, crumbs, origin)].filter(Boolean) };
}

// f: { name, game, country, rank, roster_count, roster_synced_at, has_player_configs, has_player_crosshairs, matches_count, path }
export function team(site, f, origin) {
  const g = GN[f.game] || 'CS2';
  const title = `${f.name}${f.disambig ? ` (${f.disambig})` : ''} — ${f.roster_count ? 'состав, ' : ''}статистика, турниры и ${f.has_player_crosshairs ? 'прицелы игроков' : 'игроки'} | ${site}`;
  const roster = f.roster_count ? (isStale(f.roster_synced_at) ? `Состав ${f.name}${f.roster_synced_at ? ' по данным на ' + ruDay(f.roster_synced_at) : ''}` : `Актуальный состав ${f.name}`) : `${f.name}${f.country ? ' (' + f.country + ')' : ''}`;
  const description = cut(`${roster}, статистика коллектива${f.rank ? `, #${f.rank} в рейтинге` : ''}, результаты матчей и выступления в турнирах ${g}. ${f.has_player_configs ? 'Профили игроков и их настройки.' : 'Профили игроков.'}`);
  const crumbs = [['Команды', '/teams'], [f.name, f.path]];
  return { title, description, h1: f.name, robots: valid(f.name) && (f.roster_count || f.matches_count) ? 'index, follow' : 'noindex, follow', crumbs,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'SportsTeam', name: f.name, sport: g, ...(origin && f.path ? { url: origin + f.path } : {}) }, crumbsLd(site, crumbs, origin)] };
}

// f: { t1, t2, s1, s2, status, start_date, tournament, tournament_id, game, maps_count, has_linked_streams, path }
export function match(site, f, origin) {
  const g = GN[f.game] || 'CS2';
  const a = valid(f.t1) ? f.t1 : 'TBD'; const b = valid(f.t2) ? f.t2 : 'TBD';
  const when = ruDay(f.start_date);
  // Одни и те же команды играют много раз — дата матча делает title уникальным
  const short = f.start_date ? new Date(f.start_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '';
  const what = f.status === 'upcoming' ? 'расписание и составы' : 'счёт и статистика';
  const title = `${a} — ${b}${short ? ` (${short})` : ''}: ${what} матча ${g} | ${site}`;
  const score = f.s1 != null && f.s2 != null ? `${f.s1}:${f.s2}` : null;
  const state = f.status === 'finished' ? (score ? `Матч завершён со счётом ${score}` : 'Матч завершён') : f.status === 'live' ? `Матч идёт${score ? ', счёт ' + score : ''}` : `Матч начнётся${when ? ' ' + when : ''}`;
  const description = cut(`${a} — ${b}${f.tournament ? `, ${f.tournament}` : ''}${f.status === 'finished' && when ? `, ${when}` : ''}. ${state}.${f.maps_count ? ` Карты (${f.maps_count}), составы и статистика игроков.` : ' Составы и статистика игроков.'}${f.has_linked_streams ? ' Официальные трансляции на странице матча.' : ''}`);
  const crumbs = [['Матчи', '/matches'], ...(f.tournament && f.tournament_id ? [[f.tournament, `/tournament/${f.tournament_id}`]] : []), [`${a} — ${b}`, f.path]];
  return { title, description, h1: `${a} — ${b}`, robots: a !== 'TBD' && b !== 'TBD' ? 'index, follow' : 'noindex, follow', crumbs, jsonld: [crumbsLd(site, crumbs, origin)] };
}

// f: { name, game, start_date, end_date, prize, status, teams_count, matches_count, path }
export function tournament(site, f, origin) {
  const g = GN[f.game] || 'CS2';
  const title = `${f.name} — расписание, результаты матчей и команды | ${site}`;
  const dates = f.start_date ? `${ruDay(f.start_date)}${f.end_date ? ' – ' + ruDay(f.end_date) : ''}` : '';
  const description = cut(`Матчи турнира ${f.name}, участвующие команды${f.teams_count ? ` (${f.teams_count})` : ''}, расписание, результаты и статистика ${g}.${dates ? ' Даты: ' + dates + '.' : ''}${f.prize ? ` Призовой фонд $${Number(f.prize).toLocaleString('en-US')}.` : ''}`);
  const crumbs = [['Турниры', '/tournaments'], [f.name, f.path]];
  return { title, description, h1: f.name, robots: valid(f.name) ? 'index, follow' : 'noindex, follow', crumbs, jsonld: [crumbsLd(site, crumbs, origin)] };
}

// c — запись из assets/js/data/configs.js
export function config(site, c, origin, path) {
  const m = c.mouse || {}; const v = c.video || {};
  const facts = [m.dpi && `DPI ${m.dpi}`, m.sens && `чувствительность ${m.sens}`, v.resolution && `разрешение ${v.resolution}${v.aspect ? ' (' + v.aspect + ')' : ''}`, v.hz && `${v.hz} Гц`, c.gear && c.gear.mouse && `мышь ${c.gear.mouse}`].filter(Boolean);
  const description = cut(`Настройки ${c.nickname}${c.team ? ' (' + c.team + ')' : ''} в CS2${facts.length ? ': ' + facts.join(', ') : ''}.${c.crosshair ? ' Код прицела и консольные команды.' : ''}`);
  const crumbs = [['Конфиги', '/configs'], [c.nickname, path]];
  return { title: `Конфиг ${c.nickname} в CS2 — настройки игрока | ${site}`, description, h1: `Конфиг ${c.nickname}`, robots: facts.length || c.crosshair ? 'index, follow' : 'noindex, follow', crumbs, jsonld: [crumbsLd(site, crumbs, origin)] };
}
export function crosshair(site, c, x, origin, path) {
  if (!c.crosshair || !x) return null;     // без кода отдельной страницы прицела нет
  const description = cut(`Прицел ${c.nickname}${c.team ? ' (' + c.team + ')' : ''} в CS2: код ${c.crosshair}, длина ${x.size}, толщина ${x.thickness}, зазор ${x.gap}${x.dot ? ', с точкой' : ''}. Предпросмотр и консольные команды.`);
  const crumbs = [['Прицелы', '/crosshairs'], [c.nickname, path]];
  return { title: `Прицел ${c.nickname} в CS2 — код и настройки | ${site}`, description, h1: `Прицел ${c.nickname}`, robots: 'index, follow', crumbs, jsonld: [crumbsLd(site, crumbs, origin)] };
}

// Конфиг игрока: только реальные поля данных.
export function proConfig(site, c, origin, path) {
  const m = (c.cvars && c.cvars.mouse) || {};
  const facts = [m.sensitivity != null && `чувствительность ${m.sensitivity}`, m.zoom_sensitivity_ratio != null && `zoom ${m.zoom_sensitivity_ratio}`,
    c.cvars && c.cvars.crosshair && Object.keys(c.cvars.crosshair).length && 'прицел', c.cvars && c.cvars.viewmodel && Object.keys(c.cvars.viewmodel).length && 'viewmodel'].filter(Boolean);
  const upd = c.updated ? ` Обновлён ${ruDay(c.updated)}.` : '';
  const description = cut(`Конфиг ${c.nickname} для CS2: ${facts.join(', ') || 'игровые настройки'}, HUD, радар и звук.${upd} Консольные команды и скачивание конфига.`);
  const crumbs = [['Конфиги', '/configs'], [c.nickname, path]];
  return { title: `Конфиг ${c.nickname} CS2 — чувствительность, прицел и настройки | ${site}`, description, h1: `Конфиг ${c.nickname}`,
    robots: facts.length ? 'index, follow' : 'noindex, follow', crumbs, image: c.avatar, jsonld: [crumbsLd(site, crumbs, origin)] };
}
// Прицел игрока. x — разобранные параметры (только для кода формата CSGO-…), иначе null.
export function proCrosshair(site, c, x, origin, path) {
  if (!c || !c.code) return null;
  const params = x ? `, длина ${x.size}, толщина ${x.thickness}, зазор ${x.gap}${x.dot ? ', с точкой' : ''}` : '';
  const description = cut(`Прицел ${c.nickname} в CS2${c.date ? ` от ${ruDay(c.date)}` : ''}: код ${c.code}${params}. Скопируйте код в один клик${x ? ', предпросмотр и консольные команды' : ''}.`);
  const crumbs = [['Прицелы', '/crosshairs'], [c.nickname, path]];
  return { title: `Прицел ${c.nickname} CS2 — код прицела${c.date ? ' ' + c.date.slice(0, 4) : ''} | ${site}`, description, h1: `Прицел ${c.nickname}`, robots: 'index, follow', crumbs, jsonld: [crumbsLd(site, crumbs, origin)] };
}

export const slugNick = (n) => encodeURIComponent(String(n || '').toLowerCase());

// Проверка набора страниц: [{ path, title, description, canonical, robots, h1 }] → { errors, warnings }
export function auditPages(pages) {
  const errors = []; const warnings = [];
  const idx = pages.filter((p) => !/noindex/.test(p.robots || ''));
  const dup = (key) => { const m = new Map(); for (const p of idx) { const k = clean(p[key]).toLowerCase(); if (!k) continue; m.set(k, [...(m.get(k) || []), p.path]); } return [...m].filter(([, v]) => v.length > 1); };
  for (const p of pages) {
    if (!valid(p.title) || /\|\s*$|^\s*\||undefined|null|TBD — TBD/.test(p.title)) errors.push(`${p.path}: пустой или некорректный title «${p.title}»`);
    if (!clean(p.description)) errors.push(`${p.path}: нет description`);
    if (!/noindex/.test(p.robots || '') && !p.canonical) errors.push(`${p.path}: индексируемая страница без canonical`);
    if (!/noindex/.test(p.robots || '') && !clean(p.h1)) warnings.push(`${p.path}: нет H1`);
  }
  for (const [t, v] of dup('title')) errors.push(`Одинаковый title у ${v.length} страниц (${v.slice(0, 3).join(', ')}): «${t}»`);
  for (const [c, v] of dup('canonical')) errors.push(`Один canonical ${c} у страниц: ${v.slice(0, 3).join(', ')}`);
  for (const [d, v] of dup('description')) warnings.push(`Одинаковый description у ${v.length} страниц (${v.slice(0, 3).join(', ')})`);
  return { errors, warnings };
}
