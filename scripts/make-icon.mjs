#!/usr/bin/env node
/*
 * Generates the app icon (assets/icon.png + assets/icon.ico) from code, so the
 * repo needs no binary design assets and the desktop build has a real icon.
 *
 * Drawn at 4× and box-filtered down, which gives clean anti-aliased edges
 * without pulling in an image library.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 256;
const SS = 4;                       // supersample factor
const W = SIZE * SS;

const BG = [0x10, 0x13, 0x1f, 255];
const BARS = [
  { x: 36, y: 118, w: 44, h: 74, color: [0xff, 0x6b, 0x6b, 255] },
  { x: 106, y: 62, w: 44, h: 130, color: [0x4d, 0xd6, 0xc1, 255] },
  { x: 176, y: 96, w: 44, h: 96, color: [0x7c, 0x8c, 0xff, 255] },
];

/* ------------------------------- drawing ------------------------------- */

const buf = new Uint8Array(W * W * 4);

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r + 0.0001;
}

function fillRoundRect(x, y, w, h, r, color) {
  const x0 = Math.max(0, Math.floor(x * SS));
  const y0 = Math.max(0, Math.floor(y * SS));
  const x1 = Math.min(W, Math.ceil((x + w) * SS));
  const y1 = Math.min(W, Math.ceil((y + h) * SS));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (!inRoundRect(px / SS + 0.5 / SS, py / SS + 0.5 / SS, x, y, w, h, r)) continue;
      const i = (py * W + px) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = color[3];
    }
  }
}

fillRoundRect(0, 0, SIZE, SIZE, 56, BG);
for (const b of BARS) fillRoundRect(b.x, b.y, b.w, b.h, 16, b.color);

/* --------------------------- downsample to 256 --------------------------- */

const out = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        const al = buf[i + 3] / 255;
        r += buf[i] * al; g += buf[i + 1] * al; b += buf[i + 2] * al; a += al;
      }
    }
    const n = SS * SS;
    const o = (y * SIZE + x) * 4;
    // Premultiplied average, then un-premultiply so edges stay the right colour.
    out[o] = a > 0 ? Math.round(r / a) : 0;
    out[o + 1] = a > 0 ? Math.round(g / a) : 0;
    out[o + 2] = a > 0 ? Math.round(b / a) : 0;
    out[o + 3] = Math.round((a / n) * 255);
  }
}

/* ------------------------------ PNG writer ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;    // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4)
      .copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ ICO writer ------------------------------ */

function encodeIco(png, size) {
  const dir = Buffer.alloc(6 + 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);                       // type: icon
  dir.writeUInt16LE(1, 4);                       // one image
  dir[6] = size >= 256 ? 0 : size;               // 0 means 256
  dir[7] = size >= 256 ? 0 : size;
  dir[8] = 0;                                    // palette
  dir[9] = 0;
  dir.writeUInt16LE(1, 10);                      // colour planes
  dir.writeUInt16LE(32, 12);                     // bits per pixel
  dir.writeUInt32LE(png.length, 14);
  dir.writeUInt32LE(6 + 16, 18);                 // offset of the image data
  return Buffer.concat([dir, png]);
}

const png = encodePng(out, SIZE);
const dir = path.join(root, 'assets');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), png);
fs.writeFileSync(path.join(dir, 'icon.ico'), encodeIco(png, SIZE));
console.log(`wrote assets/icon.png (${(png.length / 1024).toFixed(1)} KB) and assets/icon.ico`);
