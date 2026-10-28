// Мини-замена express.Router для браузера: только GET-маршруты и r.use(fallback).
'use strict';
function Router() {
  const routes = []; let fallback = null;
  const toRe = (p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/:(\w+)/g, '/(?<$1>[^/]+)') + '/?$');
  const r = {
    get(p, ...h) { routes.push({ re: toRe(p), h: h[h.length - 1] }); return r; },
    post() { return r; }, put() { return r; }, delete() { return r; }, patch() { return r; },
    use(fn) { if (typeof fn === 'function' && fn.length <= 3) fallback = fn; return r; },
    dispatch(pathname, query) {
      const out = { status: 200, headers: {}, body: null };
      const res = { status(c) { out.status = c; return res; }, set(k, v) { out.headers[k.toLowerCase()] = v; return res; }, json(b) { out.body = b; return res; } };
      for (const rt of routes) {
        const m = pathname.match(rt.re);
        if (m) { rt.h({ params: { ...(m.groups || {}) }, query, headers: {} }, res, () => {}); return out; }
      }
      if (fallback) fallback({ params: {}, query }, res, () => {}); else res.status(404).json({ error: 'Не найдено' });
      return out;
    },
  };
  return r;
}
module.exports = { Router };
module.exports.Router = Router;
