// Трансляции CyberLeague: список Twitch-каналов (data/streams-config.json) и официальный плеер Twitch Embed.
// Показываются только каналы в эфире (статус — напрямую от Twitch, без ключей). Нет эфиров — нет плеера.
import { esc, BASE } from './core.js';
import { normalizeChannels, rankChannels, linkedLogins } from './streams-rank.js';

let cfgP = null;
export function streamConfig() {
  if (!cfgP) cfgP = fetch(BASE + 'assets/js/data/streams-config.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { channels: [], links: [] })).catch(() => { cfgP = null; return { channels: [], links: [] }; });
  return cfgP;
}

// Twitch Embed требует HTTPS и parent = домен страницы. На http (кроме localhost) встраивание невозможно — только ссылка.
const canEmbed = () => location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const twitchUrl = (login) => 'https://www.twitch.tv/' + encodeURIComponent(login);
const nameOf = (ch) => ch.title || ch.login;

// Онлайн-статус: один прямой запрос к публичному GraphQL самого Twitch (тот же, что использует twitch.tv).
// Без своих ключей, без сервера и посредников. Ответ кэшируется на 60 с.
const GQL = 'https://gql.twitch.tv/gql';
const WEB_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // публичный идентификатор веб-клиента twitch.tv, не секрет
let liveP = null, liveAt = 0;
export function liveStatus(logins) {
  if (liveP && Date.now() - liveAt < 60000) return liveP;
  liveAt = Date.now();
  const q = `{users(logins:${JSON.stringify(logins)}){login stream{viewersCount title game{name}}}}`;
  liveP = fetch(GQL, { method: 'POST', headers: { 'Client-Id': WEB_CLIENT, 'Content-Type': 'text/plain' }, body: JSON.stringify({ query: q }) })
    .then((r) => r.json()).then((j) => {
      const m = new Map();
      for (const u of (j && j.data && j.data.users) || []) if (u && u.stream) m.set(u.login.toLowerCase(), u.stream);
      return m;
    }).catch(() => { liveP = null; return null; });
  return liveP;
}

const fmtV = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(n || 0));

function item(ch, st, linked) {
  return `<button type="button" class="src-tab" data-login="${esc(ch.login)}" role="tab" aria-selected="false">
    <span class="src-top"><i class="live-dot"></i><b>${esc(nameOf(ch))}</b>${ch.lang ? `<span class="lang">${esc(ch.lang.toUpperCase())}</span>` : ''}<span class="vw mono">${fmtV(st.viewersCount)}</span></span>
    <span class="src-bot"><small class="dim ell">${linked ? 'официальный · ' : ''}${esc(st.title || (st.game && st.game.name) || '')}</small></span></button>`;
}

// Плеер Twitch без родных кнопок (controls:false — Twitch не показывает шапку канала, «Отслеживать», «Клип»).
// Под видео своя панель: пауза, звук и громкость, качество, полный экран.
const IC = {
  play: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4V9Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-8.7v2.1a7 7 0 0 1 0 13.2v2.1a9 9 0 0 0 0-17.4Z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4V9Zm12.6.2 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1Z"/></svg>',
  fs: '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"/></svg>',
  fsx: '<svg viewBox="0 0 24 24"><path d="M8 4h2v6H4V8h4V4Zm6 0h2v4h4v2h-6V4ZM4 14h6v6H8v-4H4v-2Zm10 0h6v2h-4v4h-2v-6Z"/></svg>',
};
let twLib = null;
const loadTwitch = () => twLib || (twLib = new Promise((res, rej) => {
  if (window.Twitch && window.Twitch.Player) return res(window.Twitch);
  const sc = document.createElement('script'); sc.src = 'https://player.twitch.tv/js/embed/v1.js';
  sc.onload = () => res(window.Twitch); sc.onerror = () => { twLib = null; rej(new Error('twitch')); };
  document.head.appendChild(sc);
}));

