import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { salvageGrayPng } from '../../src/components/Planet/pngSalvage';

/** A tiny 8-bit grayscale PNG (CRCs are not checked by the salvage decoder, so they are zero here). */
function grayPng(w: number, h: number, px: (x: number, y: number) => number, opts: { trns?: number; filter?: number } = {}): Uint8Array {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = opts.filter ?? 0;
    raw[y * (w + 1)] = f;
    for (let x = 0; x < w; x++) {
      const v = px(x, y), left = x ? px(x - 1, y) : 0, up = y ? px(x, y - 1) : 0;
      raw[y * (w + 1) + 1 + x] = (f === 1 ? v - left : f === 2 ? v - up : v) & 255;
    }
  }
  const chunk = (type: string, body: Buffer) => { const b = Buffer.alloc(12 + body.length); b.writeUInt32BE(body.length, 0); b.write(type, 4, 'latin1'); body.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (opts.trns != null) parts.push(chunk('tRNS', Buffer.from([0, opts.trns])));
  parts.push(chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}

describe('salvageGrayPng (truncated CTX tiles)', () => {
  const W = 64, H = 64, pix = (x: number, y: number) => (x * 3 + y * 7) & 255;
  it('decodes a complete grayscale PNG exactly, with each filter type', async () => {
    for (const filter of [0, 1, 2]) {
      const t = await salvageGrayPng(grayPng(W, H, pix, { filter }));
      expect(t).not.toBeNull();
      expect(t!.rows).toBe(H);
      expect(t!.rgba[(5 * W + 9) * 4]).toBe(pix(9, 5));
      expect(t!.rgba[(5 * W + 9) * 4 + 3]).toBe(255);
    }
  });
  it('keeps the rows that arrived from a PNG cut short and leaves the rest transparent', async () => {
    const png = grayPng(W, H, (x, y) => (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1 + 1) * 120 | 0);
    const cut = png.subarray(0, png.length - 12 - 120); // no IEND, last IDAT short by 120 bytes
    const t = await salvageGrayPng(cut);
    expect(t).not.toBeNull();
    expect(t!.rows).toBeGreaterThan(0);
    expect(t!.rows).toBeLessThan(H);
    expect(t!.rgba[3]).toBe(255);
    expect(t!.rgba[((H - 1) * W) * 4 + 3]).toBe(0);
  });
  it('marks the tRNS grey value as no data', async () => {
    const t = await salvageGrayPng(grayPng(8, 8, (x) => (x < 4 ? 0 : 200), { trns: 0 }));
    expect(t!.rgba[3]).toBe(0);
    expect(t!.rgba[5 * 4 + 3]).toBe(255);
  });
  it('declines anything that is not an 8-bit grayscale PNG', async () => {
    expect(await salvageGrayPng(new Uint8Array([1, 2, 3]))).toBeNull();
    const rgb = grayPng(4, 4, pix); rgb[8 + 8 + 9] = 2; // IHDR colour type 2
    expect(await salvageGrayPng(rgb)).toBeNull();
  });
});
