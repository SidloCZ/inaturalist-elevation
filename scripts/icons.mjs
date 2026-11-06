// Original mountain icon, rendered without external image tools.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../icons/", import.meta.url));
mkdirSync(directory, { recursive: true });
const shapes = [
  { color: [255, 255, 255], points: [[10, 48], [29, 17], [48, 48]] },
  { color: [232, 244, 211], points: [[32, 48], [43, 29], [55, 48]] },
  { color: [62, 101, 13], points: [[22, 29], [29, 17], [36, 29], [29, 26]] }
];

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pixel(x, y) {
  const dx = Math.max(12 - x, 0, x - 52);
  const dy = Math.max(12 - y, 0, y - 52);
  if (dx * dx + dy * dy > 100 || x < 2 || x > 62 || y < 2 || y > 62) return [0, 0, 0, 0];
  let color = [116, 172, 0];
  for (const shape of shapes) if (insidePolygon(x, y, shape.points)) color = shape.color;
  return [...color, 255];
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(bytes.length);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}

for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const sample = pixel((x + (sx + 0.5) / 4) * 64 / size, (y + (sy + 0.5) / 4) * 64 / size);
        for (let c = 0; c < 4; c++) sum[c] += sample[c];
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 4; c++) raw[offset + c] = Math.round(sum[c] / 16);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
  ]);
  writeFileSync(`${directory}/icon-${size}.png`, png);
}
