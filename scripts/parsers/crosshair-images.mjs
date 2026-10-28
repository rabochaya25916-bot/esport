// Рендер картинок прицелов в PNG (assets/img/xh/<slug>.png) — локально, без внешних запросов.
// Запуск: node scripts/parsers/crosshair-images.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectShareCode, decodeModernShareCode, drawPixelCrosshair, migrateLegacyCrosshairV1, encodeCS32ShareCode } from './vendor/xh-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'assets/js/data/cs2/crosshairs.json');
const OUT = path.join(ROOT, 'assets/img/xh');
const SIZE = 100;

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
export function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function fakeCanvas(w, h) {
  let out = null;
  const ctx = { createImageData: (W, H) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) }), putImageData: (img) => { out = img.data; },
    save() {}, restore() {}, setTransform() {}, clearRect() {} };
  const dataset = new Proxy({}, { set: (t, k, v) => { if (k !== 'crosshairBackground') t[k] = v; return true; } });
  return { width: w, height: h, style: {}, dataset, getContext: () => ctx, removeAttribute() {}, get pixels() { return out; } };
}
const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
const i8 = (n) => (n << 24) >> 24;
function legacyV1(code) {
  let big = 0n; for (const ch of Array.from(code.replace(/CSGO|-/g, '')).reverse()) big = big * 57n + BigInt(DICT.indexOf(ch));
  const hex = big.toString(16).padStart(36, '0'); const b = []; for (let i = 0; i < 36; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
  return { gap: i8(b[2]) / 10, outline: b[3] / 2, color_r: b[4], color_g: b[5], color_b: b[6], alpha: b[7], splitDistance: b[8] & 7, recoil: (b[8] & 0x80) === 0x80,
    fixedCrosshairGap: i8(b[9]) / 10, color: b[10] & 7, outline_draw: (b[10] & 8) === 8, innerSplitAlpha: (b[10] >> 4) / 10, outerSplitAlpha: (b[11] & 15) / 10,
    splitSizeRatio: (b[11] >> 4) / 10, thickness: b[12] / 10, dot: ((b[13] >> 4) & 1) === 1, deployedWeaponGapEnabled: ((b[13] >> 4) & 2) === 2,
    usealpha: ((b[13] >> 4) & 4) === 4, crosshair_t: ((b[13] >> 4) & 8) === 8, style: (b[13] & 15) >> 1, size: b[14] / 10 };
}
export function decodeAny(code) {
  const parsed = inspectShareCode(code);
  if (parsed.schema === 'CS32' || parsed.bytes.length === 32) return decodeModernShareCode(parsed);
  const ch = parsed.version === 1 ? migrateLegacyCrosshairV1(legacyV1(parsed.code), { sourceHeight: 960, targetHeight: 960 }) : decodeModernShareCode(parsed);
  return decodeModernShareCode(encodeCS32ShareCode(ch));
}
export function renderCode(code) {
  if (!code) return null;
  const c = decodeAny(String(code).trim());
  const cv = fakeCanvas(SIZE, SIZE);
  drawPixelCrosshair(c, cv);
  return cv.pixels ? png(SIZE, SIZE, cv.pixels) : null;
}
export function renderPixels(code) {
  if (!code) return null;
  const cv = fakeCanvas(SIZE, SIZE); drawPixelCrosshair(decodeAny(String(code).trim()), cv); return cv.pixels;
}

// Хостинг ограничивает число файлов, поэтому картинки собираются в листы по 10×10 (assets/img/xh/sheet-N.png).
const COLS = 10, PER = COLS * COLS;
export function renderAll() {
  const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const ver = Date.now().toString(36);
  const idx = new Map(); const tiles = []; let fail = 0;
  for (const it of d.items) {
    delete it.url; delete it.img; delete it.img_code;
    for (const h of it.history || []) delete h.url;
    const code = String(it.code || '').trim();
    try {
      if (!idx.has(code)) { const px = renderPixels(code); if (!px) continue; idx.set(code, tiles.length); tiles.push(px); }
      const n = idx.get(code); it.xh = [Math.floor(n / PER), n % PER];
    } catch { fail++; delete it.xh; }
  }
  const sheets = Math.ceil(tiles.length / PER);
  for (let sh = 0; sh < sheets; sh++) {
    const W = COLS * SIZE, buf = new Uint8Array(W * W * 4);
    for (let k = 0; k < PER; k++) {
      const t = tiles[sh * PER + k]; if (!t) break;
      const ox = (k % COLS) * SIZE, oy = Math.floor(k / COLS) * SIZE;
      for (let y = 0; y < SIZE; y++) buf.set(t.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), ((oy + y) * W + ox) * 4);
    }
    fs.writeFileSync(path.join(OUT, `sheet-${sh}.png`), png(W, W, buf));
  }
  d.xh_sheet = { base: '/assets/img/xh/sheet-', ver, cols: COLS, size: SIZE, count: sheets };
  delete d.source;
  fs.writeFileSync(DATA, JSON.stringify(d));
  console.log(`crosshair images: ${tiles.length} unique in ${sheets} sheets, failed ${fail}`);
  return { tiles: tiles.length, sheets, fail };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) renderAll();
