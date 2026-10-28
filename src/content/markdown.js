// Безопасный рендер Markdown для статей и гайдов.
// Принцип: сначала ВЕСЬ текст экранируется, затем к экранированному тексту применяется ограниченный набор
// разметки. Сырой HTML автора не попадает в страницу никогда — теги показываются как текст.
// Ссылки и картинки проходят белый список схем (http/https/mailto/относительные), атрибуты всегда в кавычках.
'use strict';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const unesc = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));

// Управляющие символы (кроме \n и \t) удаляются: они не нужны в тексте и используются как маркеры
const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g, '');

function safeUrl(raw, { image = false } = {}) {
  const u = unesc(String(raw || '')).trim().replace(/[\s\u0000-\u001F]/g, '');
  if (!u || u.length > 2000) return null;
  if (/^https?:\/\/[^\s/]+/i.test(u)) return u;
  if (image) return /^\/uploads\/[A-Za-z0-9._-]+$/.test(u) ? u : null;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(u)) return u;
  if (/^\/(?!\/)[^\s]*$/.test(u)) return u;         // относительная ссылка на этот сайт (не //host)
  if (/^#[\w-]*$/.test(u)) return u;
  return null;                                     // javascript:, data:, vbscript: и всё прочее
}

const slugify = (s) => String(s).toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'section';

// --- строчная разметка (вход — уже экранированный текст) ---
function inline(text) {
  const keep = []; const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  let s = text;
  s = s.replace(/`([^`\n]+)`/g, (m, c) => hold(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+&quot;([^\n]*?)&quot;)?\)/g, (m, alt, url, title) => {
    const u = safeUrl(url, { image: true }); if (!u) return hold(`<span class="md-bad">[изображение отклонено]</span>`);
    return hold(`<img src="${esc(u)}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy" referrerpolicy="no-referrer">`);
  });
  s = s.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, label, url) => {
    const u = safeUrl(url); if (!u) return label;
    const ext = /^https?:/i.test(u);
    return hold(`<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>`) + label + hold('</a>');
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, pre, url) => {
    const u = safeUrl(url); return u ? pre + hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u)}</a>`) : m;
  });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>').replace(/==([^=\n]+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[Number(i)]);
}

const CALLOUT = { NOTE: ['note', 'Заметка'], TIP: ['tip', 'Совет'], WARNING: ['warning', 'Внимание'], IMPORTANT: ['important', 'Важно'] };

function blocks(lines, ctx) {
  const out = []; let i = 0;
  const isBlank = (l) => !l.trim();
  const startsBlock = (l, next) => /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || /^\s*([-*+]|\d+[.)])\s+/.test(l)
    || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l) || (/\|/.test(l) && next && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(next));
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    // ``` код
    let m = line.match(/^```\s*([A-Za-z0-9_+-]{0,20})\s*$/);
    if (m) {
      const buf = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${m[1] ? ` class="lang-${esc(m[1].toLowerCase())}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // Заголовки: # и ## → h2, ### → h3, #### и ниже → h4 (h1 — заголовок статьи)
    m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      const lvl = Math.min(Math.max(m[1].length, 2), 4); const html = inline(esc(m[2]));
      let id = slugify(m[2]); let k = 2; while (ctx.ids.has(id)) id = `${slugify(m[2])}-${k++}`; ctx.ids.add(id);
      if (lvl <= 3) ctx.toc.push({ level: lvl, id, text: m[2].replace(/[*_`~=]/g, '').slice(0, 120) });
      out.push(`<h${lvl} id="${esc(id)}">${html}</h${lvl}>`); i++; continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // Цитаты и выноски > [!TIP]
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      const c = buf[0] && buf[0].match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*$/i);
      if (c && ctx.depth < 3) {
        const [cls, label] = CALLOUT[c[1].toUpperCase()];
        out.push(`<aside class="callout callout-${cls}"><b class="callout-t">${label}</b>${blocks(buf.slice(1), { ...ctx, depth: ctx.depth + 1 })}</aside>`);
      } else out.push(`<blockquote>${ctx.depth < 3 ? blocks(buf, { ...ctx, depth: ctx.depth + 1 }) : `<p>${inline(esc(buf.join('\n')))}</p>`}</blockquote>`);
      continue;
    }
    // Списки (один уровень; строка с отступом продолжает пункт)
    m = line.match(/^\s*([-*+]|\d+[.)])\s+/);
    if (m) {
      const ordered = /\d/.test(m[1]); const items = [];
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length) {
        const mm = lines[i].match(re);
        if (mm) { items.push(mm[1]); i++; continue; }
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += '\n' + lines[i].trim(); i++; continue; }
        break;
      }
      const li = items.map((t) => { const cb = t.match(/^\[( |x)\]\s+(.*)$/is); return cb ? `<li class="task${cb[1] !== ' ' ? ' done' : ''}">${inline(esc(cb[2]))}</li>` : `<li>${inline(esc(t))}</li>`; });
      const start = ordered ? parseInt(m[1], 10) : 1;
      out.push(ordered ? `<ol${start > 1 && start < 10000 ? ` start="${start}"` : ''}>${li.join('')}</ol>` : `<ul>${li.join('')}</ul>`);
      continue;
    }
    // Таблицы
    if (/\|/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
      const head = cells(line); const al = cells(lines[i + 1]).map((x) => (/^:-+:$/.test(x) ? 'center' : /-+:$/.test(x) ? 'right' : ''));
      i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && !isBlank(lines[i])) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => `<${tag}${al[k] ? ` class="al-${al[k]}"` : ''}>${inline(esc(c))}</${tag}>`;
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.slice(0, 500).map((r) => `<tr>${head.map((_, k) => td('td', r[k] || '', k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    // Абзац; картинка на отдельной строке — фигура с подписью
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !(buf.length && startsBlock(lines[i], lines[i + 1]))) buf.push(lines[i++]);
    const one = buf.length === 1 && buf[0].trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (one) {
      const img = inline(esc(buf[0].trim()));
      out.push(`<figure>${img}${one[3] || one[1] ? `<figcaption>${esc(one[3] || one[1])}</figcaption>` : ''}</figure>`);
    } else out.push(`<p>${inline(esc(buf.join('\n')))}</p>`);
  }
  return out.join('\n');
}

function renderMarkdown(md) {
  const ctx = { toc: [], ids: new Set(), depth: 0 };
  const html = blocks(clean(md).split('\n'), ctx);
  return { html, toc: ctx.toc };
}

// Простой текст без разметки — для анонсов, поиска и оценки времени чтения
function plainText(md) {
  return clean(md).replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/^\s*>\s?(\[![A-Z]+\])?/gm, '').replace(/[*_~`=|#>-]{1,}/g, ' ').replace(/\s+/g, ' ').trim();
}
const readingMinutes = (md) => Math.max(1, Math.round(plainText(md).split(' ').filter(Boolean).length / 200));

module.exports = { renderMarkdown, plainText, readingMinutes, safeUrl, esc, slugify };
