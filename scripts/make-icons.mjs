// Generates the PWA PNG icons with no dependency (Node zlib only).
// Design: yellow taxi tile with a dark checker band.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const YELLOW = [245, 197, 24];
const DARK = [21, 23, 28];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size, padding) {
  const rows = [];
  const inner = size * (1 - 2 * padding);
  const cell = inner / 8;
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const ix = x - size * padding;
      const iy = y - size * padding;
      let px = YELLOW;
      const inBand = iy >= inner * 0.42 && iy < inner * 0.42 + cell * 2 && ix >= 0 && ix < inner;
      if (inBand && (Math.floor(ix / cell) + Math.floor((iy - inner * 0.42) / cell)) % 2 === 0) px = DARK;
      row.push(...px);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, 0.1));
writeFileSync('public/icons/icon-512.png', icon(512, 0.1));
writeFileSync('public/icons/icon-512-maskable.png', icon(512, 0.2));
writeFileSync(
  'public/icons/icon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" rx="1.2" fill="#f5c518"/>` +
    Array.from({ length: 8 }, (_, i) => `<rect x="${i}" y="${3 + (i % 2)}" width="1" height="1" fill="#15171c"/>`).join('') +
    `</svg>`,
);
console.log('icons written');

if (existsSync('android/app/src/main/res')) {
  const root = 'android/app/src/main/res';
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const dir = `${root}/mipmap-${density}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/ic_launcher.png`, icon(size, 0.1));
    writeFileSync(`${dir}/ic_launcher_round.png`, icon(size, 0.1));
    writeFileSync(`${dir}/ic_launcher_foreground.png`, icon(Math.round(size * 2.25), 0.2));
  }
}
