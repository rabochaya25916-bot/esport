// Общие утилиты парсеров CS2-контента: загрузка с повторами, паузы, атомарная запись, нормализация ников.
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (compatible; CyberLeagueBot/1.0; +https://github.com/) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch с таймаутом и повторами. 429/5xx — пауза (учитывает Retry-After) и повтор; 4xx (кроме 429) — сразу ошибка.
async function fetchRetry(url, opts = {}, { retries = 4, timeout = 25000, label = url } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'ru,en;q=0.8', ...(opts.headers || {}) }, signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return r;
      last = new Error(`${label}: HTTP ${r.status}`); last.status = r.status;
      if (r.status !== 429 && r.status < 500) throw last;
      const ra = Number(r.headers.get('retry-after')) || 0;
      await sleep(Math.max(ra * 1000, 3000 * 2 ** i));
    } catch (e) {
      clearTimeout(t);
      if (e.status && e.status !== 429 && e.status < 500) throw e;
      last = e; await sleep(2000 * 2 ** i);
    }
  }
  throw last;
}

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file);
}
// Устойчивый ключ игрока по нику: регистр, пробелы и служебные символы не создают дублей ("taki-" и "taki" — разные ники, поэтому дефис сохраняется)
const nickKey = (n) => String(n || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
// Адрес страницы: латиница/цифры/._- ; остальное кодируется
const slugify = (n) => encodeURIComponent(nickKey(n).replace(/\s+/g, '-'));

module.exports = { UA, sleep, fetchRetry, readJson, writeJsonAtomic, nickKey, slugify };
