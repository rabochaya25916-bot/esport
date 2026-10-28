// Настройки для браузерной версии API (без process.env). Расписание — как в .github/workflows/update-site.yml.
'use strict';
module.exports = {
  syncCron: 'GitHub Actions, примерно каждые 15 мин',
  liveSyncCron: null,
  staleAfterMin: 60,
  pollSec: 120,
  pollLiveSec: 120,
  apiCacheSec: 0,
  siteName: 'CyberLeague',
  siteUrl: '',
};
