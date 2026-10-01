'use strict';
// Reproducible: a fixed DOS timestamp and path-sorted entries give the
// same bytes every run.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { crc32 } = require('./crc32.js');

function listFiles(dir) {
  const out = fs.readdirSync(dir, { recursive: true })
    .map((rel) => ({ rel: rel.split(path.sep).join('/'), abs: path.join(dir, rel) }))
    .filter((f) => fs.statSync(f.abs).isFile());
  out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  return out;
}

function zipDir(srcDir, outFile) {
  const DOS_TIME = 0x0000;
  const DOS_DATE = 0x0021; // 1980-01-01
  const files = listFiles(srcDir);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const name = Buffer.from(f.rel, 'utf8');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + comp.length;
  }

  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outFile, Buffer.concat([localBuf, centralBuf, eocd]));
  return { files: files.length };
}

module.exports = { zipDir };
