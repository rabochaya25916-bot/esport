// Периодический опрос API (polling). Это НЕ режим реального времени: сервер сам опрашивает по расписанию,
// а браузер раз в N секунд забирает из базы сайта то, что уже сохранено.
// Опрос чаще, когда на странице есть текущие матчи; приостанавливается во вкладке в фоне.
import { prefs, state } from './core.js';

export function pollInterval(live) {
  const c = (state.freshness && state.freshness.client) || { poll_sec: 60, poll_live_sec: 30 };
  const base = prefs.pollSec > 0 ? prefs.pollSec : c.poll_sec;
  return Math.max(15, live ? Math.min(base, c.poll_live_sec) : base) * 1000;
}

export function poller(fn, { live = () => false, signal } = {}) {
  let timer = null; let last = Date.now(); let busy = false;
  const plan = () => { clearTimeout(timer); if (!prefs.autoRefresh || (signal && signal.aborted)) return; timer = setTimeout(tick, pollInterval(live())); };
  const tick = async () => {
    if (document.hidden) return plan();
    if (busy) return plan();
    busy = true;
    try { await fn(); last = Date.now(); } catch (e) { if (e.name !== 'AbortError') console.warn('Обновление не удалось:', e.message); }
    finally { busy = false; plan(); }
  };
  const onVis = () => { if (!document.hidden && Date.now() - last > pollInterval(live())) tick(); };
  document.addEventListener('visibilitychange', onVis);
  plan();
  const stop = () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  if (signal) signal.addEventListener('abort', stop);
  return { stop, now: tick };
}
