'use strict';

/**
 * Generates build/icon.ico + build/icon.png without any image dependency.
 * Pure math shapes, 4x supersampling, hand-rolled PNG/ICO containers.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'build');

/* ── CRC / PNG ───────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── shapes (normalized 0..1 coordinates) ─────────────────────── */

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inArrow(x, y) {
  const shaft = inRoundedRect(x, y, 0.443, 0.42, 0.557, 0.725, 0.012);
  if (shaft) return true;
  const apex = 0.205;
  const base = 0.475;
  if (y < apex || y > base) return false;
  const halfWidth = ((y - apex) / (base - apex)) * 0.165;
  return Math.abs(x - 0.5) <= halfWidth;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const PLATE_TOP = [18, 27, 38];
const PLATE_BOTTOM = [8, 13, 20];
const ARROW_TOP = [104, 245, 222];
const ARROW_BOTTOM = [24, 195, 172];

/** Returns [r,g,b,a] 0..255 for a normalized point. */
function sample(x, y) {
  const plate = inRoundedRect(x, y, 0.015, 0.015, 0.985, 0.985, 0.225);
  if (!plate) return [0, 0, 0, 0];

  const plateColor = mix(PLATE_TOP, PLATE_BOTTOM, Math.min(1, Math.max(0, (y - 0.015) / 0.97)));

  // Hairline inner border
  const innerPlate = inRoundedRect(x, y, 0.045, 0.045, 0.955, 0.955, 0.2);
  const edge = !innerPlate;

  let r = plateColor[0];
  let g = plateColor[1];
  let b = plateColor[2];

  if (edge) {
    r += 16;
    g += 22;
    b += 30;
  }

  const bar = inRoundedRect(x, y, 0.285, 0.795, 0.715, 0.855, 0.03);
  if (bar) {
    const t = Math.min(1, Math.max(0, (x - 0.285) / 0.43));
    const c = mix([60, 214, 192], [36, 176, 158], t);
    r = r * 0.25 + c[0] * 0.75;
    g = g * 0.25 + c[1] * 0.75;
    b = b * 0.25 + c[2] * 0.75;
  }

  if (inArrow(x, y)) {
    const c = mix(ARROW_TOP, ARROW_BOTTOM, Math.min(1, Math.max(0, (y - 0.2) / 0.55)));
    r = c[0];
    g = c[1];
    b = c[2];
  }

  return [r, g, b, 255];
}

/* ── raster ───────────────────────────────────────────────────── */

function raster(size, ss = 4) {
  const out = Buffer.alloc(size * size * 4);
  const step = 1 / (size * ss);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = (px * ss + sx + 0.5) * step;
          const y = (py * ss + sy + 0.5) * step;
          const [sr, sg, sb, sa] = sample(x, y);
          const alpha = sa / 255;
          r += sr * alpha;
          g += sg * alpha;
          b += sb * alpha;
          a += alpha;
        }
      }
      const total = ss * ss;
      const offset = (py * size + px) * 4;
      if (a === 0) {
        out[offset] = 0;
        out[offset + 1] = 0;
        out[offset + 2] = 0;
        out[offset + 3] = 0;
      } else {
        out[offset] = Math.round(r / a);
        out[offset + 1] = Math.round(g / a);
        out[offset + 2] = Math.round(b / a);
        out[offset + 3] = Math.round((a / total) * 255);
      }
    }
  }
  return out;
}

/* ── ICO container ────────────────────────────────────────────── */

function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + count * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/* ── main ─────────────────────────────────────────────────────── */

fs.mkdirSync(OUT_DIR, { recursive: true });

const sizes = [256, 128, 64, 48, 32, 16];
const images = sizes.map((size) => ({
  size,
  png: encodePng(size, size, raster(size, size <= 32 ? 6 : 4)),
}));

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(images));
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), images[0].png);
console.log(`ICON OK → ${path.join(OUT_DIR, 'icon.ico')} (${buildIco(images).length} bytes, sizes ${sizes.join('/')})`);
