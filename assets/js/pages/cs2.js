// Разделы CS2: конфиги и прицелы игроков.
// Данные готовят scripts/update-cs2-content.js и два независимых парсера в scripts/parsers/; браузер только читает
// готовые JSON-файлы (assets/js/data/cs2/*). Ручные проверенные записи из assets/js/data/configs.js по-прежнему поддерживаются.
import { esc, setMeta, empty, emptySm, toast, safeHref, safeImg, day, get, num } from '../core.js';
import { sec } from '../ui.js';
import { PLAYER_CONFIGS } from '../data/configs.js';
import * as XH from '../crosshair.js';
import * as SEO from '../seo-templates.js';
import { BRAND } from '../brand.js';
import { setSeo, seoOrigin } from '../core.js';
import { setQuery } from '../router.js';
import * as D from '../cs2-data.js';

const PER_PAGE = 48;
const CAT = { pro: 'PRO-игрок', talent: 'Стример', streamer: 'Стример / ютубер' };

// ---------- Общие компоненты ----------
export function findConfig(p) {
  if (!p) return null;
  const nick = String(p.nickname || '').toLowerCase();
  return PLAYER_CONFIGS.find((c) => (c.player_id && c.player_id === p.id) || (nick && String(c.nickname || '').toLowerCase() === nick)) || null;
}
const safeDecode = (code) => { try { return code ? XH.decode(code) : null; } catch { return null; } };
const copyBtn = (text, label = 'Копировать') => `<button class="btn sm" type="button" data-copy="${esc(text)}">${label}</button>`;
function bindCopy(root) {
  root.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const label = b.textContent; const text = b.dataset.copy;
    let ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch {}
    if (!ok) { // запасной вариант для http-сайтов
      const t = Object.assign(document.createElement('textarea'), { value: text }); t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select();
      try { ok = document.execCommand('copy'); } catch {} t.remove();
    }
    if (ok) { b.textContent = 'Скопировано ✓'; b.classList.add('ok'); b.disabled = true; setTimeout(() => { b.textContent = label; b.classList.remove('ok'); b.disabled = false; }, 1500); toast('Скопировано в буфер обмена'); }
    else toast('Не удалось скопировать — выделите текст и скопируйте вручную', 'err');
  }));
}
export { bindCopy };
export const cfgSlug = (c) => encodeURIComponent(String(c.nickname || '').toLowerCase());
const kvList = (rows) => `<dl class="spec">${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const teamHtml = (c) => (c.team ? (c.team_id ? `<a href="/team/${Number(c.team_id)}">${esc(c.team)}</a>` : esc(c.team)) : '');
const norm = (s) => D.nickKey(s);
const slugParam = (s) => { try { return encodeURIComponent(norm(decodeURIComponent(s)).replace(/\s+/g, '-')); } catch { return ''; } };
const fresh = (iso, label) => (iso ? `<p class="note">${label}: ${esc(day(iso))}</p>` : '');

// Профиль игрока на сайте по нику (без дублей: только точное совпадение ника в CS2). Нет сервера данных — тихо пропускаем.
async function findPlayer(nick, signal) {
  try {
    const r = await get(`/search?type=players&game=cs2&limit=5&q=${encodeURIComponent(nick)}`, { signal });
    const k = norm(nick); const hit = (r.players || []).filter((p) => norm(p.nickname) === k);
    return hit.length === 1 ? hit[0] : null;          // однофамильцы — не угадываем
  } catch { return null; }
}

// Пагинация: ‹ 1 … 4 5 6 … 20 ›
function pager(page, pages) {
  if (pages <= 1) return '';
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const list = [...set].sort((a, b) => a - b); const out = []; let prev = 0;
  for (const p of list) { if (p - prev > 1) out.push('<span>…</span>'); out.push(`<button type="button" class="btn sm${p === page ? ' pri' : ''}" data-page="${p}"${p === page ? ' aria-current="page"' : ''}>${p}</button>`); prev = p; }
  return `<nav class="pager" aria-label="Страницы"><button type="button" class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Предыдущая">‹</button>${out.join('')}<button type="button" class="btn sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Следующая">›</button></nav>`;
}

