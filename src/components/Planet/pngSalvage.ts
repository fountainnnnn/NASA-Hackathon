/**
 * Salvage a truncated CTX tile. The CTX tile service sends some tiles as 8-bit grayscale PNGs cut short (HTTP 200, the
 * last IDAT chunk incomplete, no IEND); browsers refuse to decode them, so those tiles would drop to Viking's 232 m.
 * This decodes every complete row that arrived and marks the rest transparent (no data), so the fused layer keeps CTX
 * detail and blends into Viking only where rows are missing. Pure (DecompressionStream only), unit-tested.
 */

export interface SalvagedTile { width: number; height: number; rows: number; rgba: Uint8ClampedArray }

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** Inflate a zlib stream that may be cut short: returns every byte produced before the input ran out. */
async function inflatePartial(z: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  // a truncated stream makes the writer and the reader reject at the end: keep what was produced before that
  writer.write(z as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value); n += value.length;
    }
  } catch { /* truncated input */ }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Decode an 8-bit grayscale, non-interlaced PNG that may be truncated. Returns RGBA (grey in r, g and b; alpha 0 for
 * the tRNS grey value and for rows that never arrived), or null for any other format or when no full row is present.
 */
export async function salvageGrayPng(buf: ArrayBuffer | Uint8Array): Promise<SalvagedTile | null> {
  const d = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (d.length < 33 || SIG.some((v, i) => d[i] !== v)) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let width = 0, height = 0, trns = -1, i = 8;
  const idat: Uint8Array[] = [];
  while (i + 8 <= d.length) {
    const len = dv.getUint32(i), type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    const body = d.subarray(i + 8, Math.min(d.length, i + 8 + len));
    if (type === 'IHDR') {
      if (body.length < 13) return null;
      width = dv.getUint32(i + 8); height = dv.getUint32(i + 12);
      const depth = body[8], colour = body[9], interlace = body[12];
      if (depth !== 8 || colour !== 0 || interlace !== 0) return null;
    } else if (type === 'tRNS' && body.length >= 2) trns = (body[0] << 8) | body[1];
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!width || !height || !idat.length) return null;
  const z = new Uint8Array(idat.reduce((q, b) => q + b.length, 0));
  let o = 0;
  for (const b of idat) { z.set(b, o); o += b.length; }
  const raw = await inflatePartial(z);
  const stride = width + 1;
  const rows = Math.min(height, Math.floor(raw.length / stride));
  if (rows < 1) return null;
  const grey = new Uint8Array(width * rows);
  for (let y = 0; y < rows; y++) {
    const f = raw[y * stride], src = y * stride + 1, row = y * width, up = row - width;
    for (let x = 0; x < width; x++) {
      const v = raw[src + x], a = x ? grey[row + x - 1] : 0, b = y ? grey[up + x] : 0, c = x && y ? grey[up + x - 1] : 0;
      grey[row + x] = (f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : f === 4 ? v + paeth(a, b, c) : v) & 255;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);   // rows that never arrived stay transparent
  for (let p = 0; p < grey.length; p++) {
    const v = grey[p];
    rgba[p * 4] = rgba[p * 4 + 1] = rgba[p * 4 + 2] = v;
    rgba[p * 4 + 3] = v === trns ? 0 : 255;
  }
  return { width, height, rows, rgba };
}
