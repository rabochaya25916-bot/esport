// Чистая логика трансляций (без DOM и сети): нормализация списка каналов, порядок, явные привязки.
// Используется браузером (streams.js) и тестами (tests/streams.test.js). Не импортирует другие модули.
//
// Сайт работает без Twitch API: онлайн-статус и число зрителей не запрашиваются и не имитируются.
// Порядок каналов — фиксированный и прозрачный: группа «ru» первой, внутри групп — по priority.

// Список каналов из streams-config.json: логины в нижнем регистре, дубли удаляются (первая запись сохраняется)
export function normalizeChannels(cfg) {
  const seen = new Set(); const out = [];
  (cfg && cfg.channels || []).forEach((c, i) => {
    const login = String(c.login || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,25}$/.test(login) || seen.has(login) || c.enabled === false) return;
    seen.add(login);
    out.push({ ...c, login, group: c.group === 'ru' ? 'ru' : 'other', priority: Number.isFinite(c.priority) ? c.priority : 100 + i, tournaments: c.tournaments || [], teams: c.teams || [] });
  });
  return out;
}

// Порядок: русскоязычная группа → остальные; внутри групп — по приоритету из конфигурации, затем логин.
// Порядок меняется в одном месте: поля group/priority в assets/js/data/streams-config.json.
export function rankChannels(chans) {
  return [...chans].sort((a, b) =>
    (a.group === 'ru' ? 0 : 1) - (b.group === 'ru' ? 0 : 1) ||
    a.priority - b.priority ||
    a.login.localeCompare(b.login));
}

// Явные привязки каналов к событию из конфигурации (links и поле tournaments канала).
// target: { match } или { tournament }. Возвращает Set логинов — такие каналы показываются первыми.
export function linkedLogins(cfg, target = {}) {
  const links = (cfg && cfg.links) || [];
  const out = new Set();
  const tid = target.match ? target.match.tournament && target.match.tournament.id : target.tournament && target.tournament.id;
  const mid = target.match && target.match.id;
  for (const l of links) {
    const login = String(l.login || '').toLowerCase();
    if (!login) continue;
    if (mid != null && l.match_id === mid) out.add(login);
    if (tid != null && l.tournament_id === tid) out.add(login);
  }
  if (tid != null) for (const ch of normalizeChannels(cfg)) if (ch.tournaments.includes(tid)) out.add(ch.login);
  return out;
}
