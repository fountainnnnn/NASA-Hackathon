import { beforeAll, describe, expect, it } from 'vitest';
import { createGlobalScience, decodeRaster, pointInUnwrapped, ringsBBox, sampleBilinear, slopeHorn, unwrapRing, gcDistanceKm } from '../../src/lib/globalSci';
import type { CriteriaFile } from '../../src/lib/globalSci';
import { evaluateLanding } from '../../src/lib/globalSci/landing';
import type { SiteConditions } from '../../src/lib/globeContracts';
import { readFileSync } from 'node:fs';
import { H, W, elevFn, fixtureFetch, geology, makeDemBuffer } from './fixtures';

const criteriaFile = JSON.parse(readFileSync('public/data/global/landing_criteria.json', 'utf8')) as CriteriaFile;

describe('conditionsAt (synthetic test fixture)', () => {
  const sci = createGlobalScience(fixtureFetch(), '/data/global');
  beforeAll(async () => { await sci.load(); });

  it('loads gz DEM, layers, geology, sites, criteria and EDL', () => {
    expect(sci.loaded).toBe(true);
    expect(sci.edlPhases().length).toBeGreaterThan(5);
    expect(sci.defaultEllipse()?.semiMajorKm).toBeCloseTo(3.85);
  });

  it('bilinear elevation matches the analytic field at a cell centre and between cells', () => {
    const c = sci.conditionsAt(10.5, 20.5);
    expect(c.elevationM).toBeCloseTo(elevFn(10.5, 20.5), 0);
    const mid = sci.conditionsAt(11, 21).elevationM as number;
    expect(Math.abs(mid - elevFn(11, 21))).toBeLessThan(2);
  });

  it('wraps longitude at +-180 (no seam)', () => {
    const a = sci.conditionsAt(180, 0).elevationM as number;
    const b = sci.conditionsAt(-180, 0).elevationM as number;
    const c = sci.conditionsAt(179.9, 0).elevationM as number;
    const d = sci.conditionsAt(-179.9, 0).elevationM as number;
    expect(a).toBeCloseTo(b, 6);
    expect(Math.abs(a - c)).toBeLessThan(2);
    expect(Math.abs(a - d)).toBeLessThan(2);
    expect(sci.conditionsAt(540, 0).point.lon).toBeCloseTo(-180);
    // slope across the seam is finite and small (cos field is flat there)
    const s = sci.conditionsAt(180, 0).slopeDeg;
    expect(s).not.toBeNull();
    expect(s as number).toBeLessThan(1);
  });

  it('handles the poles: elevation clamps, slope is filled (estimate or mock) with a note', () => {
    for (const lat of [90, -90, 89.99]) {
      const c = sci.conditionsAt(30, lat);
      expect(c.elevationM).not.toBeNull();
      expect(c.slopeDeg).not.toBeNull();
      expect(['estimate', 'mock']).toContain(c.fills?.slope?.provenance);
      expect(c.notes.join(' ')).toMatch(/polar/i);
    }
  });

  it('slope of a pure latitude ramp uses the raster posting (per-row dx / dy)', () => {
    // d(elev)/d(lat) = 10 m per degree = 10 m / 59.27 km  ->  ~0.0097 deg
    const s = sci.conditionsAt(0.5, 0.5).slopeDeg as number; // d/dlon of cos is ~0 at lon 0 -> only the lat ramp
    const expected = (Math.atan(10 / ((Math.PI / 180) * 3396190)) * 180) / Math.PI;
    expect(s).toBeGreaterThan(expected * 0.9);
    expect(s).toBeLessThan(expected * 1.1);
  });

  it('reports layer values with units, null for nodata, and Jezero flag + notes', () => {
    const c = sci.conditionsAt(77.5, 18.4);
    const ti = c.layers.find((l) => l.id === 'thermalInertia')!;
    expect(ti.value).toBe(160);
    expect(ti.unit).toBe('J m-2 s-0.5 K-1');
    expect(c.insideJezeroHighRes).toBe(true);
    expect(c.notes.join(' ')).toMatch(/1\.85 km/);
    expect(sci.conditionsAt(-10, 10).insideJezeroHighRes).toBe(false);
    // nodata cell (5,5): filled from the nearest valid cell within 200 km, marked estimate
    const gap = sci.conditionsAt(-174.5, 84.5).layers[0];
    expect(gap.value).not.toBeNull();
    expect(['estimate', 'mock']).toContain(gap.provenance);
  });

  it('finds nearest sites with distance and bearing, and a place name', () => {
    const c = sci.conditionsAt(77.6, 18.5);
    expect(c.nearestSites[0].name).toBe('Jezero Test');
    expect(c.nearestSites[0].distanceKm).toBeLessThan(10);
    expect(c.placeName).toBe('Jezero Test');
    expect(sci.placeName(-100, -30.3)).toBe('Far Test');
    expect(sci.placeName(-100, -27)).toBe('near Far Test');
    expect(sci.placeName(150, 70)).toBeNull();
    expect(sci.sitesNear(77.5, 18.4, 50).map((s) => s.site.id)).toEqual(['jez']);
  });

  it('geology: polygon crossing the antimeridian and a donut with hole', () => {
    expect(sci.conditionsAt(179, 0).geology?.symbol).toBe('Aa');
    expect(sci.conditionsAt(-179, 0).geology?.symbol).toBe('Aa');
    expect(sci.conditionsAt(180, 0).geology?.symbol).toBe('Aa');
    expect(sci.conditionsAt(160, 0).geology?.distanceKm ?? null).toBeNull(); // far from any unit: none within 200 km
    expect(sci.conditionsAt(3.5, 40).geology?.symbol).toBe('Bb');
    expect(sci.conditionsAt(3.5, 40).geology?.distanceKm).toBeUndefined();
    // in the hole: the nearest mapped unit within 200 km stands in, with its distance
    const hole = sci.conditionsAt(0, 40).geology;
    if (hole) expect(hole.distanceKm).toBeGreaterThan(0);
  });

  it('nodata cell: elevation filled from the nearest valid cell, marked estimate', async () => {
    const s2 = createGlobalScience(fixtureFetch({ nodataCell: [100, 50] }));
    await s2.load();
    const c = s2.conditionsAt(-79.5, 39.5); // centre of the nodata cell
    expect(c.elevationM).not.toBeNull();
    expect(c.fills?.elevation?.provenance).toBe('estimate');
    expect(c.notes.join(' ')).toMatch(/nodata/);
    expect(s2.conditionsAt(0, 0).elevationM).not.toBeNull();
  });

  it('degrades to nulls and notes when optional files are missing', async () => {
    const s3 = createGlobalScience(fixtureFetch({ missing: ['geology_global.json', 'ti.u8', 'landing_criteria.json'] }));
    await s3.load();
    const c = s3.conditionsAt(10, 10);
    expect(c.geology).toBeNull();
    expect(c.layers[0].value).not.toBeNull(); // raster missing: labelled mock
    expect(c.layers[0].provenance).toBe('mock');
    expect(s3.checkLandingSite(10, 10).verdict).toBe('insufficient-data'); // only when the criteria file itself is missing
  });
});

