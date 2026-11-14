import { describe, expect, it } from 'vitest';
import {
  bearingDeg, destinationPoint, ellipsePoints, greatCircleKm, greatCircleLerp, lonLatToXYZ, pickRay, R_KM, wrapLon, xyzToLonLat,
} from '../../src/components/Globe/geo';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('lonLat <-> xyz', () => {
  it('known points', () => {
    const o = lonLatToXYZ(0, 0); close(o[0], 1); close(o[1], 0); close(o[2], 0);
    const e = lonLatToXYZ(90, 0); close(e[0], 0); close(e[1], 0); close(e[2], -1); // east of lon 0 is -Z
    const w = lonLatToXYZ(-90, 0); close(w[2], 1);
    const n = lonLatToXYZ(0, 90); close(n[1], 1); close(n[0], 0, 1e-12);
    const s = lonLatToXYZ(123, -90); close(s[1], -1);
    const back = lonLatToXYZ(180, 0); close(back[0], -1);
  });
  it('round trips on a grid', () => {
    for (let lon = -179; lon <= 180; lon += 17) for (let lat = -89; lat <= 89; lat += 11) {
      const p = lonLatToXYZ(lon, lat, 1.37);
      const q = xyzToLonLat(...p);
      close(q.lon, lon, 1e-9); close(q.lat, lat, 1e-9); close(q.r, 1.37, 1e-12);
    }
  });
  it('poles give lon 0 and the right latitude', () => {
    expect(xyzToLonLat(0, 1, 0)).toMatchObject({ lon: 0, lat: 90 });
    expect(xyzToLonLat(0, -1, 0)).toMatchObject({ lon: 0, lat: -90 });
  });
  it('wrapLon', () => {
    expect(wrapLon(190)).toBe(-170); expect(wrapLon(-190)).toBe(170); expect(wrapLon(360)).toBe(0); expect(wrapLon(180)).toBe(180);
  });
});

describe('great circle', () => {
  it('quarter turn along the equator is R·π/2', () => {
    close(greatCircleKm({ lon: 0, lat: 0 }, { lon: 90, lat: 0 }), R_KM * Math.PI / 2, 1e-6);
    close(greatCircleKm({ lon: 0, lat: 90 }, { lon: 77, lat: -90 }), R_KM * Math.PI, 1e-6);
  });
  it('midpoint of equator arc and of a meridian arc', () => {
    const m = greatCircleLerp({ lon: 0, lat: 0 }, { lon: 90, lat: 0 }, 0.5);
    close(m.lon, 45, 1e-9); close(m.lat, 0, 1e-9);
    const n = greatCircleLerp({ lon: 10, lat: 0 }, { lon: 10, lat: 80 }, 0.5);
    close(n.lon, 10, 1e-9); close(n.lat, 40, 1e-9);
  });
  it('midpoint is equidistant and endpoints are exact', () => {
    const a = { lon: -120, lat: 30 }, b = { lon: 100, lat: -45 };
    const m = greatCircleLerp(a, b, 0.5);
    close(greatCircleKm(a, m), greatCircleKm(m, b), 1e-6);
    const e0 = greatCircleLerp(a, b, 0), e1 = greatCircleLerp(a, b, 1);
    close(e0.lon, a.lon, 1e-9); close(e1.lat, b.lat, 1e-9);
  });
  it('lerp of identical points does not NaN', () => {
    const p = greatCircleLerp({ lon: 5, lat: 5 }, { lon: 5, lat: 5 }, 0.5);
    close(p.lon, 5); close(p.lat, 5);
  });
});

describe('destination / bearing / ellipse', () => {
  it('destination due north / east on the equator', () => {
    const n = destinationPoint({ lon: 20, lat: 0 }, 0, 100);
    close(n.lon, 20, 1e-9); close(n.lat, (100 / R_KM) * 180 / Math.PI, 1e-9);
    const e = destinationPoint({ lon: 20, lat: 0 }, 90, 100);
    close(e.lat, 0, 1e-9); close(e.lon, 20 + (100 / R_KM) * 180 / Math.PI, 1e-9);
  });
  it('distance and bearing agree with destination', () => {
    const c = { lon: 77.45, lat: 18.44 };
    for (const brg of [0, 33, 90, 181, 270, 359]) {
      const p = destinationPoint(c, brg, 250);
      close(greatCircleKm(c, p), 250, 1e-6); close(bearingDeg(c, p), brg, 1e-6);
    }
  });
  it('ellipse axes are true surface distances at the right azimuth', () => {
    const c = { lon: 77.5, lat: 18.4 }, a = 40, b = 12, az = 75, n = 128;
    const pts = ellipsePoints(c, a, b, az, n);
    expect(pts).toHaveLength(n + 1);
    expect(pts[n]).toEqual(pts[0]);
    close(greatCircleKm(c, pts[0]), a, 1e-6); close(bearingDeg(c, pts[0]), az, 1e-6);
    close(greatCircleKm(c, pts[n / 4]), b, 1e-6); close(bearingDeg(c, pts[n / 4]), az + 90, 1e-6);
    close(greatCircleKm(c, pts[n / 2]), a, 1e-6); close(greatCircleKm(c, pts[(3 * n) / 4]), b, 1e-6);
    const d = pts.map((p) => greatCircleKm(c, p));
    expect(Math.max(...d)).toBeLessThanOrEqual(a + 1e-6); expect(Math.min(...d)).toBeGreaterThanOrEqual(b - 1e-6);
  });
  it('ellipse crossing the antimeridian and the pole stays on the sphere', () => {
    for (const p of ellipsePoints({ lon: 179.9, lat: 89.5 }, 80, 30, 10, 64)) {
      expect(p.lon).toBeGreaterThanOrEqual(-180); expect(p.lon).toBeLessThanOrEqual(180);
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
    }
  });
});

describe('pickRay', () => {
  it('straight down hits the sub-camera point', () => {
    const o = lonLatToXYZ(40, 10, 3), d = lonLatToXYZ(40, 10, -1) as [number, number, number];
    const h = pickRay(o, d)!;
    close(h.lon, 40, 1e-9); close(h.lat, 10, 1e-9); close(h.r, 1, 1e-9);
  });
  it('misses the planet', () => {
    expect(pickRay([0, 0, 3], [1, 0, 0])).toBeNull();
  });
  it('refines against a displaced radius so the hit moves toward the camera side of a bump', () => {
    // flat sphere gives one lon; with a 5% tall plateau the ray hits closer (smaller |lon offset| from the camera axis side)
    const o: [number, number, number] = [3, 0, 0.5], dir: [number, number, number] = [-1, 0, -0.1];
    const len = Math.hypot(...dir); const d: [number, number, number] = [dir[0] / len, dir[1] / len, dir[2] / len];
    const flat = pickRay(o, d)!;
    const tall = pickRay(o, d, () => 1.05)!;
    close(tall.r, 1.05, 1e-5);
    expect(Math.abs(tall.lon - flat.lon)).toBeGreaterThan(0.1);
  });
});
