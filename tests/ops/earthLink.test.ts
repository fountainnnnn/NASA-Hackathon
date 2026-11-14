import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  earthAboveHorizon, earthRangeAu, earthSkyAt, earthSkyCoverage, earthWindowDuringEva, lightTimeMin, loadEarthLink,
  nextEarthRiseSet, roundTripMin, setEarthLink,
} from '@/lib/ops/earthLink';
import type { EarthLinkData } from '@/lib/ops/earthLink';

// real NASA JPL Horizons data (public/data/earth_link.json)
const raw = readFileSync(join(__dirname, '../../public/data/earth_link.json'), 'utf8');
const data = JSON.parse(raw) as EarthLinkData;
const MIN = 60_000;
const AU_KM = 149_597_870.7; // Horizons "Units conversion"

describe('loadEarthLink', () => {
  it('loads through the supplied fetch and caches for the pure functions', async () => {
    setEarthLink(null);
    expect(() => lightTimeMin(Date.UTC(2026, 10, 15))).toThrow(/not loaded/);
    const stub = (async (url: string) => {
      expect(url).toBe('/data/earth_link.json');
      return { ok: true, status: 200, json: async () => JSON.parse(raw) };
    }) as unknown as typeof fetch;
    await loadEarthLink(stub);
    expect(lightTimeMin(Date.UTC(2026, 10, 15))).toBeCloseTo(10.9453, 3);
    setEarthLink(null);
  });
  it('rejects on a failed response', async () => {
    const stub = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(loadEarthLink(stub)).rejects.toThrow(/404/);
  });
  it('records the NASA source and exact queries', () => {
    expect(data.source.title).toBe('NASA JPL Horizons');
    expect(data.source.url).toBe('https://ssd.jpl.nasa.gov/horizons/');
    expect(JSON.stringify(data.source.query)).toContain('500@499');
    expect(JSON.stringify(data.source.query)).toContain('coord@499');
  });
});

describe('light time interpolation', () => {
  const lt = data.lightTime;
  const day = (i: number) => Date.parse(lt.start) + i * 86_400_000;
  it('returns the tabulated value on grid points and the linear mean at the midpoint', () => {
    expect(lightTimeMin(day(100), data)).toBeCloseTo(lt.oneWayMin[100], 9);
    expect(lightTimeMin(day(100) + 43_200_000, data)).toBeCloseTo((lt.oneWayMin[100] + lt.oneWayMin[101]) / 2, 9);
    expect(lightTimeMin(day(100) + 21_600_000, data)).toBeCloseTo(lt.oneWayMin[100] * 0.75 + lt.oneWayMin[101] * 0.25, 9);
    expect(earthRangeAu(day(7) + 43_200_000, data)).toBeCloseTo((lt.rangeAu[7] + lt.rangeAu[8]) / 2, 9);
    expect(roundTripMin(day(100), data)).toBeCloseTo(2 * lt.oneWayMin[100], 9);
  });
  it('accepts Date and number, and is null outside 2026-01-01..2040-12-31', () => {
    expect(lightTimeMin(new Date(day(10)), data)).toBe(lightTimeMin(day(10), data));
    expect(lightTimeMin(Date.UTC(2025, 11, 31), data)).toBeNull();
    expect(lightTimeMin(Date.UTC(2041, 0, 2), data)).toBeNull();
    expect(lightTimeMin(day(lt.count - 1), data)).toBeCloseTo(lt.oneWayMin[lt.count - 1], 9);
  });
});

describe('light time sanity', () => {
  it('covers 2026-01-01..2040-12-31 daily', () => {
    expect(data.lightTime.start).toBe('2026-01-01T00:00:00.000Z');
    expect(data.lightTime.count).toBe(5479);
    expect(data.lightTime.rangeAu).toHaveLength(5479);
    expect(data.lightTime.oneWayMin).toHaveLength(5479);
  });
  it('stays within 3.0..22.5 min (0.37..2.68 au) at every sample and every half day', () => {
    for (let i = 0; i < data.lightTime.count; i++) {
      expect(data.lightTime.oneWayMin[i]).toBeGreaterThan(3.0);
      expect(data.lightTime.oneWayMin[i]).toBeLessThan(22.5);
      expect(data.lightTime.rangeAu[i]).toBeGreaterThan(0.37);
      expect(data.lightTime.rangeAu[i]).toBeLessThan(2.68);
    }
    const t0 = Date.parse(data.lightTime.start);
    for (let t = t0; t <= t0 + 5478 * 86_400_000; t += 43_200_000 + 777) {
      const v = lightTimeMin(t, data)!;
      expect(v).toBeGreaterThan(3.0);
      expect(v).toBeLessThan(22.5);
    }
  });
  it('is self-consistent: light time = range / c', () => {
    for (let i = 0; i < data.lightTime.count; i += 97) {
      const fromRange = (data.lightTime.rangeAu[i] * AU_KM) / 299_792.458 / 60;
      expect(data.lightTime.oneWayMin[i]).toBeCloseTo(fromRange, 3);
    }
  });
});

