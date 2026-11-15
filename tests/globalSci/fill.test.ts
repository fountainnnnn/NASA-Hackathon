import { describe, expect, it } from 'vitest';
import { dustFromThermalInertia, fillFromRaster, mockHydrogen, mockRockAbundance, nearestValid, scaleSlope, siteHash } from '../../src/lib/globalSci/fill';
import type { Raster } from '../../src/lib/globalSci/raster';

const grid = (w: number, h: number, f: (c: number, r: number) => number, nodata = -1): Raster => {
  const data = new Int16Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = f(c, r);
  return { width: w, height: h, data, scale: 1, offset: 0, nodata };
};

describe('gap filling (QA round 3: never "not enough data")', () => {
  it('mocks are deterministic per location and plausible', () => {
    expect(siteHash(77.5, 18.4, 'x')).toBe(siteHash(77.5, 18.4, 'x'));
    expect(siteHash(77.5, 18.4, 'x')).not.toBe(siteHash(77.6, 18.4, 'x'));
    const rock = mockRockAbundance(10, 10); expect(rock).toBeGreaterThanOrEqual(3); expect(rock).toBeLessThanOrEqual(12);
    expect(mockHydrogen(0, 70)).toBeGreaterThanOrEqual(20);
    expect(mockHydrogen(0, 10)).toBeLessThanOrEqual(8);
  });
  it('nearest valid cell within 200 km is an estimate; beyond it a mock', () => {
    // 360 x 180 one-degree cells (about 59 km): a hole of 3 x 3 cells at the centre, a desert of nodata elsewhere
    const r = grid(360, 180, (c, rr) => (Math.abs(c - 180) <= 1 && Math.abs(rr - 90) <= 1 ? -1 : 100));
    const n = nearestValid(r, 0.5, -0.5);
    expect(n?.value).toBe(100);
    expect(n!.distanceKm).toBeLessThan(200);
    expect(fillFromRaster(r, 0.5, -0.5, null, 'test', () => 7).provenance).toBe('estimate');
    const empty = grid(360, 180, () => -1);
    const m = fillFromRaster(empty, 0.5, -0.5, null, 'test', () => 7);
    expect(m).toMatchObject({ value: 7, provenance: 'mock' });
    expect(fillFromRaster(r, 50, 50, 42, 'test', () => 7).provenance).toBe('observed');
  });
  it('slope steepens at shorter baselines; dust index follows thermal inertia', () => {
    expect(scaleSlope(1, 14.8, 3.5)).toBeGreaterThan(1);
    expect(scaleSlope(1, 14.8, 0.005)).toBeGreaterThan(scaleSlope(1, 14.8, 0.35));
    expect(dustFromThermalInertia(60)).toBeLessThan(dustFromThermalInertia(400));
  });
});
