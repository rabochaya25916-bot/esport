// CLI: создание администратора или смена его пароля.
//   npm run admin:create                 — спросит логин и пароль (пароль не отображается при вводе)
//   npm run admin:create -- --username editor
// Пароль можно передать через переменную окружения ADMIN_PASSWORD (например, в CI), но не аргументом командной строки.
'use strict';
const readline = require('readline');
const cfg = require('../config');
const { openDb } = require('../database/db');
const { createAdmin } = require('./bootstrap');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write(s.replace(/[^\r\n]/g, '*')); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const i = process.argv.indexOf('--username');
  const username = i > 0 ? process.argv[i + 1] : await ask('Логин администратора: ');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await ask('Пароль (не короче 10 символов): ', { hidden: true });
    const again = await ask('Повторите пароль: ', { hidden: true });
    if (password !== again) { console.error('Пароли не совпадают'); process.exit(1); }
  }
  const db = openDb(cfg.dbPath);
  try {
    const r = await createAdmin(db, username, password);
    console.log(r.updated ? `Пароль администратора «${r.username}» изменён, все его сессии завершены.` : `Администратор «${r.username}» создан. Вход: /admin`);
  } catch (e) { console.error('Ошибка:', e.message); process.exit(1); }
})();
