// Небольшой кэш ответов API в памяти. Сбрасывается, когда синхронизация записала новые данные
// или администратор изменил публикации, поэтому кэш не задерживает обновления дольше, чем на TTL.
'use strict';
let version = 0;
const store = new Map();
const MAX = 500;

function cached(key, ttlSec, fn) {
  if (!ttlSec) return fn();
  const k = `${version}:${key}`; const hit = store.get(k);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = fn();
  if (store.size >= MAX) store.clear();
  store.set(k, { value, exp: Date.now() + ttlSec * 1000 });
  return value;
}
function bump() { version++; store.clear(); }
const getVersion = () => version;

module.exports = { cached, bump, getVersion };
