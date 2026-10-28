// Админ-панель: вход, обзор, публикации (редактор Markdown с предпросмотром), категории, синхронизация, учётная запись.
// Права проверяет сервер: без сессии и CSRF-токена изменяющие запросы отклоняются.
import { get, getPage, send, admin, setAdminToken, esc, GN, fmt, ago, num, setMeta, skeleton, errorBox, empty, emptySm, toast, safeImg, API, CROSS, STATIC } from '../core.js';
import { KIND } from '../ui.js';
import { navigate, here } from '../router.js';

let me = null;
async function session(signal) {
  const s = await get('/admin/session', { signal });
  admin.csrf = s.csrf; me = s.user; return s;
}

export async function page(ctx) {
  setMeta({ title: 'Администрирование', robots: 'noindex, nofollow' });
  const sub = ctx.params[0] || '';
  if (STATIC) {
    ctx.app.innerHTML = `<div class="page"><h1>Администрирование</h1><div class="panel"><p>Эта версия сайта работает без сервера, поэтому входа в админ-панель нет.</p>
      <p>Чтобы добавить или изменить статью, откройте на GitHub папку <code>content/posts</code>, нажмите «Add file → Create new file» и сохраните файл <code>.md</code> по образцу <code>_example.md</code>. Статья появится на сайте при следующем обновлении (до 15 минут).</p>
      <p>Данные матчей обновляются автоматически — смотрите «Состояние данных».</p></div></div>`;
    return;
  }
  ctx.app.innerHTML = `<div class="page">${skeleton(2)}</div>`;
  const s = await session(ctx.signal);
  if (!s.user) return login(ctx, s);
  const nav = [['', 'Обзор'], ['posts', 'Публикации'], ['posts/new', 'Новая публикация'], ['categories', 'Категории'], ['sync', 'Синхронизация'], ['account', 'Учётная запись']];
  const active = sub.startsWith('posts/') && sub !== 'posts/new' ? 'posts' : sub;
  ctx.app.innerHTML = `<div class="page admin"><nav class="admin-nav" aria-label="Админ-панель">${nav.map(([k, l]) => `<a href="/admin${k ? '/' + k : ''}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}<hr><div class="who">Вход: ${esc(me.username)}</div><button type="button" id="lo">Выйти</button></nav><div id="ad"></div></div>`;
  ctx.app.querySelector('#lo').onclick = async () => { await send('POST', '/admin/logout').catch(() => {}); admin.csrf = null; setAdminToken(null); me = null; navigate('/admin'); };
  const box = ctx.app.querySelector('#ad'); const c2 = { ...ctx, app: box };
  let m;
  if (sub === '') return overview(c2);
  if (sub === 'posts') return posts(c2);
  if (sub === 'posts/new') return editor(c2, null);
  if ((m = sub.match(/^posts\/(\d+)$/))) return editor(c2, Number(m[1]));
  if (sub === 'categories') return categories(c2);
  if (sub === 'sync') return syncAdmin(c2);
  if (sub === 'account') return account(c2);
  box.innerHTML = empty('Раздел не найден');
}

function login(ctx, s) {
  ctx.app.innerHTML = `<div class="page login"><div class="panel"><h1 style="font-size:22px">Вход администратора</h1>
    ${s.has_admin ? '' : '<div class="alert warn">Администратор ещё не создан. На сервере выполните <code>npm run admin:create</code> и затем войдите.</div>'}
    <form class="form" id="lf" autocomplete="on">
      <label class="field"><span>Логин</span><input class="inp" name="username" autocomplete="username" required maxlength="60"></label>
      <label class="field"><span>Пароль</span><input class="inp" name="password" type="password" autocomplete="current-password" required maxlength="200"></label>
      <div class="ferr" id="le" role="alert"></div>
      <button class="btn pri" type="submit">Войти</button></form>
    <p class="note">После 5 неудачных попыток вход временно блокируется. Сессия хранится в защищённой cookie.</p></div></div>`;
  const f = ctx.app.querySelector('#lf');
  f.onsubmit = async (e) => {
    e.preventDefault(); const d = new FormData(f); const btn = f.querySelector('button'); btn.disabled = true;
    try { const r = await send('POST', '/admin/login', { username: d.get('username'), password: d.get('password') }); admin.csrf = r.csrf; me = r.user; if (r.token) setAdminToken(r.token); navigate(here().path, { replace: true }); }
    catch (err) { ctx.app.querySelector('#le').textContent = err.message; btn.disabled = false; }
  };
}

