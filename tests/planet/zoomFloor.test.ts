import { describe, expect, it } from 'vitest';
import { MAX_SCREEN_PX_PER_TEXEL, VIKING_TEXEL_M, ctxLevelFor, ctxTexelM, floorRangeM, groundPxM, tileAt, tilesAround } from '../../src/components/Planet/imagery';

// Cesium's default 60 degree FOV is horizontal on a landscape viewport: at 1440 x 810 the vertical FOV is 2 atan(tan 30 / 1.778)
const FOVY = 2 * Math.atan(Math.tan(Math.PI / 6) / (1440 / 810));

describe('imagery resolution', () => {
  it('CTX level 12 is the 5 m mosaic and Viking tops out at ~326 m per pixel', () => {
    expect(ctxTexelM(12)).toBeCloseTo(5.087, 2);
    expect(ctxTexelM(8)).toBeCloseTo(81.4, 1);
    expect(VIKING_TEXEL_M).toBeCloseTo(325.6, 0);
  });
  it('tileAt matches the services grid (2 x 1 at level 0, rows from the north)', () => {
    expect(tileAt(77.08, 21.43, 12)).toEqual({ x: 5849, y: 1560 });   // 257.08 / 360 * 8192 = 5849.95
    expect(tileAt(-180, 90, 0)).toEqual({ x: 0, y: 0 });
    expect(tileAt(179.999, -89.999, 0)).toEqual({ x: 1, y: 0 });
    expect(tileAt(180, 0, 3)).toEqual({ x: 0, y: 4 });   // wraps
  });
});

describe('zoom floor', () => {
  it('at the floor one imagery pixel spans exactly MAX_SCREEN_PX_PER_TEXEL screen pixels', () => {
    for (const texel of [ctxTexelM(12), ctxTexelM(10), VIKING_TEXEL_M]) {
      const f = floorRangeM(texel, 810, FOVY);
      expect(texel / groundPxM(f, 810, FOVY)).toBeCloseTo(MAX_SCREEN_PX_PER_TEXEL, 6);
    }
  });
  it('floors at 1440 x 810: CTX 5 m about 2.1 km, Viking about 135 km', () => {
    expect(floorRangeM(ctxTexelM(12), 810, FOVY) / 1000).toBeCloseTo(2.11, 1);
    expect(floorRangeM(VIKING_TEXEL_M, 810, FOVY) / 1000).toBeCloseTo(135.3, 0);
  });
  it('the level a view wants is finer than a screen pixel, capped at 12', () => {
    const g = groundPxM(floorRangeM(ctxTexelM(9), 810, FOVY), 810, FOVY);   // held at the level 9 floor
    expect(ctxLevelFor(g)).toBe(11);
    expect(ctxLevelFor(0.5)).toBe(12);
    expect(ctxLevelFor(1e6)).toBe(3);
  });
});

describe('tilesAround', () => {
  it('returns the centre tile first, bounded, inside the window', () => {
    const c = tileAt(77.08, 21.43, 12);
    const t = tilesAround(77.08, 21.43, 12, 0.05, 0.03, 16);
    expect(t[0]).toEqual(c);
    expect(t.length).toBeLessThanOrEqual(16);
    expect(t.every((p) => Math.abs(p.x - c.x) <= 2 && Math.abs(p.y - c.y) <= 1)).toBe(true);
  });
  it('wraps across the antimeridian and stops at the poles', () => {
    const t = tilesAround(179.99, 89.99, 4, 2, 2, 50);
    expect(t.some((p) => p.x === 0)).toBe(true);
    expect(t.every((p) => p.y >= 0)).toBe(true);
  });
});