function playerHtml(ch, st) {
  const url = twitchUrl(ch.login);
  if (!canEmbed()) return `<div class="state sm">Встроенный плеер Twitch работает только на сайте с HTTPS. <a href="${esc(url)}" target="_blank" rel="noopener nofollow">Смотреть на Twitch ↗</a></div>`;
  return `<div class="player-box"><div class="player"><div class="tw-slot"></div></div>
    <div class="plr-bar" aria-label="Управление трансляцией">
      <button type="button" class="pb" data-plr="play" title="Пауза" aria-label="Пауза">${IC.pause}</button>
      <button type="button" class="pb" data-plr="mute" title="Включить звук" aria-label="Включить звук">${IC.mute}</button>
      <input type="range" class="pvol" data-plr="vol" min="0" max="100" value="0" aria-label="Громкость">
      <span class="plive"><i class="live-dot"></i>В эфире</span>
      <select class="pq" data-plr="q" aria-label="Качество видео" title="Качество видео" hidden></select>
      <button type="button" class="pb" data-plr="fs" title="Полный экран" aria-label="Полный экран">${IC.fs}</button>
    </div></div>
    <div class="player-cap"><div class="min0"><b>${esc(nameOf(ch))}</b>${st && st.title ? `<small class="dim ell">${esc(st.title)}</small>` : ''}</div></div>`;
}

// Подключает Twitch.Player к разметке playerHtml и оживляет панель. Возвращает функцию остановки.
function mountPlayer(root, login) {
  const pbox = root.querySelector('.player-box'); if (!pbox) return () => {};
  const $ = (k) => pbox.querySelector(`[data-plr="${k}"]`);
  const bPlay = $('play'), bMute = $('mute'), vol = $('vol'), q = $('q'), bFs = $('fs');
  let tw = null, dead = false, qSig = '', idle = 0;
  const set = (b, ic, t) => { b.innerHTML = ic; b.title = t; b.setAttribute('aria-label', t); };
  const sync = () => {
    if (!tw) return;
    try {
      const paused = tw.isPaused(); set(bPlay, paused ? IC.play : IC.pause, paused ? 'Смотреть' : 'Пауза');
      const muted = tw.getMuted() || tw.getVolume() === 0; set(bMute, muted ? IC.mute : IC.vol, muted ? 'Включить звук' : 'Выключить звук');
      if (document.activeElement !== vol) vol.value = muted ? 0 : Math.round(tw.getVolume() * 100);
      const list = (tw.getQualities() || []).map((o) => (typeof o === 'string' ? { v: o, n: o } : { v: o.group, n: o.name })).filter((o) => o.v);
      const sig = list.map((o) => o.v).join('|');
      if (sig && sig !== qSig) { qSig = sig; q.innerHTML = list.map((o) => `<option value="${esc(o.v)}">${o.v === 'auto' ? 'Авто' : esc(o.n || o.v)}</option>`).join(''); }
      q.hidden = !sig; const cur = tw.getQuality(); if (cur && document.activeElement !== q) q.value = cur;
    } catch { /* плеер ещё загружается */ }
  };
  loadTwitch().then((T) => {
    if (dead) return;
    tw = new T.Player(pbox.querySelector('.tw-slot'), { channel: login, parent: [location.hostname], width: '100%', height: '100%', autoplay: true, muted: true, controls: false });
    [T.Player.READY, T.Player.PLAY, T.Player.PAUSE, T.Player.PLAYING].forEach((ev) => tw.addEventListener(ev, sync));
  }).catch(() => { pbox.querySelector('.tw-slot').innerHTML = `<div class="state sm">Плеер Twitch не загрузился. <a href="${esc(twitchUrl(login))}" target="_blank" rel="noopener nofollow">Смотреть на Twitch ↗</a></div>`; });
  const timer = setInterval(sync, 1000);
  bPlay.onclick = () => { if (!tw) return; try { if (tw.isPaused()) tw.play(); else tw.pause(); } catch {} setTimeout(sync, 150); };
  bMute.onclick = () => { if (!tw) return; try { const m = tw.getMuted() || tw.getVolume() === 0; if (m) { if (tw.getVolume() === 0) tw.setVolume(0.8); tw.setMuted(false); } else tw.setMuted(true); } catch {} setTimeout(sync, 100); };
  vol.oninput = () => { if (!tw) return; const v = vol.value / 100; try { tw.setVolume(v); tw.setMuted(v === 0); } catch {} sync(); };
  q.onchange = () => { try { tw && tw.setQuality(q.value); } catch {} };
  const isFs = () => document.fullscreenElement === pbox || document.webkitFullscreenElement === pbox;
  bFs.onclick = () => {
    if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch?.(() => {});
    else { const r = pbox.requestFullscreen || pbox.webkitRequestFullscreen; if (r) { const p = r.call(pbox); if (p && p.catch) p.catch(() => {}); } }
  };
  const wake = () => { pbox.classList.remove('idle'); clearTimeout(idle); if (isFs()) idle = setTimeout(() => pbox.classList.add('idle'), 2500); };
  const onFs = () => { const f = isFs(); set(bFs, f ? IC.fsx : IC.fs, f ? 'Обычный размер' : 'Полный экран'); wake(); };
  ['mousemove', 'pointerdown', 'touchstart', 'keydown'].forEach((e) => pbox.addEventListener(e, wake, { passive: true }));
  document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
  return () => { dead = true; try { tw && tw.pause(); } catch {} const ifr = pbox.querySelector('iframe'); if (ifr) { ifr.src = 'about:blank'; ifr.remove(); } clearInterval(timer); clearTimeout(idle); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); tw = null; };
}