const statusBadge = (p) => (p.status === 'draft' ? '<span class="badge draft">Черновик</span>' : p.is_scheduled ? '<span class="badge sched">Отложено</span>' : '<span class="badge acc">Опубликовано</span>');

async function overview(ctx) {
  ctx.app.innerHTML = skeleton(2);
  const o = await get('/admin/overview', { signal: ctx.signal });
  const p = o.posts;
  ctx.app.innerHTML = `<h1>Обзор</h1>
    <div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">${[['', p.published || 0, 'опубликовано'], ['', p.drafts || 0, 'черновиков'], ['', p.scheduled || 0, 'отложено'], ['', o.sessions, 'активных сессий']].map(([c, v, l]) => `<div class="kpi"><b class="mono">${num(v)}</b><small>${l}</small></div>`).join('')}</div>
    <div class="cols" style="margin-top:18px">
      <section class="card"><div class="card-h"><h2>Последние правки</h2><a class="more" href="/admin/posts">Все →</a></div><div class="card-b flush">${o.recent_posts.length ? o.recent_posts.map((x) => `<a class="mini-post" href="/admin/posts/${x.id}"><div><b>${esc(x.title)}</b><small>${statusBadge(x)} · ${esc(ago(x.updated_at))}</small></div></a>`).join('') : emptySm('Публикаций ещё нет.')}</div></section>
      <section class="card"><div class="card-h"><h2>Синхронизация</h2><a class="more" href="/admin/sync">Подробнее →</a></div><div class="card-b">${o.sync.last_runs.slice(0, 5).map((r) => `<div class="status-line" style="padding:4px 0"><span class="dot ${r.status === 'success' ? 'ok' : r.status === 'partial' ? 'warn' : r.status === 'running' ? 'spin' : 'bad'}"></span>${esc(fmt(r.started_at))} · ${r.kind === 'live' ? 'текущие матчи' : 'полный цикл'} · ${esc(r.status)}</div>`).join('') || emptySm('Запусков ещё не было.')}</div></section>
    </div><p style="margin-top:18px"><a class="btn pri" href="/admin/posts/new">+ Новая публикация</a></p>`;
}

