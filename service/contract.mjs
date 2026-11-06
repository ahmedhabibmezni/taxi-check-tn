import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const MAX_BODY = 3_000_000;
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const validToken = value => typeof value === 'string' && tokenPattern.test(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...keys].sort().join();
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
export function validateCard(body) {
  if (!exact(body, ['version', 'snapshot', 'png', 'viewToken', 'creationToken']) || body.version !== 2
    || !validToken(body.viewToken) || !validToken(body.creationToken) || body.viewToken === body.creationToken) throw Error('format');
  const s = body.snapshot;
  if (!exact(s, ['language', 'direction', 'blocks']) || !['aeb','ar','fr','en'].includes(s.language)
    || s.direction !== (['aeb','ar'].includes(s.language) ? 'rtl' : 'ltr') || !Array.isArray(s.blocks)
    || s.blocks.length < 7 || s.blocks.length > 20) throw Error('snapshot');
  const kinds = ['label','fare','label','range','text','text','text'];
  let textLength = 0;
  for (const [i,b] of s.blocks.entries()) {
    if (!exact(b,['kind','text']) || !['label','fare','range','text','comparison','detail','difference'].includes(b.kind)
      || (i < 7 && b.kind !== kinds[i]) || typeof b.text !== 'string' || !b.text.trim() || b.text.length > 1600
      || /[\u0000-\u001f<>]/u.test(b.text)) throw Error('blocks');
    textLength += b.text.length;
  }
  if (textLength > 12000 || typeof body.png !== 'string' || body.png.length > 2_800_000 || body.png.length % 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.png)) throw Error('image');
  const bytes = Buffer.from(body.png,'base64');
  if(bytes.toString('base64')!==body.png)throw Error('encoding');
  if (!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw Error('png');
  let offset = 8, width, height, ended = false; const compressed = [];
  while (offset + 12 <= bytes.length) {
    const n = bytes.readUInt32BE(offset), type = bytes.toString('ascii',offset+4,offset+8);
    if (offset + n + 12 > bytes.length || crc32(bytes.subarray(offset+4,offset+8+n)) !== bytes.readUInt32BE(offset+8+n)) throw Error('chunk');
    const data = bytes.subarray(offset+8,offset+8+n);
    if (offset === 8 && type !== 'IHDR') throw Error('header');
    if (type === 'IHDR') {
      if (width || n !== 13) throw Error('header');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (width !== 1200 || height < 800 || height > 10000 || data[8] !== 8 || ![2,6].includes(data[9]) || data[10] || data[11] || data[12]) throw Error('dimensions');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND' && n === 0) { ended = true; offset += 12; break; }
    else if (type !== 'sRGB' || n !== 1) throw Error('metadata');
    offset += n + 12;
  }
  if (!ended || offset !== bytes.length || !compressed.length) throw Error('png');
  const channels = bytes[25] === 6 ? 4 : 3, stride = width * channels + 1;
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: stride * height });
  if (raw.length !== stride * height) throw Error('pixels');
  for (let y=0;y<height;y++) if (raw[y*stride] > 4) throw Error('filter');
  return { version:1, snapshot:s, png:body.png, width, height };
}
