// Dependency-free deterministic PWA icons. Run: node scripts/generate-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../public/icons/', import.meta.url));
await mkdir(directory, { recursive: true });
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  const bytes = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, bytes, footer]);
}
const insideCircle = (x, y, cx, cy, radius) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
function roundedSquare(x, y) {
  const nearestX = Math.max(0.23, Math.min(0.77, x));
  const nearestY = Math.max(0.23, Math.min(0.77, y));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= 0.2 ** 2;
}
function sample(x, y, maskable) {
  let color = maskable || roundedSquare(x, y) ? [88 - 14 * y, 77 - 12 * y, 231 - 8 * y] : [247, 248, 250];
  // A droplet made from a triangle and a lower circular arc.
  const inDrop = (y >= 0.20 && y <= 0.445 && Math.abs(x - 0.445) <= (y - 0.20) * 0.70)
    || (y >= 0.445 && insideCircle(x, y, 0.445, 0.445, 0.1715));
  if (inDrop) color = [255, 255, 255];
  // Main coin and its rim stay inside the central 80% maskable safe circle.
  if (insideCircle(x, y, 0.635, 0.637, 0.143)) color = [64, 55, 166];
  if (insideCircle(x, y, 0.628, 0.625, 0.139)) color = [52, 211, 153];
  if (insideCircle(x, y, 0.628, 0.625, 0.110)) color = [167, 243, 208];
  if (insideCircle(x, y, 0.628, 0.625, 0.089)) color = [52, 211, 153];
  if (Math.abs(x - 0.628) < 0.014 && y > 0.575 && y < 0.675) color = [6, 95, 70];
  return color;
}
async function generate(size, filename, maskable = false) {
  const bytes = Buffer.alloc((size * 3 + 1) * size);
  const samples = 3;
  for (let y = 0; y < size; y++) {
    const line = y * (size * 3 + 1);
    bytes[line] = 0;
    for (let x = 0; x < size; x++) {
      const color = [0, 0, 0];
      for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
        const pixel = sample((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size, maskable);
        for (let channel = 0; channel < 3; channel++) color[channel] += pixel[channel];
      }
      for (let channel = 0; channel < 3; channel++) bytes[line + 1 + x * 3 + channel] = Math.round(color[channel] / samples ** 2);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2; // RGB, 8-bit, opaque (also suitable for Apple touch icons).
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(bytes, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
  await writeFile(`${directory}/${filename}`, png);
  process.stdout.write(`${filename}: ${size} × ${size}\n`);
}
await generate(180, 'apple-touch-icon.png');
await generate(192, 'icon-192.png');
await generate(512, 'icon-512.png');
await generate(512, 'maskable-512.png', true);