describe('raster + geometry helpers', () => {
  it('decodeRaster/sampleBilinear/slopeHorn agree on a plane', () => {
    const buf = makeDemBuffer();
    const r = decodeRaster(buf.buffer as ArrayBuffer, 'int16le', W, H, 1, 0, -32768);
    expect(sampleBilinear(r, 0.5, 0.5)).toBeCloseTo(elevFn(0.5, 0.5), 0);
    expect(slopeHorn(r, 0.5, 0.5)).toBeGreaterThan(0);
    expect(slopeHorn(r, 0, 90)).toBeNull();
  });

  it('unwrapRing / pointInUnwrapped across the antimeridian', () => {
    const ring = unwrapRing(geology.polygons[0].rings[0]);
    expect(Math.max(...ring.map((p) => p[0]))).toBe(190);
    const bbox = ringsBBox([ring]);
    expect(pointInUnwrapped(-175, 0, [ring], bbox)).toBe(true);
    expect(pointInUnwrapped(175, 0, [ring], bbox)).toBe(true);
    expect(pointInUnwrapped(100, 0, [ring], bbox)).toBe(false);
    expect(pointInUnwrapped(-175, 20, [ring], bbox)).toBe(false);
  });

  it('great-circle distance wraps the antimeridian', () => {
    expect(gcDistanceKm(179.5, 0, -179.5, 0)).toBeCloseTo(((Math.PI / 180) * 3396.19), 0);
  });
});

