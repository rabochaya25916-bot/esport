import { BRAND } from '../brand.js';
// Статьи и гайды: каталог с категориями, тегами, поиском и пагинацией; страница статьи с оглавлением.
// Текст статьи приходит с сервера уже очищенным (безопасный рендер Markdown) — здесь он только вставляется.
import { get, getPage, state, esc, GN, ago, dayLong, setMeta, skeleton, errorBox, empty, emptySm, safeImg } from '../core.js';
import { postCard, newsRow, sec, KIND, pager } from '../ui.js';
import { setQuery } from '../router.js';

const PER = 12;
export async function list(ctx) {
  const q = ctx.query;
  const st = { q: q.get('q') || '', kind: q.get('kind') || '', category: q.get('category') || '', tag: q.get('tag') || '', page: Math.max(1, parseInt(q.get('page'), 10) || 1) };
  setMeta({ title: 'Статьи и гайды', description: 'Авторские статьи, аналитика и гайды по CS2, Dota 2 и League of Legends.' });
  ctx.app.innerHTML = `<div class="page"><h1>Статьи и гайды${state.game !== 'all' ? ' · ' + GN[state.game] : ''}</h1>
    <p class="lead">Собственные материалы ${BRAND.name}: аналитика, обзоры и практические гайды.</p>
    <div class="toolbar"><div class="seg" id="ak">${[['', 'Все'], ['article', 'Статьи'], ['guide', 'Гайды']].map(([k, l]) => `<button type="button" data-k="${k}" class="${k === st.kind ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="inp grow" id="aq" type="search" placeholder="Поиск по статьям" value="${esc(st.q)}" maxlength="80" aria-label="Поиск по статьям">
      <select class="sel" id="ac" aria-label="Категория"><option value="">Все категории</option></select></div>
    <div class="tags" id="at" style="margin:-4px 0 18px"></div>
    <div id="al">${skeleton(6, 'posts')}</div><div id="ap"></div><div id="an"></div></div>`;
  const $ = (s) => ctx.app.querySelector(s);
  Promise.all([get('/post-categories').catch(() => []), get('/post-tags').catch(() => [])]).then(([cats, tags]) => {
    $('#ac').innerHTML = '<option value="">Все категории</option>' + cats.map((c) => `<option value="${esc(c.slug)}" ${c.slug === st.category ? 'selected' : ''}>${esc(c.name)} (${c.posts_count})</option>`).join('');
    $('#at').innerHTML = tags.map((t) => `<button type="button" class="tagl ${t.slug === st.tag ? 'on' : ''}" data-t="${esc(t.slug)}">#${esc(t.name)}</button>`).join('');
    $('#at').querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { st.tag = st.tag === b.dataset.t ? '' : b.dataset.t; $('#at').querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x.dataset.t === st.tag)); st.page = 1; load(); }));
  });
  const load = async () => {
    setQuery({ ...st, page: st.page > 1 ? st.page : '' });
    $('#al').innerHTML = skeleton(6, 'posts');
    const qs = new URLSearchParams({ limit: PER, offset: (st.page - 1) * PER });
    for (const k of ['q', 'kind', 'category', 'tag']) if (st[k]) qs.set(k, st[k]);
    if (state.game !== 'all') qs.set('game', state.game);
    try {
      const { data, total } = await getPage('/posts?' + qs, { signal: ctx.signal });
      const filtered = st.q || st.kind || st.category || st.tag;
      $('#al').innerHTML = data.length ? `<div class="posts">${data.map((p, i) => postCard(p, { wide: i === 0 && st.page === 1 && !filtered })).join('')}</div>`
        : filtered ? empty('Ничего не найдено', 'Попробуйте изменить запрос или снять фильтры.') : empty('Пока нет опубликованных материалов', 'Статьи и гайды появятся здесь после публикации в админ-панели.');
      $('#ap').innerHTML = total > PER ? pager(st.page, Math.ceil(total / PER), total) : '';
      $('#ap').querySelectorAll('[data-page]').forEach((b) => (b.onclick = () => { st.page = Number(b.dataset.page); load(); window.scrollTo(0, 0); }));
    } catch (e) { if (e.name !== 'AbortError') $('#al').innerHTML = errorBox(e); }
  };
  $('#ak').querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; $('#ak').querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b)); st.page = 1; load(); }));
  let tm; $('#aq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load(); }, 300); };
  $('#ac').onchange = (e) => { st.category = e.target.value; st.page = 1; load(); };
  await load();
}

export async function detail(ctx) {
  const slug = ctx.params[0];
  if (!ctx.app.querySelector('.ssr-article')) ctx.app.innerHTML = `<div class="page article">${skeleton(1, 'grid')}<div class="skel line"></div><div class="skel line"></div></div>`;
  const p = await get('/posts/' + slug, { signal: ctx.signal });
  setMeta({ title: p.title, description: p.excerpt || p.title });
  const cover = safeImg(p.cover_url);
  const toc = p.toc && p.toc.length >= 3 ? `<nav class="card toc" aria-label="Содержание"><div class="card-h"><h2>Содержание</h2></div><div class="card-b">${p.toc.map((t) => `<a class="l${t.level}" href="#${esc(t.id)}">${esc(t.text)}</a>`).join('')}</div></nav>` : '';
  ctx.app.innerHTML = `<div class="page"><nav class="crumbs"><a href="/articles">Статьи и гайды</a>${p.category ? `<span><a href="/articles?category=${esc(p.category.slug)}">${esc(p.category.name)}</a></span>` : ''}</nav>
    <div class="${toc ? 'layout' : ''}"><article class="article">
      <header class="article-h"><span class="badge ${p.kind === 'guide' ? 'acc' : ''}">${KIND[p.kind]}</span>${p.game_code ? ` <span class="badge out">${GN[p.game_code]}</span>` : ''}
        <h1 style="margin-top:12px">${esc(p.title)}</h1>${p.excerpt ? `<p class="lead" style="font-size:17px;margin:0">${esc(p.excerpt)}</p>` : ''}
        <div class="meta"><time datetime="${esc(p.published_at)}">${esc(dayLong(p.published_at))}</time><span>· ${p.reading_minutes || 1} мин чтения</span>${p.author ? `<span>· ${esc(p.author)}</span>` : ''}${p.updated_at > p.published_at ? `<span class="dim">· обновлено ${esc(ago(p.updated_at))}</span>` : ''}</div></header>
      ${cover ? `<figure class="article-cover"><img src="${cover}" alt="" referrerpolicy="no-referrer"></figure>` : ''}
      <div class="prose">${p.body_html}</div>
      ${p.tags.length ? `<div class="tags" style="margin-top:28px">${p.tags.map((t) => `<a class="tagl" href="/articles?tag=${esc(t.slug)}">#${esc(t.name)}</a>`).join('')}</div>` : ''}
    </article>${toc ? `<aside class="side">${toc}</aside>` : ''}</div>
    ${sec('Читайте также', p.related.length ? `<div class="posts">${p.related.map((x) => postCard(x)).join('')}</div>` : emptySm('Других материалов пока нет.'), { more: ['/articles', 'Все материалы'] })}</div>`;
}