describe('independent Horizons cross-check (second query type)', () => {
  // EPHEM_TYPE=VECTORS, CENTER=500@499, COMMAND=399, VEC_CORR=LT, VEC_TABLE=3 (fetched 2026-11-14; LT in s, RG in km).
  // Different table, different light-time handling than the OBSERVER 20,21 series stored in earth_link.json.
  const checks = [
    { when: Date.UTC(2026, 10, 15), ltSec: 656.7204579890854, rangeKm: 196879840.3194336 },
    { when: Date.UTC(2033, 5, 1), ltSec: 255.980239586004, rangeKm: 76740945.22491701 },
  ];
  for (const c of checks) {
    it(`matches on ${new Date(c.when).toISOString().slice(0, 10)}`, () => {
      // vector epochs are TDB (about 69 s after UT): worth < 0.003 min at these range rates
      expect(lightTimeMin(c.when, data)!).toBeCloseTo(c.ltSec / 60, 2);
      expect(Math.abs(lightTimeMin(c.when, data)! - c.ltSec / 60)).toBeLessThan(0.002);
      expect(Math.abs(earthRangeAu(c.when, data)! - c.rangeKm / AU_KM)).toBeLessThan(1e-5); // 69 s TDB-UT offset x 14.7 km/s = 1000 km = 6.8e-6 au
    });
  }
  it('2026-11-15 light time is 10.95 min one-way', () => {
    expect(lightTimeMin(Date.UTC(2026, 10, 15), data)!).toBeCloseTo(10.9453, 3);
  });
});

describe('Earth in the Jezero sky', () => {
  it('has the Horizons site conventions recorded (west-positive longitude for Mars)', () => {
    expect(data.earthSky.site.lonEastDeg).toBeCloseTo(77.4509, 4);
    expect((data.earthSky as unknown as { horizonsSiteCoord: string }).horizonsSiteCoord).toBe('-77.4509,18.4446,-2.567');
  });
  it('covers 2026-11-01..2027-01-31 (1 h) with a 10 min week inside', () => {
    expect(earthSkyCoverage(data)).toEqual([Date.UTC(2026, 10, 1), Date.UTC(2027, 0, 31, 23)]);
    expect(data.earthSky.series.map((s) => s.stepMin).sort((a, b) => a - b)).toEqual([10, 60]);
  });
  it('is null outside coverage', () => {
    expect(earthSkyAt(Date.UTC(2026, 9, 31), data)).toBeNull();
    expect(earthAboveHorizon(Date.UTC(2027, 1, 5), 0, data)).toBeNull();
    expect(nextEarthRiseSet(Date.UTC(2026, 9, 31), 0, 72, data)).toBeNull();
    expect(earthWindowDuringEva(Date.UTC(2027, 0, 31, 22), 120, 0, data)).toBeNull();
  });
  it('interpolates azimuth across the 0/360 wrap and elevation linearly', () => {
    const fake: EarthLinkData = {
      ...data,
      earthSky: { ...data.earthSky, series: [{ start: '2026-11-15T00:00:00.000Z', stepMin: 60, count: 2, azDeg: [350, 10], elDeg: [10, 20] }] },
    };
    const s = earthSkyAt(Date.UTC(2026, 10, 15, 0, 30), fake)!;
    expect(s.elDeg).toBeCloseTo(15, 9);
    expect(s.azDeg).toBeCloseTo(0, 9);
  });
  it('uses the 10 min grid where it overlaps the 1 h grid', () => {
    const t = Date.UTC(2026, 10, 15, 3, 40);
    const fine = data.earthSky.series.find((s) => s.stepMin === 10)!;
    const i = (t - Date.parse(fine.start)) / (10 * MIN);
    expect(earthSkyAt(t, data)!.elDeg).toBeCloseTo(fine.elDeg[i], 9);
  });
});

