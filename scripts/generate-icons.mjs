// Regenerates every app icon from the user's public/logo.png, without dependencies.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
const source = await readFile(new URL('../public/logo.png', import.meta.url));
const width = source.readUInt32BE(16), height = source.readUInt32BE(20);
if (source[24] !== 8 || ![2, 6].includes(source[25]) || source[28] !== 0) {
  throw new Error('logo.png debe ser PNG RGB/RGBA de 8 bits, sin entrelazado.');
}
const channels = source[25] === 6 ? 4 : 3;
const compressed = [];
for (let offset = 8; offset < source.length;) {
  const length = source.readUInt32BE(offset);
  if (source.toString('ascii', offset + 4, offset + 8) === 'IDAT') compressed.push(source.subarray(offset + 8, offset + 8 + length));
  offset += length + 12;
}
const raw = inflateSync(Buffer.concat(compressed)), stride = width * channels;
const pixels = Buffer.alloc(width * height * channels);
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)];
  if (filter > 4) throw new Error('Filtro PNG no válido.');
  for (let x = 0; x < stride; x++) {
    const i = y * stride + x;
    const a = x >= channels ? pixels[i - channels] : 0, b = y ? pixels[i - stride] : 0;
    const c = y && x >= channels ? pixels[i - stride - channels] : 0;
    pixels[i] = raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
  }
}
// Trim transparent padding only in derived icons; the supplied logo stays intact.
let left = width, top = height, right = 0, bottom = 0;
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  if (channels === 3 || pixels[(y * width + x) * channels + 3] > 8) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
}
if (left > right) throw new Error('El logo está completamente transparente.');
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let v = i;
  for (let b = 0; b < 8; b++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
  return v >>> 0;
});
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]), prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  prefix.writeUInt32BE(data.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([prefix, bytes, suffix]);
}
const directory = new URL('../public/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
async function generate(size, filename, maskable = false) {
  // A square of side 56% stays inside the maskable central 80% safe circle.
  const scale = size * (maskable ? .56 : .88) / Math.max(right - left + 1, bottom - top + 1);
  const ox = (size - (right - left + 1) * scale) / 2, oy = (size - (bottom - top + 1) * scale) / 2;
  const bytes = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const colors = [0, 0, 0], samples = size <= 32 ? 4 : 2;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const u = Math.floor((x + (sx + .5) / samples - ox) / scale + left);
      const v = Math.floor((y + (sy + .5) / samples - oy) / scale + top);
      const inside = u >= left && u <= right && v >= top && v <= bottom;
      const i = (v * width + u) * channels;
      const alpha = inside ? (channels === 4 ? pixels[i + 3] / 255 : 1) : 0;
      for (let c = 0; c < 3; c++) colors[c] += (inside ? pixels[i + c] : 0) * alpha + [247, 248, 250][c] * (1 - alpha);
    }
    for (let c = 0; c < 3; c++) bytes[y * (size * 3 + 1) + 1 + x * 3 + c] = Math.round(colors[c] / samples ** 2);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  await writeFile(new URL(filename, directory), Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0)),
  ]));
  process.stdout.write(`${filename}: ${size} x ${size}\n`);
}
await generate(32, 'favicon-32.png');
await generate(180, 'apple-touch-icon.png');
await generate(192, 'icon-192.png');
await generate(512, 'icon-512.png');
await generate(512, 'maskable-512.png', true);