async function posts(ctx) {
  const st = { status: '', q: '', page: 1 };
  ctx.app.innerHTML = `<div class="sec-h"><h1 style="margin:0">Публикации</h1><a class="btn pri" href="/admin/posts/new" style="margin-left:auto">+ Новая</a></div>
    <div class="toolbar" style="margin-top:14px"><div class="seg" id="ps">${[['', 'Все'], ['draft', 'Черновики'], ['published', 'Опубликованные'], ['scheduled', 'Отложенные']].map(([k, l]) => `<button type="button" data-s="${k}" class="${k === st.status ? 'on' : ''}">${l}</button>`).join('')}</div>
    <input class="inp grow" id="pq" type="search" placeholder="Поиск по заголовку и тексту" maxlength="80"></div><div id="pl"></div>`;
  const box = ctx.app.querySelector('#pl');
  const load = async () => {
    box.innerHTML = skeleton(3, 'rows');
    try {
      const qs = new URLSearchParams({ limit: 30, offset: (st.page - 1) * 30 }); if (st.status) qs.set('status', st.status); if (st.q) qs.set('q', st.q);
      const { data, total } = await getPage('/admin/posts?' + qs, { signal: ctx.signal });
      box.innerHTML = data.length ? `<div class="card">${data.map((p) => `<div class="admin-row"><div><b><a href="/admin/posts/${p.id}">${esc(p.title)}</a></b><small>${KIND[p.kind]}${p.category ? ' · ' + esc(p.category.name) : ''}${p.game_code ? ' · ' + GN[p.game_code] : ''} · /articles/${esc(p.slug)}</small></div>
        <div class="hide-sm">${statusBadge(p)}</div><div class="hide-sm mono dim" style="font-size:12px">${esc(fmt(p.updated_at))}</div>
        <div class="btns"><a class="btn sm" href="/admin/posts/${p.id}">Изменить</a>${p.status === 'published' && !p.is_scheduled ? `<a class="btn sm ghost" href="/articles/${esc(p.slug)}" target="_blank" rel="noopener">↗</a>` : ''}</div></div>`).join('')}</div>
        <div class="pager"><span>всего ${total}</span></div>` : empty('Публикаций нет', st.status || st.q ? 'Измените фильтр.' : 'Создайте первую статью или гайд.');
    } catch (e) { if (e.name !== 'AbortError') box.innerHTML = errorBox(e); }
  };
  ctx.app.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { st.status = b.dataset.s; ctx.app.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  let tm; ctx.app.querySelector('#pq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 300); };
  load();
}

// ---------- Редактор ----------
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (s) => String(s || '').toLowerCase().split('').map((c) => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const TOOLS = [
  ['B', 'Жирный', (s) => `**${s || 'текст'}**`], ['I', 'Курсив', (s) => `*${s || 'текст'}*`], ['H2', 'Заголовок', (s) => `\n## ${s || 'Заголовок'}\n`], ['H3', 'Подзаголовок', (s) => `\n### ${s || 'Подзаголовок'}\n`], ['|'],
  ['• список', 'Список', (s) => (s || 'пункт').split('\n').map((l) => `- ${l}`).join('\n')], ['1. список', 'Нумерованный список', (s) => (s || 'шаг').split('\n').map((l, i) => `${i + 1}. ${l}`).join('\n')],
  ['❝', 'Цитата', (s) => `> ${s || 'цитата'}`], ['Совет', 'Выноска «Совет»', (s) => `\n> [!TIP]\n> ${s || 'Полезный совет'}\n`], ['Важно', 'Выноска «Внимание»', (s) => `\n> [!WARNING]\n> ${s || 'Обратите внимание'}\n`], ['|'],
  ['🔗', 'Ссылка', (s) => `[${s || 'текст ссылки'}](https://)`], ['</>', 'Код', (s) => (s.includes('\n') ? `\n\`\`\`\n${s}\n\`\`\`\n` : `\`${s || 'код'}\``)], ['Таблица', 'Таблица', () => '\n| Колонка | Колонка |\n|---|---|\n| значение | значение |\n'], ['—', 'Разделитель', () => '\n---\n'],
];

async function editor(ctx, id) {
  ctx.app.innerHTML = skeleton(2);
  const [cats, post] = await Promise.all([get('/admin/categories', { signal: ctx.signal }), id ? get('/admin/posts/' + id, { signal: ctx.signal }) : Promise.resolve(null)]);
  const p = post || { title: '', slug: '', kind: 'article', excerpt: '', body_md: '', cover_url: '', game_code: '', category: null, tags: [], status: 'draft', published_at: null };
  let slugTouched = !!post; let dirty = false; let current = post;
  ctx.app.innerHTML = `<div class="sec-h"><h1 style="margin:0">${post ? 'Редактирование' : 'Новая публикация'}</h1><span id="es" style="margin-left:auto">${post ? statusBadge(post) : '<span class="badge draft">Не сохранено</span>'}</span></div>
    <form class="editor" id="ef" style="margin-top:16px" novalidate>
      <div class="form">
        <label class="field" data-f="title"><span>Заголовок</span><input class="inp" name="title" value="${esc(p.title)}" maxlength="200" required style="font-size:18px;font-weight:700"><span class="ferr"></span></label>
        <label class="field" data-f="excerpt"><span>Анонс <small>— до 500 символов; если пусто, возьмётся начало текста</small></span><textarea class="inp" name="excerpt" rows="2" maxlength="500">${esc(p.excerpt || '')}</textarea><span class="ferr"></span></label>
        <div class="field" data-f="body_md"><span>Текст (Markdown)</span>
          <div class="ed-tabs seg"><button type="button" data-tab="w" class="on">Редактор</button><button type="button" data-tab="p">Предпросмотр</button></div>
          <div class="ed-pane" data-pane="w"><div class="md-tools" role="toolbar" aria-label="Форматирование">${TOOLS.map((t, i) => (t[0] === '|' ? '<span class="sep"></span>' : `<button type="button" data-tool="${i}" title="${esc(t[1])}">${esc(t[0])}</button>`)).join('')}<span class="sep"></span><button type="button" id="imgIns" title="Загрузить картинку в текст">🖼 Картинка</button></div>
            <textarea class="inp md" name="body_md" spellcheck="true">${esc(p.body_md)}</textarea></div>
          <div class="ed-pane" data-pane="p" hidden><div class="preview-box prose" id="pv"></div></div>
          <small id="wc"></small><span class="ferr"></span>
          <small>HTML-теги в тексте не выполняются и показываются как текст. Ссылки — только http(s), картинки — https или загруженные файлы. Выноски: <code>&gt; [!TIP]</code>, <code>&gt; [!WARNING]</code>, <code>&gt; [!NOTE]</code>.</small></div>
      </div>
      <aside class="editor-side">
        <div class="panel form">
          <div class="btns"><button class="btn" type="submit" data-act="save">Сохранить</button>${p.status === 'published' ? '<button class="btn" type="button" data-act="unpublish">Снять с публикации</button>' : '<button class="btn pri" type="button" data-act="publish">Опубликовать</button>'}</div>
          <label class="field" data-f="published_at"><span>Дата публикации <small>— в будущем = отложенная</small></span><input class="inp" type="datetime-local" name="published_at" value="${esc(toLocal(p.published_at))}"><span class="ferr"></span></label>
          <div class="status-line" id="saved">${post ? 'Сохранено ' + esc(ago(post.updated_at)) : 'Ещё не сохранено'}</div>
          ${post && post.status === 'published' && !post.is_scheduled ? `<a class="btn ghost sm" href="/articles/${esc(post.slug)}" target="_blank" rel="noopener">Открыть на сайте ↗</a>` : ''}
        </div>
        <div class="panel form">
          <label class="field" data-f="kind"><span>Тип</span><select class="sel" name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="ferr"></span></label>
          <label class="field" data-f="category_id"><span>Категория</span><select class="sel" name="category_id"><option value="">Без категории</option>${cats.map((c) => `<option value="${c.id}" ${p.category && p.category.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><span class="ferr"></span></label>
          <label class="field" data-f="game_code"><span>Дисциплина</span><select class="sel" name="game_code"><option value="">Общая</option>${Object.entries(GN).map(([k, l]) => `<option value="${k}" ${k === p.game_code ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="ferr"></span></label>
          <label class="field" data-f="tags"><span>Теги <small>— через запятую, до 12</small></span><input class="inp" name="tags" value="${esc(p.tags.map((t) => t.name).join(', '))}" maxlength="500"><span class="ferr"></span></label>
          <label class="field" data-f="slug"><span>Адрес страницы</span><input class="inp mono" name="slug" value="${esc(p.slug)}" maxlength="100" placeholder="заполнится из заголовка"><small id="sl">/articles/${esc(p.slug || '…')}</small><span class="ferr"></span></label>
        </div>
        <div class="panel form" data-f="cover_url">
          <span class="field"><span>Обложка</span></span>
          <div class="cover-prev" id="cp">${safeImg(p.cover_url) ? `<img src="${safeImg(p.cover_url)}" alt="" referrerpolicy="no-referrer">` : 'Нет обложки'}</div>
          <input class="inp" name="cover_url" value="${esc(p.cover_url || '')}" placeholder="https://… или загрузите файл" aria-label="Ссылка на обложку">
          <div class="btns"><label class="btn sm">Загрузить файл<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="cf" hidden></label><button class="btn sm ghost" type="button" id="cx">Убрать</button></div>
          <span class="ferr"></span><small class="dim">PNG, JPEG, WebP или GIF, до 5 МБ. Используйте свои изображения или изображения с правом использования.</small>
        </div>
        ${post ? '<button class="btn danger" type="button" data-act="delete">Удалить публикацию</button>' : ''}
      </aside></form>`;
  const f = ctx.app.querySelector('#ef'); const el = f.elements; const ta = el.body_md;
  const fields = () => {
    const d = new FormData(f); const pa = String(d.get('published_at') || '');
    return { title: d.get('title'), slug: d.get('slug'), excerpt: d.get('excerpt'), body_md: d.get('body_md'), kind: d.get('kind'), category_id: d.get('category_id'), game_code: d.get('game_code'), tags: d.get('tags'), cover_url: d.get('cover_url'), published_at: pa ? new Date(pa).toISOString() : '' };
  };
  const showErrors = (errs = {}) => f.querySelectorAll('[data-f]').forEach((el) => { const m = errs[el.dataset.f]; el.classList.toggle('err', !!m); const fe = el.querySelector('.ferr'); if (fe) fe.textContent = m || ''; });
  const wc = () => { const w = ta.value.replace(/[#*_`>|-]/g, ' ').split(/\s+/).filter(Boolean).length; ctx.app.querySelector('#wc').textContent = `${num(w)} слов · ~${Math.max(1, Math.round(w / 200))} мин чтения`; };
  wc();
  const mark = () => { dirty = true; ctx.app.querySelector('#saved').textContent = 'Есть несохранённые изменения'; };
  f.addEventListener('input', mark);
  el.title.addEventListener('input', () => { if (!slugTouched) { el.slug.value = slugify(el.title.value); ctx.app.querySelector('#sl').textContent = '/articles/' + (el.slug.value || '…'); } });
  el.slug.addEventListener('input', () => { slugTouched = true; ctx.app.querySelector('#sl').textContent = '/articles/' + (slugify(el.slug.value) || '…'); });
  ta.addEventListener('input', wc);
  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload); ctx.cleanup(() => window.removeEventListener('beforeunload', beforeUnload));

  // Панель форматирования
  const insert = (fn) => { const a = ta.selectionStart; const b = ta.selectionEnd; const text = fn(ta.value.slice(a, b)); ta.setRangeText(text, a, b, 'end'); ta.focus(); mark(); wc(); };
  f.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => insert(TOOLS[Number(b.dataset.tool)][2])));
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); insert(TOOLS[0][2]); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); insert(TOOLS[1][2]); }
    if (e.key === 'Tab') { e.preventDefault(); insert(() => '  '); }
  });
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey); ctx.cleanup(() => document.removeEventListener('keydown', onKey));

  // Предпросмотр — серверный рендер, тот же, что увидят читатели
  const preview = async () => { const pv = ctx.app.querySelector('#pv'); pv.innerHTML = '<div class="skel line"></div><div class="skel line"></div>'; try { const r = await send('POST', '/admin/preview', { body_md: ta.value }); pv.innerHTML = r.html || '<p class="mut">Текст пуст.</p>'; } catch (e) { pv.innerHTML = errorBox(e); } };
  f.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { f.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); f.querySelectorAll('[data-pane]').forEach((x) => (x.hidden = x.dataset.pane !== b.dataset.tab)); if (b.dataset.tab === 'p') preview(); }));

  // Загрузка изображений
  const upload = async (file) => {
    if (!file) return null; if (file.size > 5 * 1024 * 1024) { toast('Файл больше 5 МБ', 'err'); return null; }
    const res = await fetch(API + '/admin/uploads', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-CSRF-Token': admin.csrf || '', ...(admin.token ? { Authorization: 'Bearer ' + admin.token } : {}) }, credentials: CROSS ? 'omit' : 'same-origin' });
    const d = await res.json().catch(() => ({})); if (!res.ok) { toast(d.error || 'Не удалось загрузить файл', 'err'); return null; } return d.url;
  };
  const setCover = (u) => { el.cover_url.value = u || ''; ctx.app.querySelector('#cp').innerHTML = safeImg(u) ? `<img src="${safeImg(u)}" alt="" referrerpolicy="no-referrer">` : 'Нет обложки'; mark(); };
  ctx.app.querySelector('#cf').onchange = async (e) => { const u = await upload(e.target.files[0]); if (u) { setCover(u); toast('Обложка загружена'); } e.target.value = ''; };
  ctx.app.querySelector('#cx').onclick = () => setCover('');
  el.cover_url.addEventListener('change', () => setCover(el.cover_url.value.trim()));
  ctx.app.querySelector('#imgIns').onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
    inp.onchange = async () => { const u = await upload(inp.files[0]); if (u) insert((s) => `\n![${s || 'Подпись к изображению'}](${u})\n`); }; inp.click(); };

  // Сохранение и действия
  const busy = (on) => f.querySelectorAll('button').forEach((b) => (b.disabled = on));
  async function save({ silent = false } = {}) {
    busy(true); showErrors();
    try {
      const body = fields();
      const saved = current ? await send('PUT', '/admin/posts/' + current.id, body) : await send('POST', '/admin/posts', body);
      dirty = false; const wasNew = !current; current = saved;
      ctx.app.querySelector('#saved').textContent = 'Сохранено в ' + new Date().toLocaleTimeString('ru-RU');
      ctx.app.querySelector('#es').innerHTML = statusBadge(saved);
      el.slug.value = saved.slug; ctx.app.querySelector('#sl').textContent = '/articles/' + saved.slug; slugTouched = true;
      if (!silent) toast('Сохранено');
      if (wasNew) navigate('/admin/posts/' + saved.id, { replace: true });
      return saved;
    } catch (e) { showErrors(e.data && e.data.errors); toast(e.message, 'err'); return null; } finally { busy(false); }
  }
  f.onsubmit = (e) => { e.preventDefault(); save(); };
  f.querySelector('[data-act="publish"]')?.addEventListener('click', async () => {
    const s = await save({ silent: true }); if (!s) return;
    try { const pa = fields().published_at; const r = await send('POST', `/admin/posts/${s.id}/publish`, pa ? { published_at: pa } : {}); toast(r.is_scheduled ? 'Публикация запланирована' : 'Опубликовано'); navigate('/admin/posts/' + r.id, { replace: true }); }
    catch (e) { showErrors(e.data && e.data.errors); toast(e.message, 'err'); }
  });
  f.querySelector('[data-act="unpublish"]')?.addEventListener('click', async () => {
    try { await send('POST', `/admin/posts/${current.id}/unpublish`); toast('Снято с публикации — теперь это черновик'); navigate('/admin/posts/' + current.id, { replace: true }); } catch (e) { toast(e.message, 'err'); }
  });
  f.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
    if (!confirm(`Удалить «${current.title}» без возможности восстановления?`)) return;
    try { await send('DELETE', '/admin/posts/' + current.id); dirty = false; toast('Публикация удалена'); navigate('/admin/posts'); } catch (e) { toast(e.message, 'err'); }
  });
}