// Каталог с поиском/фильтрами/сортировкой/страницами. Состояние — в адресе (?q=&cat=&sort=&page=), canonical не меняется.
function catalog(ctx, { items, card, filters, sorts, match, sortFns, gridCls, emptyText }) {
  const q = ctx.query;
  const st = { q: q.get('q') || '', cat: q.get('cat') || '', sort: sorts.some(([k]) => k === q.get('sort')) ? q.get('sort') : sorts[0][0], page: Math.max(1, Number(q.get('page')) || 1) };
  const root = ctx.app.querySelector('#cat');
  root.innerHTML = `<div class="toolbar" role="search"><input class="inp grow" id="cq" type="search" placeholder="Поиск по нику" value="${esc(st.q)}" maxlength="40" aria-label="Поиск по нику" autocomplete="off">
    ${filters.length ? `<label class="lbl">Категория <select class="sel" id="cc"><option value="">Все</option>${filters.map(([k, l]) => `<option value="${k}"${k === st.cat ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
    <label class="lbl">Сортировка <select class="sel" id="cs">${sorts.map(([k, l]) => `<option value="${k}"${k === st.sort ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <span class="mut mono" id="cn"></span></div><div id="cl"></div><div id="cp"></div>`;
  // Поисковый индекс строится один раз
  const idx = items.map((c) => [c, norm(c.nickname)]);
  const draw = (scroll) => {
    const k = norm(st.q);
    const rows = idx.filter(([c, n]) => (!k || n.includes(k)) && (!st.cat || match(c, st.cat))).map(([c]) => c).sort(sortFns[st.sort]);
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE)); if (st.page > pages) st.page = pages;
    const part = rows.slice((st.page - 1) * PER_PAGE, st.page * PER_PAGE);
    root.querySelector('#cn').textContent = `${num(rows.length)} из ${num(items.length)}`;
    root.querySelector('#cl').innerHTML = part.length ? `<div class="${gridCls}">${part.map(card).join('')}</div>` : empty('Ничего не найдено', k ? `По запросу «${st.q}» записей нет.` : emptyText);
    root.querySelector('#cp').innerHTML = pager(st.page, pages);
    bindCopy(root);
    setQuery({ q: st.q, cat: st.cat, sort: st.sort === sorts[0][0] ? '' : st.sort, page: st.page > 1 ? st.page : '' });
    if (scroll) root.scrollIntoView({ block: 'start' });
  };
  let t; root.querySelector('#cq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.page = 1; draw(); }, 120); };
  const cc = root.querySelector('#cc'); if (cc) cc.onchange = () => { st.cat = cc.value; st.page = 1; draw(); };
  root.querySelector('#cs').onchange = (e) => { st.sort = e.target.value; st.page = 1; draw(); };
  root.querySelector('#cp').onclick = (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { st.page = Number(b.dataset.page); draw(true); } };
  draw();
}

// ================= КОНФИГИ =================
const cfgThumb = (c) => (safeImg(c.avatar) ? `<img class="av" src="${safeImg(c.avatar)}" alt="" width="48" height="48" loading="lazy" decoding="async">` : `<span class="av ph">${esc(String(c.nickname).slice(0, 1).toUpperCase())}</span>`);
function proConfigCard(c) {
  return `<a class="cfg cfg-link${c.stale ? ' stale' : ''}" href="/config/${c.slug}">
    <header class="cfg-h">${cfgThumb(c)}<div class="min0"><h3 class="ell">${esc(c.nickname)}</h3>
    <small class="mut">${esc(CAT[c.category] || '')}${c.updated ? ' · ' + esc(day(c.updated)) : ''}</small></div></header>
    ${kvList([['Чувствительность', c.sens ?? null], ['Zoom', c.zoom ?? null], ['Скачиваний', c.downloads != null ? num(c.downloads) : null]])}</a>`;
}
function manualCard(c) {
  const m = c.mouse || {};
  return `<a class="cfg cfg-link" href="/config/${cfgSlug(c)}"><header class="cfg-h"><span class="av ph">${esc(String(c.nickname).slice(0, 1).toUpperCase())}</span><div><h3>${esc(c.nickname)}</h3><small class="mut">${teamHtml(c) || 'проверенная запись'}</small></div></header>
    ${kvList([['DPI', m.dpi], ['Чувствительность', m.sens], ['eDPI', m.dpi && m.sens ? Math.round(m.dpi * m.sens) : null]])}</a>`;
}

export async function configs(ctx) {
  setSeo(SEO.staticPage(BRAND.name, '/configs'), '/configs');
  ctx.app.innerHTML = `<div class="page"><h1>Конфиги игроков CS2</h1>
    <p class="lead">Настройки PRO-игроков и стримеров: чувствительность мыши, прицел, viewmodel, HUD, радар и звук. Данные обновляются автоматически.</p>
    <div id="cat"><div class="state sm">Загружаем конфиги…</div></div>
    <div class="cols" style="margin-top:28px">
      <a class="quick" href="/crosshairs"><span class="q-ic">✛</span><div><b>Прицелы CS2</b><small>Коды прицелов игроков с картинками</small></div></a>
      <a class="quick" href="/players"><span class="q-ic">◎</span><div><b>Игроки</b><small>Профили, статистика и команды</small></div></a></div></div>`;
  const d = await D.configsList(); if (ctx.signal.aborted) return;
  const manual = PLAYER_CONFIGS.filter((m) => !d.items.some((c) => c.key === norm(m.nickname))).map((m) => ({ ...m, manual: true, key: norm(m.nickname), slug: cfgSlug(m), category: 'pro', updated: m.updated }));
  const items = [...d.items, ...manual];
  if (!items.length) { ctx.app.querySelector('#cat').innerHTML = empty('Конфиги ещё не загружены', 'Данные появятся после первого запуска обновления (scripts/update-cs2-content.js).'); return; }
  catalog(ctx, {
    items, gridCls: 'cfg-grid', emptyText: 'В этой категории записей нет.',
    card: (c) => (c.manual ? manualCard(c) : proConfigCard(c)),
    filters: [['pro', 'PRO-игроки'], ['talent', 'Стримеры']],
    match: (c, k) => c.category === k,
    sorts: [['updated', 'Сначала обновлённые'], ['downloads', 'Популярные'], ['nick', 'По нику'], ['sens', 'Чувствительность ↑']],
    sortFns: {
      updated: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')),
      downloads: (a, b) => (b.downloads || 0) - (a.downloads || 0),
      nick: (a, b) => String(a.nickname).localeCompare(String(b.nickname)),
      sens: (a, b) => (a.sens ?? 99) - (b.sens ?? 99),
    },
  });
  ctx.app.querySelector('#cat').insertAdjacentHTML('beforeend', fresh(d.last_success_at, 'Данные обновлены'));
}

// Старая карточка ручной записи (assets/js/data/configs.js) — для профиля игрока и страницы ручного конфига
export function configCard(c, { full = false } = {}) {
  const x = safeDecode(c.crosshair);
  const m = c.mouse || {}; const v = c.video || {};
  const edpi = m.dpi && m.sens ? Math.round(m.dpi * m.sens) : null;
  return `<article class="cfg">
    <header class="cfg-h">${x ? `<div class="xh-thumb">${XH.svg(x, { px: 72 })}</div>` : ''}<div><h3><a href="/config/${cfgSlug(c)}">${esc(c.nickname)}</a></h3><small class="mut">${teamHtml(c)}${c.updated ? (c.team ? ' · ' : '') + 'обновлено ' + esc(day(c.updated)) : ''}</small></div></header>
    ${kvList([['DPI', m.dpi], ['Чувствительность', m.sens], ['eDPI', edpi], ['Частота мыши', m.hz ? m.hz + ' Гц' : null], ['Разрешение', esc(v.resolution || '')], ['Соотношение', esc(v.aspect || '')], ['Масштабирование', esc(v.scaling || '')], ['Частота монитора', v.hz ? v.hz + ' Гц' : null]])}
    ${c.crosshair ? `<div class="code-row"><code class="mono">${esc(c.crosshair)}</code>${copyBtn(c.crosshair)}</div>` : ''}
    ${full && c.viewmodel ? `<div class="code-row"><code class="mono">${esc(c.viewmodel)}</code>${copyBtn(c.viewmodel)}</div>` : ''}
    ${full && c.launch ? `<div class="code-row"><code class="mono">${esc(c.launch)}</code>${copyBtn(c.launch)}</div>` : ''}
    ${full && c.gear ? kvList([['Мышь', esc(c.gear.mouse || '')], ['Монитор', esc(c.gear.monitor || '')], ['Клавиатура', esc(c.gear.keyboard || '')], ['Наушники', esc(c.gear.headset || '')]]) : ''}
    ${full && c.cfg ? `<details class="cfg-full"><summary>Полный конфиг</summary><pre class="mono">${esc(c.cfg)}</pre>${copyBtn(c.cfg, 'Скопировать конфиг')}</details>` : ''}
    <div class="cfg-links">${!full ? `<a class="btn sm" href="/config/${cfgSlug(c)}">Все настройки</a>` : ''}${c.player_id ? `<a class="btn sm" href="/player/${Number(c.player_id)}">Профиль игрока</a>` : ''}</div>
  </article>`;
}

// Блок в профиле игрока: ручная запись или данные парсеров (по нику). Заполняется после загрузки страницы.
export function playerSetupSection(p) {
  const c = findConfig(p);
  if (c) return sec('Конфиг и прицел', configCard(c, { full: true }), { id: 'setup', more: ['/configs', 'Все конфиги'] });
  return '<div id="setup-auto"></div>';
}
export async function fillPlayerSetup(root, p) {
  const box = root.querySelector('#setup-auto'); if (!box || p.game_code !== 'cs2') return;
  const [c, x] = await Promise.all([D.configByNick(p.nickname), D.crosshairByNick(p.nickname)]);
  if (!box.isConnected || (!c && !x)) return;
  const xd = x && safeDecode(x.code);
  box.innerHTML = sec('Конфиг и прицел', `<div class="cfg-grid">
    ${c ? proConfigCard(c) : ''}
    ${x ? `<article class="cfg"><header class="cfg-h">${xhImg(x, 64) ? `<span class="xh-thumb">${xhImg(x, 64)}</span>` : xd ? `<span class="xh-thumb">${XH.svg(xd, { px: 56 })}</span>` : ''}<div><h3><a href="/crosshair/${x.slug}">Прицел ${esc(x.nickname)}</a></h3><small class="mut">${x.date ? esc(day(x.date)) : ''}</small></div></header>
      <div class="code-row"><code class="mono">${esc(x.code)}</code>${copyBtn(x.code)}</div></article>` : ''}</div>`, { id: 'setup', more: ['/configs', 'Все конфиги'] });
  bindCopy(box);
}

function bindDownload(root, c) {
  const b = root.querySelector('[data-dl]'); if (!b || !c.cfg) return;
  b.onclick = () => {
    const url = URL.createObjectURL(new Blob([c.cfg], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${String(c.nickname).replace(/[^\w.-]+/g, '_')}.cfg` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
const notFound = () => { const e = new Error('Не найдено'); e.status = 404; return e; };
const GROUPS = [['mouse', 'Мышь'], ['crosshair', 'Прицел'], ['viewmodel', 'Viewmodel'], ['hud', 'Интерфейс (HUD)'], ['radar', 'Радар'], ['sound', 'Звук'], ['cl_bob', 'Покачивание оружия'], ['misc', 'Прочее']];
const MOUSE_L = { sensitivity: 'Чувствительность', zoom_sensitivity_ratio: 'Zoom-чувствительность', m_yaw: 'm_yaw', m_pitch: 'm_pitch', cl_crosshair_recoil: 'Прицел за отдачей' };

// ---------- /config/:slug ----------
export async function configPage(ctx) {
  const slug = slugParam(ctx.params[0]);
  const list = await D.configsList(); if (ctx.signal.aborted) return;
  const s = list.items.find((c) => c.slug === slug);
  if (!s) {                                                // ручная запись из configs.js
    const c = PLAYER_CONFIGS.find((m) => cfgSlug(m) === slug); if (!c) throw notFound();
    setSeo(SEO.config(BRAND.name, c, seoOrigin(), `/config/${cfgSlug(c)}`), `/config/${cfgSlug(c)}`);
    ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/configs">Конфиги</a><span>${esc(c.nickname)}</span></nav><h1>Конфиг ${esc(c.nickname)}</h1>${configCard(c, { full: true })}</div>`;
    bindCopy(ctx.app); bindDownload(ctx.app, c); return;
  }
  ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/configs">Конфиги</a><span>${esc(s.nickname)}</span></nav><h1>Конфиг ${esc(s.nickname)}</h1><div class="state sm">Загружаем настройки…</div></div>`;
  const [c, xh] = await Promise.all([D.configDetail(s.id), D.crosshairByNick(s.nickname)]);
  if (ctx.signal.aborted) return;
  if (!c) throw new Error('Не удалось загрузить настройки игрока');
  setSeo(SEO.proConfig(BRAND.name, c, seoOrigin(), `/config/${s.slug}`), `/config/${s.slug}`);
  const cv = c.cvars || {};
  const pv = D.crosshairFromCvars(cv.crosshair, XH.DEFAULT);
  const xcmd = D.cvarsToConsole(cv.crosshair);
  const groups = GROUPS.filter(([k]) => cv[k] && Object.keys(cv[k]).length);
  ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/configs">Конфиги</a><span>${esc(c.nickname)}</span></nav>
    <div class="profile">${cfgThumb(c).replace('width="48" height="48"', 'width="96" height="96"').replace('class="av', 'class="av xl')}<div class="pmain"><h1>Конфиг ${esc(c.nickname)}</h1>
      <div class="chips"><span class="chip">${esc(CAT[c.category] || 'Игрок')}</span>${c.updated ? `<span class="chip">обновлён ${esc(day(c.updated))}</span>` : ''}${c.downloads != null ? `<span class="chip">${num(c.downloads)} скачиваний</span>` : ''}</div>
      ${c.description ? `<p class="lead">${esc(c.description)}</p>` : ''}</div></div>
    <div class="cfg-links" id="plinks"><button class="btn pri" type="button" id="cfgdl">Скачать конфиг (.cfg)</button>${xh ? `<a class="btn" href="/crosshair/${xh.slug}">Прицел ${esc(xh.nickname)}</a>` : ''}</div>
    ${pv ? sec('Прицел из конфига', `<div class="xh-layout"><div class="xh-stage-wrap"><div class="xh-stage bg-sky">${XH.svg(pv.x, { px: 240 })}</div>
      <p class="note">Предпросмотр по параметрам конфига (приблизительно).${pv.missing.length ? ' В конфиге нет: ' + esc(pv.missing.join(', ')) + ' — для них взяты значения по умолчанию.' : ''}</p></div>
      <div class="panel"><div class="code-row big stack"><code class="mono">${esc(xcmd)}</code>${copyBtn(xcmd, 'Копировать команды')}</div><p class="note">Вставьте строку в консоль CS2 (клавиша ~) и нажмите Enter.</p></div></div>`) : ''}
    ${groups.map(([k, l]) => sec(l, `<div class="panel">${kvList(Object.entries(cv[k]).filter(([, v]) => typeof v !== 'object').map(([n, v]) => [esc(k === 'mouse' ? MOUSE_L[n] || n : n), esc(String(v))]))}
      <div class="code-row"><code class="mono">${esc(D.cvarsToConsole(cv[k]))}</code>${copyBtn(D.cvarsToConsole(cv[k]))}</div></div>`)).join('')}</div>`;
  bindCopy(ctx.app);
  ctx.app.querySelector('#cfgdl').onclick = () => {
    const txt = groups.map(([k, l]) => `// ${l}\n` + Object.entries(cv[k]).filter(([, v]) => v !== '' && v != null && typeof v !== 'object').map(([n, v]) => `${n} "${v}"`).join('\n')).join('\n\n') + '\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = `${c.slug || slug}.cfg`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const pl = await findPlayer(c.nickname, ctx.signal);
  if (pl && !ctx.signal.aborted) ctx.app.querySelector('#plinks')?.insertAdjacentHTML('beforeend', `<a class="btn" href="/player/${Number(pl.id)}">Профиль и статистика</a>${pl.team_id ? `<a class="btn" href="/team/${Number(pl.team_id)}">${esc(pl.team_name || 'Команда')}</a>` : ''}`);
}

// ================= ПРИЦЕЛЫ =================
const xhImg = (c, px) => { const p = c.sprite; if (!p) return null; const k = px / p.size;
  return `<span class="xh-img" role="img" aria-label="Прицел ${esc(c.nickname)}" style="width:${px}px;height:${px}px;background-image:url('${esc(p.url)}');background-size:${p.cols * px}px auto;background-position:-${p.x * k}px -${p.y * k}px"></span>`; };
function xhCard(c) {
  const x = safeDecode(c.code);
  return `<article class="xh-pro"><a class="xh-a" href="/crosshair/${c.slug}"><span class="xh-thumb">${xhImg(c, 100) || (x ? XH.svg(x, { px: 64 }) : '<span class="xh-none" title="Код нового формата: параметры для превью не извлекаются">без превью</span>')}</span><b class="ell">${esc(c.nickname)}</b>
    <small class="mut">${esc(CAT[c.category] || '')}${c.date ? ' · ' + esc(day(c.date)) : ''}</small></a>${copyBtn(c.code, 'Копировать код')}</article>`;
}
export async function crosshairs(ctx) {
  setSeo(SEO.staticPage(BRAND.name, '/crosshairs'), '/crosshairs');
  ctx.app.innerHTML = `<div class="page"><h1>Прицелы CS2</h1>
    <p class="lead">Коды прицелов PRO-игроков и стримеров — копирование в один клик. Данные обновляются автоматически.</p>
    ${sec('Прицелы игроков', '<div id="cat"><div class="state sm">Загружаем прицелы…</div></div>', { id: 'pros' })}
  </div>`;
  const $ = (s) => ctx.app.querySelector(s);

  const d = await D.crosshairsList(); if (ctx.signal.aborted) return;
  const manual = PLAYER_CONFIGS.filter((m) => safeDecode(m.crosshair) && !d.items.some((c) => c.key === norm(m.nickname)))
    .map((m) => ({ key: norm(m.nickname), slug: cfgSlug(m), nickname: m.nickname, code: m.crosshair, date: m.updated, category: 'pro', entry_id: 0 }));
  const items = [...d.items, ...manual];
  if (!items.length) { $('#cat').innerHTML = emptySm('Прицелы ещё не загружены — они появятся после первого обновления данных.'); return; }
  catalog(ctx, {
    items, gridCls: 'xh-pros', emptyText: 'В этой категории прицелов нет.', card: xhCard,
    filters: [['pro', 'PRO-игроки'], ['streamer', 'Стримеры и ютуберы']],
    match: (c, k) => c.category === k,
    sorts: [['new', 'Сначала новые'], ['nick', 'По нику'], ['old', 'Сначала старые']],
    sortFns: { new: (a, b) => (b.entry_id - a.entry_id) || String(b.date || '').localeCompare(String(a.date || '')), old: (a, b) => a.entry_id - b.entry_id, nick: (a, b) => String(a.nickname).localeCompare(String(b.nickname)) },
  });
  $('#cat').insertAdjacentHTML('beforeend', fresh(d.last_success_at, 'Данные обновлены'));
}

// ---------- /crosshair/:slug ----------
export async function crosshairPage(ctx) {
  const slug = slugParam(ctx.params[0]);
  const d = await D.crosshairsList(); if (ctx.signal.aborted) return;
  let c = d.items.find((i) => i.slug === slug);
  if (!c) { const m = PLAYER_CONFIGS.find((p) => cfgSlug(p) === slug && safeDecode(p.crosshair)); if (m) c = { slug, nickname: m.nickname, code: m.crosshair, date: m.updated, category: 'pro', history: [], url: m.source }; }
  if (!c) throw notFound();
  const x = safeDecode(c.code);
  setSeo(SEO.proCrosshair(BRAND.name, c, x, seoOrigin(), `/crosshair/${c.slug}`), `/crosshair/${c.slug}`);
  const cfg = await D.configByNick(c.nickname);
  const cmd = x ? XH.commands(x) : null;
  const rows = x ? [['Стиль', esc(XH.STYLES[x.style] || x.style)], ['Длина', x.size], ['Толщина', x.thickness], ['Зазор', x.gap], ['Обводка', x.outline ? 'да, ' + x.outlineThickness : 'нет'],
    ['Цвет', x.color === 5 ? `RGB ${x.r}, ${x.g}, ${x.b}` : esc(XH.COLORS[x.color] || x.color)], ['Прозрачность', x.alphaEnabled ? x.alpha : 'выключена'], ['Точка', x.dot ? 'да' : 'нет'], ['T-образный', x.tStyle ? 'да' : 'нет']] : [];
  ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/crosshairs">Прицелы</a><span>${esc(c.nickname)}</span></nav>
    <h1>Прицел ${esc(c.nickname)}</h1>
    <div class="chips"><span class="chip">${esc(CAT[c.category] || 'Игрок')}</span>${c.date ? `<span class="chip">от ${esc(day(c.date))}</span>` : ''}</div>
    ${sec('Код прицела', `<div class="code-row big"><code class="mono">${esc(c.code)}</code>${copyBtn(c.code, 'Копировать код')}</div>
      <p class="note">В CS2: Настройки → Игра → Прицел → «Поделиться или импортировать», или в консоли: <code class="mono">apply_crosshair_code ${esc(c.code)}</code> ${copyBtn('apply_crosshair_code ' + c.code, 'Копировать команду')}</p>`)}
    ${c.sprite || x ? `<div class="xh-layout"><div class="xh-stage-wrap"><div class="xh-stage xh-dark">${xhImg(c, 300) || XH.svg(x, { px: 240 })}</div><p class="note">Так прицел выглядит в игре (разрешение 1280×960).</p></div>
      ${x ? `<div class="panel">${kvList(rows)}</div>` : ''}</div>` : ''}
    ${x ? sec('Консольные команды', `<div class="code-row big"><code class="mono">${esc(cmd)}</code>${copyBtn(cmd)}</div>`) : ''}
    ${(c.history || []).length ? sec('Предыдущие версии', `<div class="panel">${c.history.map((h) => `<div class="code-row"><small class="mut mono">${esc(h.date ? day(h.date) : '—')}</small><code class="mono">${esc(h.code)}</code>${copyBtn(h.code)}</div>`).join('')}</div>`) : ''}
    <div class="cfg-links" id="plinks">${cfg ? `<a class="btn" href="/config/${cfg.slug}">Конфиг ${esc(cfg.nickname)}</a>` : ''}</div></div>`;
  bindCopy(ctx.app);
  const pl = await findPlayer(c.nickname, ctx.signal);
  if (pl && !ctx.signal.aborted) ctx.app.querySelector('#plinks')?.insertAdjacentHTML('beforeend', `<a class="btn" href="/player/${Number(pl.id)}">Профиль и статистика</a>`);
}
export { setMeta };
