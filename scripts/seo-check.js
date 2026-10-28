// Проверка SEO предсгенерированных страниц: одинаковые title, пустые description, некорректные названия,
// одинаковые canonical, индексируемые страницы без H1. Использование: node scripts/seo-check.js [_site/seo-report.json] [--no-fail]
'use strict';
const fs = require('fs');
const path = require('path');

(async () => {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(__dirname, '..', '_site', 'seo-report.json');
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets/js/seo-templates.js'), 'utf8');
  const { auditPages } = await import('data:text/javascript,' + encodeURIComponent(src));
  const pages = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { errors, warnings } = auditPages(pages);
  const noindex = pages.filter((p) => /noindex/.test(p.robots)).length;
  console.log(`SEO: страниц ${pages.length}, закрыто от индексации (мало содержимого/TBD) ${noindex}`);
  warnings.slice(0, 30).forEach((w) => console.log('  предупреждение:', w));
  errors.slice(0, 50).forEach((e) => console.log('  ОШИБКА:', e));
  if (errors.length && !process.argv.includes('--no-fail')) process.exit(1);
})();
