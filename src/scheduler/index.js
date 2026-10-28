const cron = require('node-cron');
const cfg = require('../config');
const { runSync, runLiveSync } = require('../services/sync');

// Два задания: полный цикл (SYNC_CRON) и быстрая проверка текущих матчей (LIVE_SYNC_CRON, можно отключить пустым значением).
// Оба используют одну блокировку: если идёт полный цикл, быстрая проверка пропускается.
function startScheduler(db) {
  if (!cron.validate(cfg.syncCron)) throw new Error('Неверное SYNC_CRON: ' + cfg.syncCron);
  const go = async (why) => { const r = await runSync(db); console.log(`[sync:${why}]`, JSON.stringify(r)); };
  const live = async () => {
    const hasLive = db.prepare("SELECT 1 FROM matches WHERE status='live' LIMIT 1").get();
    const soon = db.prepare("SELECT 1 FROM matches WHERE status='upcoming' AND start_date <= ? LIMIT 1").get(new Date(Date.now() + 15 * 60000).toISOString());
    if (!hasLive && !soon) return; // нечего проверять — не нагружаем источник
    const r = await runLiveSync(db); if (!r.skipped) console.log('[sync:live]', JSON.stringify(r));
  };
  if (cfg.syncOnStart) go('start');
  cron.schedule(cfg.syncCron, () => go('cron'));
  if (cfg.liveSyncCron) {
    if (!cron.validate(cfg.liveSyncCron)) throw new Error('Неверное LIVE_SYNC_CRON: ' + cfg.liveSyncCron);
    cron.schedule(cfg.liveSyncCron, live);
  }
  console.log('Планировщик запущен:', cfg.syncCron, cfg.liveSyncCron ? `· текущие матчи: ${cfg.liveSyncCron}` : '· быстрая проверка выключена');
}
module.exports = { startScheduler };
