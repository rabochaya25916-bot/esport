const cfg = require('../config');
async function fetchText(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': cfg.userAgent, Accept: 'text/html,text/plain' }, signal: ctrl.signal, redirect: 'follow' });
    if (res.status === 403 || res.status === 429) throw new Error(`HTTP ${res.status}: источник ограничил доступ — повторных попыток обхода не делаем`);
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
    const text = await res.text();
    if (/cf-challenge|captcha/i.test(text) && !text.includes('__NUXT__')) throw new Error('Получена страница проверки (CAPTCHA) — запрос прекращён, обход не выполняется');
    return text;
  } finally { clearTimeout(t); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { fetchText, sleep };