describe('horizon logic (2026-11-15 UTC)', () => {
  const t = Date.UTC(2026, 10, 15);
  it('Earth is up at 00:00 and down at 06:00 UTC, matching the stored samples', () => {
    expect(earthAboveHorizon(t, 0, data)).toBe(true);
    expect(earthAboveHorizon(t + 6 * 60 * MIN, 0, data)).toBe(false);
    expect(earthSkyAt(t + 6 * 60 * MIN, data)!.elDeg).toBeLessThan(-20);
    expect(earthAboveHorizon(t, 60, data)).toBe(false); // el ~ 49.5 deg at 00:00
  });
  it('next set is 03:43:54 UTC and next rise 15:01:16 UTC, elevation 0 there', () => {
    const r = nextEarthRiseSet(t, 0, 72, data)!;
    expect(r.aboveNow).toBe(true);
    // independent Horizons 1-minute query (fetched 2026-11-14): set between 03:43 (+0.190 deg) and 03:44 (-0.023 deg)
    // -> 03:43:54; rise between 15:01 (-0.061 deg) and 15:02 (+0.152 deg) -> 15:01:17
    expect(Math.abs(r.setMs! - Date.UTC(2026, 10, 15, 3, 43, 54))).toBeLessThan(10_000);
    expect(Math.abs(r.riseMs! - Date.UTC(2026, 10, 15, 15, 1, 17))).toBeLessThan(10_000);
    expect(r.setMs!).toBeLessThan(r.riseMs!);
    expect(Math.abs(earthSkyAt(r.setMs!, data)!.elDeg)).toBeLessThan(0.01);
    expect(Math.abs(earthSkyAt(r.riseMs!, data)!.elDeg)).toBeLessThan(0.01);
  });
  it('when Earth is down the next event is a rise before the next set', () => {
    const r = nextEarthRiseSet(Date.UTC(2026, 10, 15, 6), 0, 72, data)!;
    expect(r.aboveNow).toBe(false);
    expect(r.riseMs!).toBeLessThan(r.setMs!);
  });
  it('a higher elevation mask shortens the visible time', () => {
    const lo = earthWindowDuringEva(t, 1440, 0, data)!;
    const hi = earthWindowDuringEva(t, 1440, 20, data)!;
    expect(hi.visibleMin).toBeLessThan(lo.visibleMin);
  });
});

describe('earthWindowDuringEva', () => {
  it('splits an 8 h EVA from 01:00 UTC into 164 min of link and a 316 min gap', () => {
    const w = earthWindowDuringEva(Date.UTC(2026, 10, 15, 1), 480, 0, data)!;
    expect(w.segments.map((s) => s.visible)).toEqual([true, false]);
    expect(w.visibleMin).toBeCloseTo(163.9, 0);
    expect(w.gapMin).toBeCloseTo(316.1, 0);
    expect(w.visibleMin + w.gapMin).toBeCloseTo(480, 9);
    expect(w.gaps).toHaveLength(1);
    expect(w.longestGapMin).toBeCloseTo(w.gaps[0].minutes, 9);
    expect(w.segments[0].endMs).toBe(w.segments[1].startMs);
    expect(w.segments[w.segments.length - 1].endMs).toBe(w.endMs);
  });
  it('fully visible and fully dark windows have a single segment', () => {
    const up = earthWindowDuringEva(Date.UTC(2026, 10, 15, 0, 0), 60, 0, data)!;
    expect(up.visibleMin).toBeCloseTo(60, 9);
    expect(up.gaps).toHaveLength(0);
    const down = earthWindowDuringEva(Date.UTC(2026, 10, 15, 6), 120, 0, data)!;
    expect(down.visibleMin).toBe(0);
    expect(down.gaps).toHaveLength(1);
    expect(down.longestGapMin).toBeCloseTo(120, 9);
  });
  it('a window spanning a rise has gap, then link', () => {
    const w = earthWindowDuringEva(Date.UTC(2026, 10, 15, 14), 120, 0, data)!;
    expect(w.segments.map((s) => s.visible)).toEqual([false, true]);
    expect(w.gapMin).toBeCloseTo(61.3, 0);
  });
  it('handles a zero-length EVA', () => {
    const w = earthWindowDuringEva(Date.UTC(2026, 10, 15), 0, 0, data)!;
    expect(w.segments).toHaveLength(1);
    expect(w.segments[0].visible).toBe(true);
  });
});
