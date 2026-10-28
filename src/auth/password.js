// Хеширование паролей администратора: scrypt (встроен в Node.js), соль 16 байт, ключ 64 байта.
// Формат: scrypt$N$r$p$<salt base64>$<hash base64>. Пароли в открытом виде нигде не сохраняются.
'use strict';
const crypto = require('crypto');

const PARAMS = { N: 32768, r: 8, p: 1 };
const KEYLEN = 64;
const maxmem = (N, r) => 256 * N * r; // запас над 128*N*r

function scrypt(password, salt, { N, r, p }) {
  return new Promise((resolve, reject) => crypto.scrypt(String(password).normalize('NFKC'), salt, KEYLEN, { N, r, p, maxmem: maxmem(N, r) },
    (err, key) => (err ? reject(err) : resolve(key))));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p) });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Требования к паролю: не короче 10 символов, не только цифры, не совпадает с логином
function passwordProblem(password, username = '') {
  const s = String(password || '');
  if (s.length < 10) return 'Пароль должен быть не короче 10 символов';
  if (s.length > 200) return 'Пароль слишком длинный';
  if (/^\d+$/.test(s)) return 'Пароль не может состоять только из цифр';
  if (username && s.toLowerCase() === String(username).toLowerCase()) return 'Пароль не должен совпадать с логином';
  return null;
}

// Фиктивный хеш для выравнивания времени ответа, когда логин не найден
let dummy = null;
async function dummyVerify(password) { dummy = dummy || await hashPassword(crypto.randomBytes(12).toString('hex')); await verifyPassword(password, dummy); return false; }

module.exports = { hashPassword, verifyPassword, passwordProblem, dummyVerify };
