import { describe, expect, it } from 'vitest';
import { CTX_MEAN, cropWithMargin, fuseTile, vikingSource } from '../../src/components/Planet/imageryBlend';

const S = 32;
const tile = (r: number, g: number, b: number, a = 255) => { const t = new Uint8ClampedArray(S * S * 4); for (let i = 0; i < S * S; i++) t.set([r, g, b, a], i * 4); return t; };
const fuse = (v: Uint8ClampedArray, c: Uint8ClampedArray | null) => { const o = new Uint8ClampedArray(S * S * 4); fuseTile(v, c, S, o); return o; };

describe('imagery fusion', () => {
  it('CTX black (no data) leaves the graded Viking pixel unchanged, so gaps have no dark edge', () => {
    const v = tile(113, 90, 89);
    expect(Array.from(fuse(v, tile(0, 0, 0)))).toEqual(Array.from(fuse(v, null)));
    expect(Array.from(fuse(v, tile(200, 200, 200, 0)))).toEqual(Array.from(fuse(v, null)));
  });
  it('flat CTX at the mosaic mean does not change brightness', () => {
    const v = tile(113, 90, 89), g = Math.round(CTX_MEAN * 255);
    const a = fuse(v, tile(g, g, g)), b = fuse(v, null);
    for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(2);
  });
  it('output is Mars coloured (red > green > blue) and opaque', () => {
    const o = fuse(tile(113, 90, 89), null);
    expect(o[0]).toBeGreaterThan(o[1]); expect(o[1]).toBeGreaterThan(o[2]); expect(o[3]).toBe(255);
  });
  it('detail strength does not depend on how much texture the CTX tile has (no level seams)', () => {
    const v = tile(113, 90, 89);
    const stripes = (amp: number) => { const t = new Uint8ClampedArray(S * S * 4); for (let i = 0; i < S * S; i++) { const c = 150 + (i % 2 ? amp : -amp); t.set([c, c, c, 255], i * 4); } return t; };
    const spread = (o: Uint8ClampedArray) => { let lo = 255, hi = 0; for (let i = 0; i < S * S; i++) { lo = Math.min(lo, o[i * 4]); hi = Math.max(hi, o[i * 4]); } return hi - lo; };
    const a = spread(fuse(v, stripes(4))), b = spread(fuse(v, stripes(16)));
    expect(a).toBeGreaterThan(8);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(a, b) * 0.35);
  });
  it('crops Viking with a one pixel margin inside the tile only', () => {
    expect(cropWithMargin(0, 0, 8, 256)).toEqual({ x: 0, y: 0, w: 9, h: 9, ml: 0, mt: 0 });
    expect(cropWithMargin(8, 248, 8, 256)).toEqual({ x: 7, y: 247, w: 10, h: 9, ml: 1, mt: 1 });
  });
  it('finds the Viking ancestor square of a CTX tile', () => {
    expect(vikingSource(5857, 1629, 12, 7, 256)).toEqual({ level: 7, x: 183, y: 50, sx: 1 * 8, sy: 29 * 8, size: 8 });
    expect(vikingSource(3, 1, 4, 7, 256)).toEqual({ level: 4, x: 3, y: 1, sx: 0, sy: 0, size: 256 });
  });
});
