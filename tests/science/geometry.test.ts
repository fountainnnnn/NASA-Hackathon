import { describe, expect, it } from 'vitest';
import { bearingDeg, distanceM, distanceToBBoxM, inBBox, interiorPoint, pointInRings } from '@/lib/science/geometry';
import { box } from './fixtures';

describe('pointInRings (synthetic test fixture)', () => {
  const donut = [box(0, 0, 4, 4), box(1, 1, 3, 3)];
  it('even-odd with holes', () => {
    expect(pointInRings({ lon: 0.5, lat: 0.5 }, donut)).toBe(true);
    expect(pointInRings({ lon: 2, lat: 2 }, donut)).toBe(false); // in hole
    expect(pointInRings({ lon: 5, lat: 2 }, donut)).toBe(false);
  });
  it('bbox prefilter helpers', () => {
    expect(inBBox({ lon: 1, lat: 1 }, [0, 0, 2, 2])).toBe(true);
    expect(inBBox({ lon: 3, lat: 1 }, [0, 0, 2, 2])).toBe(false);
    expect(distanceToBBoxM({ lon: 1, lat: 1 }, [0, 0, 2, 2])).toBe(0);
    expect(distanceToBBoxM({ lon: 1, lat: 3 }, [0, 0, 2, 2])).toBeCloseTo(59274, -2);
  });
});

describe('distance and bearing', () => {
  it('1 degree of latitude is about 59.27 km on Mars', () => {
    expect(distanceM({ lon: 77, lat: 18 }, { lon: 77, lat: 19 }) / 1000).toBeCloseTo(59.27, 1);
  });
  it('longitude shrinks with cos(lat)', () => {
    const d = distanceM({ lon: 77, lat: 60 }, { lon: 78, lat: 60 }) / 1000;
    expect(d).toBeCloseTo(59.27 * 0.5, 1);
  });
  it('bearings are clockwise from north', () => {
    const o = { lon: 77, lat: 18 };
    expect(bearingDeg(o, { lon: 77, lat: 18.1 })).toBeCloseTo(0, 5);
    expect(bearingDeg(o, { lon: 77.1, lat: 18 })).toBeCloseTo(90, 5);
    expect(bearingDeg(o, { lon: 77, lat: 17.9 })).toBeCloseTo(180, 5);
    expect(bearingDeg(o, { lon: 76.9, lat: 18 })).toBeCloseTo(270, 5);
  });
});

describe('interiorPoint', () => {
  it('lies inside, outside the hole, and near the middle of the ring', () => {
    const rings = [box(0, 0, 4, 4), box(1.5, 1.5, 2.5, 2.5)];
    const ip = interiorPoint(rings)!;
    expect(pointInRings(ip, rings)).toBe(true);
    expect(ip.clearanceM).toBeGreaterThan(0);
  });
  it('concave L-shape gives a point inside', () => {
    const L: [number, number][] = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3], [0, 0]];
    const ip = interiorPoint([L])!;
    expect(pointInRings(ip, [L])).toBe(true);
  });
});