// Плеер + меню каналов, которые СЕЙЧАС в эфире. Если в эфире никого нет — блок (вместе с секцией) скрывается.
export function mountStreams(box, target = {}, { signal } = {}) {
  const wrap = box.closest('#streams-sec') || box;
  const hide = () => { box.innerHTML = ''; wrap.hidden = true; };
  // Трансляции CS2 — только в разделе Counter-Strike 2 (проверка по типу игры, а не CSS)
  if (target.game !== 'cs2') { hide(); wrap.remove(); return; }
  box.innerHTML = '<div class="state sm">Проверяем эфиры…</div>';
  streamConfig().then(async (cfg) => {
    const chans = rankChannels(normalizeChannels(cfg));
    if (!chans.length) return hide();
    const live = await liveStatus(chans.map((c) => c.login));
    if ((signal && signal.aborted) || !box.isConnected) return;
    if (!live || !live.size) return hide();
    const linked = linkedLogins(cfg, target);
    const on = chans.filter((c) => live.has(c.login.toLowerCase()));
    if (!on.length) return hide();
    const ordered = [...on].sort((a, b) => Number(linked.has(b.login)) - Number(linked.has(a.login)) || chans.indexOf(a) - chans.indexOf(b));
    wrap.hidden = false;
    box.innerHTML = `<div class="streams live-grid">
      <div class="src-player"></div>
      <div class="src-tabs" role="tablist" aria-label="Каналы в эфире">${ordered.map((ch) => item(ch, live.get(ch.login.toLowerCase()), linked.has(ch.login))).join('')}</div></div>`;
    let selected = null, stop = null;
    if (signal) signal.addEventListener('abort', () => { if (stop) stop(); stop = null; box.innerHTML = ''; }, { once: true });
    const pick = (login) => {
      if (login === selected) return; selected = login;
      const ch = ordered.find((x) => x.login === login); if (!ch) return;
      box.querySelectorAll('.src-tab').forEach((t) => { const a = t.dataset.login === login; t.classList.toggle('on', a); t.setAttribute('aria-selected', a); });
      if (stop) stop();
      const slot = box.querySelector('.src-player');
      slot.innerHTML = playerHtml(ch, live.get(ch.login.toLowerCase())); // старый плеер удаляется
      stop = mountPlayer(slot, ch.login);
    };
    box.querySelector('.src-tabs').onclick = (e) => { const b = e.target.closest('[data-login]'); if (b) pick(b.dataset.login); };
    pick(ordered[0].login);

  });
}

// Для главной: карточка-ссылка на канал (без плеера и без статуса эфира)
export const streamLink = (ch) => `<a class="stream" href="${esc(twitchUrl(ch.login))}" target="_blank" rel="noopener nofollow"><span class="pf twitch">Twitch</span><b>${esc(nameOf(ch))}</b>${ch.lang ? `<small class="mono">${esc(ch.lang.toUpperCase())}</small>` : ''}<span class="go">↗</span></a>`;

export { normalizeChannels, rankChannels };