async function categories(ctx) {
  const draw = async () => {
    const cats = await get('/admin/categories', { signal: ctx.signal });
    ctx.app.innerHTML = `<h1>Категории</h1><p class="lead">Категории помогают читателям фильтровать статьи и гайды.</p>
      <div class="card">${cats.map((c) => `<form class="admin-row" data-id="${c.id}"><div><input class="inp" name="name" value="${esc(c.name)}" maxlength="60" aria-label="Название"></div><div class="hide-sm"><input class="inp mono" name="slug" value="${esc(c.slug)}" maxlength="60" aria-label="Адрес"></div><div class="hide-sm mono dim" style="font-size:12px">${c.posts_count} публ.</div><div class="btns"><button class="btn sm">Сохранить</button><button class="btn sm danger" type="button" data-del>Удалить</button></div></form>`).join('') || emptySm('Категорий нет.')}</div>
      <h3>Новая категория</h3><form class="toolbar" id="nc"><input class="inp grow" name="name" placeholder="Название" maxlength="60" required><button class="btn pri">Добавить</button></form>`;
    ctx.app.querySelectorAll('form[data-id]').forEach((fm) => {
      fm.onsubmit = async (e) => { e.preventDefault(); try { await send('PUT', '/admin/categories/' + fm.dataset.id, { name: fm.elements.name.value, slug: fm.elements.slug.value }); toast('Категория сохранена'); draw(); } catch (er) { toast(er.message, 'err'); } };
      fm.querySelector('[data-del]').onclick = async () => { if (!confirm('Удалить категорию? Публикации останутся без категории.')) return; try { await send('DELETE', '/admin/categories/' + fm.dataset.id); draw(); } catch (er) { toast(er.message, 'err'); } };
    });
    ctx.app.querySelector('#nc').onsubmit = async (e) => { e.preventDefault(); try { await send('POST', '/admin/categories', { name: e.target.elements.name.value }); toast('Категория добавлена'); draw(); } catch (er) { toast(er.message, 'err'); } };
  };
  ctx.app.innerHTML = skeleton(2); await draw();
}

