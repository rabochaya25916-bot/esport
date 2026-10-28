// Прицелы CS2: разбор кода прицела из игры (CSGO-xxxxx-…), консольные команды и предпросмотр.
// Работает целиком в браузере, без внешних сервисов.
const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
export const COLORS = ['Красный', 'Зелёный', 'Жёлтый', 'Синий', 'Голубой', 'Свой цвет'];
const PRESET_RGB = [[250, 50, 50], [50, 250, 50], [250, 250, 50], [50, 50, 250], [50, 250, 250]];
export const STYLES = { 0: 'По умолчанию', 1: 'По умолчанию (статичный)', 2: 'Классический', 3: 'Классический динамический', 4: 'Классический статичный', 5: 'Классический (CS 1.6)' };

export const DEFAULT = { style: 4, size: 2, thickness: 0.5, gap: -2, outline: true, outlineThickness: 1, color: 1, r: 50, g: 250, b: 50, alpha: 255, alphaEnabled: true, dot: false, tStyle: false, followRecoil: false };

const int8 = (b) => (b > 127 ? b - 256 : b);

// Возвращает объект настроек или бросает ошибку с понятным текстом
export function decode(code) {
  const raw = String(code || '').trim();
  if (!/^CSGO(-[A-Za-z0-9]{5}){5}$/.test(raw)) throw new Error('Код должен выглядеть так: CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx');
  const chars = raw.slice(5).replace(/-/g, '').split('').reverse();
  let big = 0n;
  for (const c of chars) { const i = DICT.indexOf(c); if (i < 0) throw new Error(`Недопустимый символ «${c}» в коде`); big = big * 57n + BigInt(i); }
  const bytes = []; for (let i = 0; i < 18; i++) { bytes.unshift(Number(big & 255n)); big >>= 8n; }
  const sum = bytes.slice(1).reduce((s, x) => s + x, 0) % 256;
  if (sum !== bytes[0]) throw new Error('Код повреждён: не совпадает контрольная сумма. Скопируйте его из игры ещё раз.');
  const flags = bytes[13] >> 4;
  return {
    gap: int8(bytes[2]) / 10,
    outlineThickness: bytes[3] / 2,
    r: bytes[4], g: bytes[5], b: bytes[6], alpha: bytes[7],
    followRecoil: (bytes[8] & 0x80) === 0x80,
    color: bytes[10] & 7,
    outline: (bytes[10] & 8) === 8,
    thickness: bytes[12] / 10,
    dot: (flags & 1) === 1,
    alphaEnabled: (flags & 4) === 4,
    tStyle: (flags & 8) === 8,
    style: (bytes[13] & 0xf) >> 1,
    size: (((bytes[15] & 0x1f) << 8) | bytes[14]) / 10,
  };
}

const r1 = (v) => Math.round(v * 10) / 10;
export function commands(x) {
  return [
    `cl_crosshairstyle ${x.style}`, `cl_crosshairsize ${r1(x.size)}`, `cl_crosshairthickness ${r1(x.thickness)}`, `cl_crosshairgap ${r1(x.gap)}`,
    `cl_crosshair_drawoutline ${x.outline ? 1 : 0}`, `cl_crosshair_outlinethickness ${r1(x.outlineThickness)}`,
    `cl_crosshaircolor ${x.color}`, ...(x.color === 5 ? [`cl_crosshaircolor_r ${x.r}`, `cl_crosshaircolor_g ${x.g}`, `cl_crosshaircolor_b ${x.b}`] : []),
    `cl_crosshairusealpha ${x.alphaEnabled ? 1 : 0}`, `cl_crosshairalpha ${x.alpha}`, `cl_crosshairdot ${x.dot ? 1 : 0}`,
    `cl_crosshair_t ${x.tStyle ? 1 : 0}`, `cl_crosshair_recoil ${x.followRecoil ? 1 : 0}`,
  ].join('; ');
}

// SVG-предпросмотр. Пропорции приближены к разрешению 1920×1080; итоговый вид в игре может немного отличаться.
export function svg(x, { px = 200 } = {}) {
  const [cr, cg, cb] = x.color === 5 ? [x.r, x.g, x.b] : PRESET_RGB[x.color] || PRESET_RGB[1];
  const a = x.alphaEnabled ? Math.max(0, Math.min(255, x.alpha)) / 255 : 1;
  const k = 2;                                   // экранных пикселей на единицу размера
  const len = Math.max(0, x.size * k * 1.6);
  const th = Math.max(1, Math.round(x.thickness * k));
  const gap = Math.max(0, 4 + x.gap * 1.0);
  const c = px / 2; const o = x.outline ? Math.max(0.5, x.outlineThickness) : 0;
  const rects = [];
  if (len > 0) {
    rects.push([c - th / 2, c - gap - len, th, len]);                 // верх
    rects.push([c - th / 2, c + gap, th, len]);                       // низ
    rects.push([c - gap - len, c - th / 2, len, th]);                 // лево
    rects.push([c + gap, c - th / 2, len, th]);                       // право
    if (x.tStyle) rects.shift();
  }
  if (x.dot) rects.push([c - th / 2, c - th / 2, th, th]);
  const fill = `rgba(${cr},${cg},${cb},${a.toFixed(3)})`;
  const body = rects.map(([rx, ry, w, h]) => `${o ? `<rect x="${rx - o}" y="${ry - o}" width="${w + 2 * o}" height="${h + 2 * o}" fill="rgba(0,0,0,${a.toFixed(3)})"/>` : ''}<rect x="${rx}" y="${ry}" width="${w}" height="${h}" fill="${fill}"/>`).join('');
  return `<svg class="xh-svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="Предпросмотр прицела">${body}</svg>`;
}
