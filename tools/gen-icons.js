'use strict';

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const { crc32 } = require('./crc32.js');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decode(buf) {
  let o = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error('source PNG must be 8-bit RGBA, non-interlaced');
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= 4 && y > 0) ? out[(y - 1) * stride + x - 4] : 0;
      const v = raw[rowStart + x];
      let val;
      switch (ft) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: val = v + paeth(a, b, c); break;
        default: throw new Error('unknown filter ' + ft);
      }
      out[y * stride + x] = val & 0xff;
    }
  }
  return { width, height, rgba: out };
}

// Averaged on premultiplied alpha, so transparent edges do not bleed dark.
function downscale(src, sw, sh, t) {
  const out = Buffer.alloc(t * t * 4);
  const sx = sw / t, sy = sh / t;
  for (let ty = 0; ty < t; ty++) {
    const y0 = ty * sy, y1 = (ty + 1) * sy;
    for (let tx = 0; tx < t; tx++) {
      const x0 = tx * sx, x1 = (tx + 1) * sx;
      let r = 0, g = 0, b = 0, aw = 0, w = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const cw = wx * wy;
          const i = (yy * sw + xx) * 4;
          const pa = src[i + 3] / 255;
          r += src[i] * pa * cw; g += src[i + 1] * pa * cw; b += src[i + 2] * pa * cw;
          aw += pa * cw; w += cw;
        }
      }
      const o = (ty * t + tx) * 4;
      const a = aw / w; // mean alpha, 0..1
      if (a > 0) {
        out[o] = Math.round((r / w) / a);
        out[o + 1] = Math.round((g / w) / a);
        out[o + 2] = Math.round((b / w) / a);
      }
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

const assets = path.join(__dirname, '..', 'src', 'assets');
const src = decode(fs.readFileSync(path.join(assets, 'icon128.png')));
for (const s of [48, 16]) {
  fs.writeFileSync(path.join(assets, `icon${s}.png`), png(s, downscale(src.rgba, src.width, src.height, s)));
}
console.log('wrote icon48.png icon16.png (downscaled from icon128.png) to src/assets/');