async function syncAdmin(ctx) {
  const draw = async () => {
    const o = await get('/admin/overview', { signal: ctx.signal });
    ctx.app.innerHTML = `<h1>Синхронизация</h1><p class="lead">Ручной запуск в дополнение к расписанию. Повторный запуск во время работы отклоняется — источник не нагружается параллельными обходами.</p>
      <div class="btns"><button class="btn pri" id="sf" ${o.sync.running ? 'disabled' : ''}>Запустить полный цикл</button><button class="btn" id="sl" ${o.sync.running ? 'disabled' : ''}>Проверить текущие матчи</button>${o.sync.running ? '<span class="status-line"><span class="dot spin"></span>идёт синхронизация…</span>' : ''}<a class="btn ghost" href="/sync">Публичный журнал</a></div>
      <h3>Последние запуски</h3><div class="tbl"><table><tr><th>Начало</th><th>Окончание</th><th>Тип</th><th>Статус</th><th class="num">Стр. ок / ошибок</th></tr>${o.sync.last_runs.map((r) => `<tr><td class="mono">${esc(fmt(r.started_at))}</td><td class="mono">${esc(fmt(r.finished_at))}</td><td>${r.kind === 'live' ? 'текущие матчи' : 'полный'}</td><td>${esc(r.status)}</td><td class="num">${r.pages_ok} / ${r.pages_failed}</td></tr>`).join('')}</table></div>
      <h3>Последние ошибки</h3>${o.sync.errors.length ? `<div class="tbl"><table><tr><th>Время</th><th>Адрес</th><th>Сообщение</th></tr>${o.sync.errors.map((e) => `<tr><td class="mono">${esc(fmt(e.created_at))}</td><td class="mono" style="font-size:12px;word-break:break-all">${esc(e.url)}</td><td>${esc(e.message)}</td></tr>`).join('')}</table></div>` : emptySm('Ошибок нет.')}`;
    const run = async (kind) => { try { await send('POST', '/admin/sync/run', { kind }); toast(kind === 'live' ? 'Проверка текущих матчей запущена' : 'Полный цикл запущен'); setTimeout(draw, 1200); } catch (e) { toast(e.message, 'err'); } };
    ctx.app.querySelector('#sf').onclick = () => run('full'); ctx.app.querySelector('#sl').onclick = () => run('live');
  };
  ctx.app.innerHTML = skeleton(2); await draw();
  const t = setInterval(() => { if (!document.hidden) draw().catch(() => {}); }, 15000); ctx.cleanup(() => clearInterval(t));
}

function account(ctx) {
  ctx.app.innerHTML = `<h1>Учётная запись</h1><p class="lead">Логин: <b>${esc(me.username)}</b></p>
    <form class="panel form" id="pw" style="max-width:460px"><h3 style="margin:0">Смена пароля</h3>
      <label class="field"><span>Текущий пароль</span><input class="inp" type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span>Новый пароль</span><input class="inp" type="password" name="next" autocomplete="new-password" minlength="10" required><small>Не короче 10 символов, не только цифры.</small></label>
      <label class="field"><span>Повторите новый пароль</span><input class="inp" type="password" name="again" autocomplete="new-password" required></label>
      <button class="btn pri">Сменить пароль</button><p class="note">После смены пароля все другие сессии будут завершены.</p></form>`;
  const f = ctx.app.querySelector('#pw');
  f.onsubmit = async (e) => {
    e.preventDefault(); if (f.elements.next.value !== f.elements.again.value) return toast('Новые пароли не совпадают', 'err');
    try { await send('POST', '/admin/password', { current: f.elements.current.value, next: f.elements.next.value }); f.reset(); toast('Пароль изменён'); } catch (er) { toast(er.message, 'err'); }
  };
}
