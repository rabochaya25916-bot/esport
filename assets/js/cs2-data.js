// Данные разделов «Конфиги» и «Прицелы» CS2. Файлы создают независимые парсеры (scripts/update-cs2-content.js):
//   data/cs2/configs.json            — список конфигов (без тяжёлых настроек)
//   data/cs2/configs/<steamid>.json  — полный конфиг одного игрока (загружается только на его странице)
//   data/cs2/crosshairs.json         — прицелы
// Каждый файл загружается один раз за визит и только когда открыт соответствующий раздел.
import { BASE } from './core.js';

const cache = new Map();
function load(rel) {
  if (!cache.has(rel)) cache.set(rel, fetch(BASE + 'assets/js/data/cs2/' + rel, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { if (!j) cache.delete(rel); return j; }));
  return cache.get(rel);
}
export const configsList = async () => (await load('configs.json')) || { items: [] };
export const crosshairsList = async () => {
  const d = (await load('crosshairs.json')) || { items: [] };
  const m = d.xh_sheet;
  if (m && !d._sheets) { d._sheets = 1; for (const c of d.items) if (c.xh) c.sprite = { url: `${m.base}${c.xh[0]}.png?v=${m.ver}`, x: (c.xh[1] % m.cols) * m.size, y: Math.floor(c.xh[1] / m.cols) * m.size, size: m.size, cols: m.cols }; }
  return d;
};
export const configDetail = (id) => (/^\d{5,20}$/.test(String(id)) ? load(`configs/${id}.json`) : Promise.resolve(null));

export const nickKey = (n) => String(n || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export async function configByNick(nick) { const d = await configsList(); const k = nickKey(nick); return d.items.find((c) => c.key === k) || null; }
export async function crosshairByNick(nick) { const d = await crosshairsList(); const k = nickKey(nick); return d.items.find((c) => c.key === k) || null; }

// Параметры прицела из консольных переменных конфига → формат предпросмотра crosshair.js.
// Отсутствующие в конфиге значения не подставляются молча: возвращается список недостающих.
export function crosshairFromCvars(cv, DEFAULT) {
  if (!cv || !Object.keys(cv).length) return null;
  const n = (k) => (cv[k] === undefined || cv[k] === '' ? undefined : Number(cv[k]));
  const map = { style: 'cl_crosshairstyle', size: 'cl_crosshairsize', thickness: 'cl_crosshairthickness', gap: 'cl_crosshairgap', outline: 'cl_crosshair_drawoutline',
    outlineThickness: 'cl_crosshair_outlinethickness', color: 'cl_crosshaircolor', r: 'cl_crosshaircolor_r', g: 'cl_crosshaircolor_g', b: 'cl_crosshaircolor_b',
    alpha: 'cl_crosshairalpha', alphaEnabled: 'cl_crosshairusealpha', dot: 'cl_crosshairdot', tStyle: 'cl_crosshair_t' };
  const x = { ...DEFAULT }; const missing = [];
  for (const [k, v] of Object.entries(map)) {
    const val = n(v);
    if (val === undefined) { missing.push(v); continue; }
    x[k] = ['outline', 'alphaEnabled', 'dot', 'tStyle'].includes(k) ? !!val : val;
  }
  // В CS2 цвет задаётся RGB, если cl_crosshaircolor не указан, но есть компоненты
  if (n('cl_crosshaircolor') === undefined && n('cl_crosshaircolor_r') !== undefined) x.color = 5;
  return { x, missing };
}
export const cvarsToConsole = (obj) => Object.entries(obj || {}).filter(([, v]) => v !== '' && v != null && typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join('; ');
