// Создание первого администратора из переменных окружения ADMIN_USERNAME и ADMIN_INITIAL_PASSWORD.
// Срабатывает только если в базе ещё нет ни одного администратора. Пароль не логируется и не хранится в открытом виде.
'use strict';
const { hashPassword, passwordProblem } = require('../auth/password');

async function createAdmin(db, username, password) {
  const u = String(username || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,40}$/.test(u)) throw new Error('Логин: 3–40 символов, латиница, цифры, точка, дефис, подчёркивание');
  const prob = passwordProblem(password, u); if (prob) throw new Error(prob);
  const hash = await hashPassword(password); const t = new Date().toISOString();
  const ex = db.prepare('SELECT id FROM admin_users WHERE username=?').get(u);
  if (ex) {
    db.prepare('UPDATE admin_users SET password_hash=?, password_changed_at=? WHERE id=?').run(hash, t, ex.id);
    db.prepare('DELETE FROM admin_sessions WHERE user_id=?').run(ex.id);
    return { id: ex.id, username: u, updated: true };
  }
  const id = db.prepare('INSERT INTO admin_users (username, password_hash, created_at, password_changed_at) VALUES (?,?,?,?)').run(u, hash, t, t).lastInsertRowid;
  return { id: Number(id), username: u, updated: false };
}

async function bootstrapAdminFromEnv(db, env = process.env) {
  if (db.prepare('SELECT 1 FROM admin_users LIMIT 1').get()) return null;
  if (!env.ADMIN_USERNAME || !env.ADMIN_INITIAL_PASSWORD) {
    console.log('Администратор не создан. Выполните: npm run admin:create');
    return null;
  }
  const r = await createAdmin(db, env.ADMIN_USERNAME, env.ADMIN_INITIAL_PASSWORD);
  console.log(`Создан администратор «${r.username}». Удалите ADMIN_INITIAL_PASSWORD из .env и смените пароль в админ-панели.`);
  return r;
}

module.exports = { createAdmin, bootstrapAdminFromEnv };
