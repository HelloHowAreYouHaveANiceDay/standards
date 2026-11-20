#!/usr/bin/env node
// Vendored by HelloHowAreYouHaveANiceDay/standards (profile ui-kit); do not edit -- re-run sync.
// Zero dependencies. Writes the neutral PLACEHOLDER rasters a new property needs to pass UK9/UK11 on day one: a filled
// circle (the template mark) in the template primary colour on white. Binary files are never vendored by a profile, so
// they are generated here. Replace them with renders of your own mark.svg before shipping.
//
//   node .standards/ui-kit/placeholder-rasters.mjs [out-dir] [--color #404040]     default out-dir: design/brand
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// RGB PNG, a filled circle (radius = 40% of the short side) on white
export function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  const r = 0.4 * Math.min(w, h), cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) { const o = row + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ICO with one PNG-compressed image
export function ico(size, rgb) {
  const img = png(size, size, rgb);
  const dir = Buffer.alloc(22);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4);
  dir[6] = size >= 256 ? 0 : size; dir[7] = size >= 256 ? 0 : size; dir.writeUInt16LE(1, 10); dir.writeUInt16LE(32, 12);
  dir.writeUInt32LE(img.length, 14); dir.writeUInt32LE(22, 18);
  return Buffer.concat([dir, img]);
}

export function write(outDir, hex = '#404040') {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`--color must be #rrggbb, got ${hex}`);
  const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  fs.mkdirSync(outDir, { recursive: true });
  const files = { 'favicon.ico': ico(32, rgb), 'apple-touch-icon.png': png(180, 180, rgb), 'icon-192.png': png(192, 192, rgb), 'icon-512.png': png(512, 512, rgb), 'og.png': png(1200, 630, rgb) };
  for (const [f, b] of Object.entries(files)) fs.writeFileSync(path.join(outDir, f), b);
  return Object.keys(files);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  let color = '#404040';
  const i = args.indexOf('--color');
  if (i >= 0) color = args.splice(i, 2)[1];
  try {
    const out = path.resolve(args[0] || 'design/brand');
    console.log(`placeholder-rasters: wrote ${write(out, color).join(', ')} to ${out}`);
  } catch (e) { console.error(`placeholder-rasters: ${e.message}`); process.exitCode = 2; }
}