describe('evaluateLanding', () => {
  const cond = (over: Partial<SiteConditions> = {}): SiteConditions => ({
    point: { lon: 0, lat: 0 }, placeName: null, elevationM: -2500, slopeDeg: 1.2, geology: null,
    layers: [{ id: 'thermalInertia', value: 250, unit: 'J m-2 s-0.5 K-1', label: 'TI', source: 's' }],
    nearestSites: [], insideJezeroHighRes: false, notes: [], ...over,
  });
  const run = (c: SiteConditions, lat = 18, resKm: number | null = 1.85) => evaluateLanding(criteriaFile, { lon: 0, lat, conditions: c, demResKm: resKm });

  it('every criterion gets a value and a verdict; rover-scale ones are estimates or mocks', () => {
    const r = run(cond({ slopeDeg: 0.3 }));
    expect(r.criteria.every((c) => c.pass !== null && c.value != null)).toBe(true);
    const byId = Object.fromEntries(r.criteria.map((c) => [c.id, c]));
    for (const id of ['slope-5m', 'slope-20-40m', 'slope-200-500m']) { expect(byId[id].provenance).toBe('estimate'); expect(byId[id].method).toMatch(/Hurst|H = 0\.75/); }
    expect(byId['rock-abundance'].provenance).toBe('mock');
    expect(r.estimated).toBe(true);
    expect(r.notes.join(' ')).toMatch(/rock-abundance|Rock abundance/i);
    expect(['meets-all', 'fails-some']).toContain(r.verdict);
    for (const c of r.criteria) { expect(c.source.url).toMatch(/^https:\/\//); expect(c.limit.length).toBeGreaterThan(3); }
  });

  it('fails-some when any evaluated criterion fails, even with other nulls', () => {
    expect(run(cond({ elevationM: 2500 })).verdict).toBe('fails-some');
    expect(run(cond({ slopeDeg: 4 })).verdict).toBe('fails-some');
    const hiLat = run(cond({ elevationM: null }), 75);
    expect(hiLat.verdict).toBe('fails-some');
    expect(hiLat.criteria.find((c) => c.id === 'latitude')?.pass).toBe(false);
    const dusty = run(cond({ layers: [{ id: 'thermalInertia', value: 40, unit: 'J m-2 s-0.5 K-1', label: 'TI', source: 's' }] }));
    expect(dusty.criteria.find((c) => c.id === 'thermal-inertia')?.pass).toBe(false);
  });

  it('never returns insufficient-data: missing values become deterministic mocks', () => {
    for (const c of [cond({ elevationM: null }), cond({ slopeDeg: null }), cond({ layers: [] })]) {
      const r = run(c);
      expect(['meets-all', 'fails-some']).toContain(r.verdict);
      expect(r.criteria.every((x) => x.pass !== null)).toBe(true);
    }
    const a = run(cond({ elevationM: null })), b = run(cond({ elevationM: null }));
    expect(a.criteria.find((c) => c.id === 'elevation')).toEqual(b.criteria.find((c) => c.id === 'elevation'));
    expect(a.criteria.find((c) => c.id === 'elevation')?.provenance).toBe('mock');
  });

  it('estimates the 2-5 km slope from the MOLA baseline when it is outside that scale', () => {
    const r = run(cond({ slopeDeg: 9 }), 18, 7.4); // 14.8 km baseline
    const s = r.criteria.find((c) => c.id === 'slope-2-5km')!;
    expect(s.provenance).toBe('estimate');
    expect(s.value as number).toBeGreaterThan(9); // shorter baseline, steeper
    expect(s.pass).toBe(false);
    expect(r.verdict).toBe('fails-some');
  });

  it('mocks thermal inertia given in the wrong unit, labelled mock', () => {
    const r = run(cond({ layers: [{ id: 'thermalInertia', value: 0.3, unit: 'K', label: 'TI', source: 's' }] }));
    expect(r.criteria.find((c) => c.id === 'thermal-inertia')?.provenance).toBe('mock');
  });

  it('ellipse comes from the cited Mars 2020 page', () => {
    const r = run(cond());
    expect(r.ellipse.semiMajorKm * 2).toBeCloseTo(7.7);
    expect(r.ellipse.semiMinorKm * 2).toBeCloseTo(6.6);
    expect(r.ellipse.source.url).toContain('science.nasa.gov');
  });
});

describe('curated data files', () => {
  it('EDL phases are ordered, cited and unique', () => {
    const edl = JSON.parse(readFileSync('public/data/global/edl_mars2020.json', 'utf8')) as { phases: { id: string; tStartS: number; tEndS: number; source: { url: string } }[] };
    const ids = new Set(edl.phases.map((p) => p.id));
    expect(ids.size).toBe(edl.phases.length);
    for (let i = 0; i < edl.phases.length; i++) {
      const p = edl.phases[i];
      expect(p.tEndS).toBeGreaterThanOrEqual(p.tStartS);
      expect(p.source.url).toMatch(/^https:\/\/www\.jpl\.nasa\.gov\/news\/press_kits\/mars_2020\//);
      if (i > 0) expect(p.tStartS).toBeGreaterThanOrEqual(edl.phases[i - 1].tStartS);
    }
  });
  it('every criterion quotes its source', () => {
    for (const c of criteriaFile.criteria) expect(c.source.quote?.length).toBeGreaterThan(10);
  });
});
