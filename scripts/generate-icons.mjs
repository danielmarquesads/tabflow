/**
 * Generates simple PNG icons (no deps) for Chrome extension.
 * Honey amber square with "TF" is approximated as solid rounded-feel mark.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "icons");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function pngRGB(size, paint) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = paint(x, y, size);
      const i = 1 + x * 3;
      row[i] = r;
      row[i + 1] = g;
      row[i + 2] = b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paintIcon(x, y, size) {
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const pad = 0.08;
  const inside = nx > pad && nx < 1 - pad && ny > pad && ny < 1 - pad;
  // rounded-ish corners via distance from corners
  const r = 0.14;
  const cx = Math.min(Math.abs(nx - pad), Math.abs(nx - (1 - pad)));
  const cy = Math.min(Math.abs(ny - pad), Math.abs(ny - (1 - pad)));
  const nearCorner = (nx < pad + r || nx > 1 - pad - r) && (ny < pad + r || ny > 1 - pad - r);
  if (!inside) return [18, 18, 18];
  if (nearCorner && cx * cx + cy * cy > r * r) return [18, 18, 18];

  // amber fill
  let rC = 217,
    gC = 119,
    bC = 6;
  // letter-like TF bars (rough)
  const inBar =
    (nx > 0.28 && nx < 0.42 && ny > 0.28 && ny < 0.72) ||
    (nx > 0.28 && nx < 0.68 && ny > 0.28 && ny < 0.4) ||
    (nx > 0.48 && nx < 0.62 && ny > 0.4 && ny < 0.72) ||
    (nx > 0.48 && nx < 0.72 && ny > 0.52 && ny < 0.64);
  if (inBar) {
    rC = 26;
    gC = 18;
    bC = 6;
  }
  return [rC, gC, bC];
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const buf = pngRGB(size, paintIcon);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), buf);
  console.log("wrote", `icon${size}.png`);
}
