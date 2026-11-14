import { describe, expect, it } from 'vitest';
import { R_MARS } from '@/lib/contracts';
import type { Dem } from '@/lib/contracts';
import { bearingDeg, decodeDem, groundDistanceM, lonLatToPixel, pixelCentreLonLat, sampleElevation, toLocal, toLonLat } from '@/lib/geo/frame';
import { makeMeta, makeSyntheticDem, SYN } from '../fixtures/synthetic';

const DEG = Math.PI / 180;

describe('frame', () => {
  const dem = makeSyntheticDem();
  const { meta } = dem;

  it('toLocal -> toLonLat round trips to < 1e-6 m across the grid', () => {
    let worst = 0;
    for (let r = 0; r < meta.height; r += 7) {
      for (let c = 0; c < meta.width; c += 7) {
        const p = pixelCentreLonLat(meta, c, r);
        const { x, z } = toLocal(meta, p.lon, p.lat);
        const q = toLonLat(meta, x, z);
        const err = Math.hypot((q.lon - p.lon) * DEG * R_MARS, (q.lat - p.lat) * DEG * R_MARS);
        worst = Math.max(worst, err);
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('is east-positive in x and south-positive in z, origin at DEM centre', () => {
    const lonC = (meta.lonMin + meta.lonMax) / 2, latC = (meta.latMin + meta.latMax) / 2;
    const o = toLocal(meta, lonC, latC);
    expect(Math.abs(o.x)).toBeLessThan(1e-9);
    expect(Math.abs(o.z)).toBeLessThan(1e-9);
    expect(toLocal(meta, lonC + 0.001, latC).x).toBeGreaterThan(0);
    expect(toLocal(meta, lonC, latC - 0.001).z).toBeGreaterThan(0);
    expect(bearingDeg({ lon: lonC, lat: latC }, { lon: lonC + 0.01, lat: latC })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lon: lonC, lat: latC }, { lon: lonC, lat: latC + 0.01 })).toBeCloseTo(0, 6);
    expect(groundDistanceM({ lon: lonC, lat: latC }, { lon: lonC, lat: latC + 0.01 })).toBeCloseTo(R_MARS * 0.01 * DEG, 3);
  });

  it('pixel centre / pixel coordinate helpers are inverse', () => {
    const p = pixelCentreLonLat(meta, 33, 71);
    const px = lonLatToPixel(meta, p.lon, p.lat);
    expect(px.c).toBeCloseTo(33, 9);
    expect(px.r).toBeCloseTo(71, 9);
  });

  it('sampleElevation is exact at pixel centres, bilinear between, null on nodata / out of bounds', () => {
    for (const [c, r] of [[0, 0], [5, 9], [60, 60], [119, 119], [0, 119], [30, 100]]) {
      const p = pixelCentreLonLat(meta, c, r);
      expect(sampleElevation(dem, p.lon, p.lat)).toBeCloseTo(dem.elev[r * meta.width + c], 4);
    }
    // midpoint of four known cells == their mean
    const a = pixelCentreLonLat(meta, 10, 20), b = pixelCentreLonLat(meta, 11, 21);
    const mid = { lon: (a.lon + b.lon) / 2, lat: (a.lat + b.lat) / 2 };
    const w = meta.width;
    const mean = (dem.elev[20 * w + 10] + dem.elev[20 * w + 11] + dem.elev[21 * w + 10] + dem.elev[21 * w + 11]) / 4;
    expect(sampleElevation(dem, mid.lon, mid.lat)!).toBeCloseTo(mean, 4);
    // quarter point along x on a row: 0.75/0.25 weights
    const q = { lon: a.lon + 0.25 * meta.dLon, lat: a.lat };
    expect(sampleElevation(dem, q.lon, q.lat)!).toBeCloseTo(0.75 * dem.elev[20 * w + 10] + 0.25 * dem.elev[20 * w + 11], 4);
    // nodata hole, and a point between a hole cell and a valid cell
    const h = SYN.hole;
    const inHole = pixelCentreLonLat(meta, h.c0 + 2, h.r0 + 2);
    expect(sampleElevation(dem, inHole.lon, inHole.lat)).toBeNull();
    const edge = pixelCentreLonLat(meta, h.c0 - 0.5, h.r0 + 2);
    expect(sampleElevation(dem, edge.lon, edge.lat)).toBeNull();
    // out of bounds
    expect(sampleElevation(dem, meta.lonMin - 0.01, (meta.latMin + meta.latMax) / 2)).toBeNull();
    expect(sampleElevation(dem, (meta.lonMin + meta.lonMax) / 2, meta.latMax + 0.01)).toBeNull();
  });

  it('decodeDem handles Int16 LE, scale/offset and nodata', () => {
    const m = { ...makeMeta(3, 2), encoding: { type: 'int16le' as const, scale: 0.5, offset: -100, nodata: -32768 as const } };
    const buf = new ArrayBuffer(12);
    const v = new DataView(buf);
    [0, 10, -32768, 200, -5, 32767].forEach((x, i) => v.setInt16(i * 2, x, true));
    const d: Dem = decodeDem(m, buf);
    expect(Array.from(d.elev.slice(0, 2))).toEqual([-100, -95]);
    expect(d.elev[2]).toBeNaN();
    expect(d.elev[3]).toBe(0);
    expect(d.elev[4]).toBe(-102.5);
    expect(d.elev[5]).toBeCloseTo(-100 + 0.5 * 32767, 2);
    expect(() => decodeDem(m, new ArrayBuffer(4))).toThrow();
  });
});
