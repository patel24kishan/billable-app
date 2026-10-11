// Generates the PLACEHOLDER app icon build/icon.png (512x512 RGBA PNG):
// a rounded square in the app's accent blue with a white "B" mark.
// Replace build/icon.png with a real logo (>= 512x512 PNG) before a public release;
// electron-builder converts it to the Windows .ico itself.
//
// No dependencies: shapes are drawn with signed distance functions (anti-aliased
// edges) and the PNG is written with node:zlib. The output is deterministic.
// Usage: node scripts/make-icon.mjs [output-path]   (default: build/icon.png)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ICON_SIZE = 512;
const ACCENT = [0x34, 0x52, 0xe1]; // --accent in src/style.css (light theme)
const INK = [0xff, 0xff, 0xff];

// Signed distance to an axis-aligned box [x0,x1]x[y0,y1] whose left corners have
// radius rl and right corners radius rr (negative inside).
function boxSdf(px, py, x0, y0, x1, y1, rl, rr) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
  const dx = px - cx, dy = py - cy;
  const r = dx > 0 ? rr : rl;
  const qx = Math.abs(dx) - hx + r, qy = Math.abs(dy) - hy + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d));

/** RGBA pixels (Uint8Array, row-major) of the icon at `size` x `size`. */
export function renderIconPixels(size = ICON_SIZE) {
  const s = size / 512; // the design is laid out on a 512 grid
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / s, v = (y + 0.5) / s;
      // Background tile.
      const bgA = coverage(boxSdf(u, v, 24, 24, 488, 488, 104, 104) * s);
      // "B": stem + two bowls, minus the two counters.
      const outer = Math.min(
        boxSdf(u, v, 160, 112, 216, 400, 6, 0),
        boxSdf(u, v, 160, 112, 322, 266, 6, 77),
        boxSdf(u, v, 160, 246, 346, 400, 6, 77)
      );
      const counters = Math.min(
        boxSdf(u, v, 216, 160, 276, 218, 0, 29),
        boxSdf(u, v, 216, 294, 300, 352, 0, 29)
      );
      const inkA = coverage(Math.max(outer, -counters) * s) * bgA;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(ACCENT[c] * (1 - inkA / Math.max(bgA, 1e-9)) + INK[c] * (inkA / Math.max(bgA, 1e-9)));
      px[i + 3] = Math.round(bgA * 255);
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encodes RGBA pixels as a PNG (8-bit RGBA, no interlace, filter 0). */
export function encodePng(pixels, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** The icon as PNG bytes. */
export function makeIconPng(size = ICON_SIZE) {
  return encodePng(renderIconPixels(size), size, size);
}

/** Writes the icon to `outPath` (creating the folder) and returns the bytes. */
export function writeIcon(outPath, size = ICON_SIZE) {
  const png = makeIconPng(size);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  return png;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.resolve(process.argv[2] || path.join(root, 'build', 'icon.png'));
  const png = writeIcon(out);
  console.log('make-icon: wrote ' + out + ' (' + png.length + ' bytes, ' + ICON_SIZE + 'x' + ICON_SIZE + ')');
}
