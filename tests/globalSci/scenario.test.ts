// Scenario engine tests on synthetic slope grids (synthetic test fixture, not Mars data).
import { describe, expect, it } from 'vitest';
import { R_MARS } from '../../src/lib/contracts';
import type { LandingScenarioRequest } from '../../src/lib/globeContracts';
import {
  clearScenarios, createRng, getScenario, gridSlopeSource, hasScenarioSource, putScenario, registerScenarioSources, runLandingScenario,
  runScenarioTs, sampleOffset, walkScenario, offsetToLonLat, wrapLon,
} from '../../src/lib/scenario';
import type { ScenarioGrid, SlopeSource } from '../../src/lib/scenario';
import { DEFAULT_CONSTRAINTS } from '../../src/lib/contracts';

const D2R = Math.PI / 180;

/** 0.5 x 0.5 degree box around (77.5, 18.4) filled with a constant slope. */
const constGrid = (slope: number, nodataLeftOfLon?: number): ScenarioGrid => {
  const w = 100, h = 100, dLon = 0.005, dLat = 0.005, lonMin = 77.25, latMax = 18.65;
  const a = new Float32Array(w * h).fill(slope);
  if (nodataLeftOfLon != null) for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (lonMin + (c + 0.5) * dLon < nodataLeftOfLon) a[r * w + c] = NaN;
  return { width: w, height: h, lonMin, latMax, dLon, dLat, wrapLon: false, slope: a, demResM: 20 };
};
const req = (over: Partial<LandingScenarioRequest> = {}): LandingScenarioRequest => ({
  center: { lon: 77.5, lat: 18.4 }, semiMajorKm: 3.85, semiMinorKm: 3.3, azimuthDeg: 40, samples: 10_000, maxSlopeDeg: 15, seed: 7, dem: 'jezero20m', ...over,
});

describe('PRNG', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng(1), b = createRng(1), c = createRng(2);
    const sa = Array.from({ length: 5 }, () => a.next()), sb = Array.from({ length: 5 }, () => b.next()), sc = Array.from({ length: 5 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('uniform mean ~0.5 and gaussian mean/sd ~ N(0,1)', () => {
    const r = createRng(99);
    let su = 0, sg = 0, sg2 = 0; const n = 20000;
    for (let i = 0; i < n; i++) { su += r.next(); const g = r.gauss(); sg += g; sg2 += g * g; }
    expect(su / n).toBeCloseTo(0.5, 1);
    expect(sg / n).toBeCloseTo(0, 1);
    expect(sg2 / n).toBeCloseTo(1, 1);
  });
});

describe('ellipse sampling', () => {
  it.each(['gaussian', 'uniform'] as const)('%s offsets stay inside the rotated ellipse', (dist) => {
    const rng = createRng(5);
    const a = 3850, b = 3300;
    for (let i = 0; i < 5000; i++) {
      const o = sampleOffset(rng, a, b, 40, dist);
      expect((o.u / a) ** 2 + (o.v / b) ** 2).toBeLessThanOrEqual(1 + 1e-9);
      // frame check: projecting (east, north) back on the rotated axes recovers (u, v)
      const az = 40 * D2R;
      expect(o.eastM * Math.sin(az) + o.northM * Math.cos(az)).toBeCloseTo(o.u, 6);
    }
  });
  it('scenario touchdown points (lon/lat) stay inside the ellipse', () => {
    const q = req({ samples: 3000, azimuthDeg: 110 });
    const seen: [number, number][] = [];
    const src: SlopeSource = { demResM: 20, slopeDegAt: (lon, lat) => { seen.push([lon, lat]); return 1; } };
    runScenarioTs(q, src);
    expect(seen.length).toBe(3000);
    const az = q.azimuthDeg * D2R, cosLat = Math.cos(q.center.lat * D2R);
    for (const [lon, lat] of seen) {
      const e = (lon - q.center.lon) * D2R * R_MARS * cosLat / 1000, n = (lat - q.center.lat) * D2R * R_MARS / 1000;
      const u = e * Math.sin(az) + n * Math.cos(az), v = e * Math.cos(az) - n * Math.sin(az);
      expect((u / q.semiMajorKm) ** 2 + (v / q.semiMinorKm) ** 2).toBeLessThanOrEqual(1.01);
    }
  });
  it('gaussian is concentrated near the centre, uniform is not', () => {
    const med = (dist: 'gaussian' | 'uniform') => {
      const r = createRng(3); const d: number[] = [];
      for (let i = 0; i < 4000; i++) { const o = sampleOffset(r, 3000, 3000, 0, dist); d.push(Math.hypot(o.u, o.v)); }
      return d.sort((x, y) => x - y)[2000];
    };
    expect(med('gaussian')).toBeLessThan(med('uniform') * 0.7);
  });
  it('wraps longitude across the antimeridian', () => {
    expect(wrapLon(181)).toBeCloseTo(-179);
    expect(wrapLon(-181)).toBeCloseTo(179);
    const p = offsetToLonLat({ lon: 179.99, lat: 0 }, 5000, 0);
    expect(p.lon).toBeLessThan(-179);
    expect(offsetToLonLat({ lon: 0, lat: 89.9 }, 0, 50000).lat).toBeLessThanOrEqual(90);
  });
});

describe('runScenarioTs', () => {
  it('is deterministic: same seed -> identical result (points included)', () => {
    const src = gridSlopeSource(constGrid(10));
    const a = runScenarioTs(req(), src), b = runScenarioTs(req(), src), c = runScenarioTs(req({ seed: 8 }), src);
    expect(Array.from(a.points)).toEqual(Array.from(b.points));
    expect({ ...a, computeMs: 0, points: null }).toEqual({ ...b, computeMs: 0, points: null });
    expect(Array.from(a.points)).not.toEqual(Array.from(c.points));
  });
  it('flat terrain -> okFraction ~1, steep -> ~0', () => {
    expect(runScenarioTs(req(), gridSlopeSource(constGrid(2))).okFraction).toBeCloseTo(1, 5);
    const steep = runScenarioTs(req(), gridSlopeSource(constGrid(30)));
    expect(steep.okFraction).toBeCloseTo(0, 5);
    expect(steep.slopeP50).toBeCloseTo(30, 3);
  });
  it('maxSlopeDeg is inclusive and slopes decide the fraction (tilted field)', () => {
    // slope = 0 west of lon 77.5, 20 east: about half the touchdowns pass a 15 deg limit
    const g = constGrid(0);
    for (let r = 0; r < g.height; r++) for (let c = 0; c < g.width; c++) if (g.lonMin + (c + 0.5) * g.dLon >= 77.5) g.slope[r * g.width + c] = 20;
    const res = runScenarioTs(req({ azimuthDeg: 0 }), gridSlopeSource(g));
    expect(res.okFraction).toBeGreaterThan(0.45);
    expect(res.okFraction).toBeLessThan(0.55);
    expect(runScenarioTs(req({ maxSlopeDeg: 20, azimuthDeg: 0 }), gridSlopeSource(g)).okFraction).toBeCloseTo(1, 5);
  });
  it('counts nodata, including draws that fall outside the grid', () => {
    const half = runScenarioTs(req(), gridSlopeSource(constGrid(1, 77.5)));
    expect(half.nodataFraction).toBeGreaterThan(0.4);
    expect(half.nodataFraction).toBeLessThan(0.6);
    expect(half.okFraction + half.nodataFraction).toBeCloseTo(1, 5);
    const outside = runScenarioTs(req({ center: { lon: 10, lat: 10 } }), gridSlopeSource(constGrid(1)));
    expect(outside.nodataFraction).toBe(1);
    expect(outside.okFraction).toBe(0);
    expect(Number.isNaN(outside.slopeP50)).toBe(true);
  });
  it('packs at most 2000 points as [lon, lat, slope]', () => {
    const big = runScenarioTs(req({ samples: 12_345 }), gridSlopeSource(constGrid(3)));
    expect(big.points.length).toBe(2000 * 3);
    expect(big.samples).toBe(12_345);
    const small = runScenarioTs(req({ samples: 300 }), gridSlopeSource(constGrid(3)));
    expect(small.points.length).toBe(300 * 3);
    for (let i = 0; i < small.points.length; i += 3) {
      expect(Math.abs(small.points[i] - 77.5)).toBeLessThan(0.2);
      expect(small.points[i + 2]).toBeCloseTo(3, 4);
    }
    expect(big.engine).toBe('ts');
    expect(big.demResM).toBe(20);
  });
  it('percentiles are monotone and computeMs reported', () => {
    const g = constGrid(0);
    for (let i = 0; i < g.slope.length; i++) g.slope[i] = (i % 100) * 0.3;
    const r = runScenarioTs(req(), gridSlopeSource(g));
    expect(r.slopeP95).toBeGreaterThanOrEqual(r.slopeP50);
    expect(r.computeMs).toBeGreaterThanOrEqual(0);
  });
  it('benchmark: 10k samples on a 10k-cell grid is fast', () => {
    const t0 = performance.now();
    const r = runScenarioTs(req({ samples: 10_000 }), gridSlopeSource(constGrid(5)));
    const wall = performance.now() - t0;
    console.log(`[bench] 10,000 samples, ts engine: computeMs=${r.computeMs.toFixed(1)} wall=${wall.toFixed(1)}`);
    expect(wall).toBeLessThan(1500);
  });
});

describe('runLandingScenario adapter', () => {
  it('uses the registered source and the TS engine by default', async () => {
    registerScenarioSources({ jezero20m: gridSlopeSource(constGrid(2)) });
    expect(hasScenarioSource('jezero20m')).toBe(true);
    const r = await runLandingScenario(req());
    expect(r.engine).toBe('ts');
    expect(r.okFraction).toBeCloseTo(1, 5);
  });
  it('throws a clear error when no source is registered for the DEM', async () => {
    await expect(runLandingScenario(req({ dem: 'global' }))).rejects.toThrow(/No slope data/);
  });
  it('falls back to TS when the WASM engine throws, and tags wasm results when it works', async () => {
    const { registerWasmEngine } = await import('../../src/lib/scenario');
    registerWasmEngine({ run: () => { throw new Error('boom'); } });
    expect((await runLandingScenario(req())).engine).toBe('ts');
    registerWasmEngine({ run: (q) => ({ samples: q.samples, okFraction: 0.5, slopeP50: 1, slopeP95: 2, nodataFraction: 0, points: new Float32Array(3), engine: 'ts', computeMs: 1, demResM: 20 }) });
    const w = await runLandingScenario(req());
    expect(w.engine).toBe('wasm');
    expect(w.okFraction).toBe(0.5);
    registerWasmEngine(null);
  });
});

describe('scenario store + walkScenario', () => {
  it('stores scenarios by id', () => {
    clearScenarios();
    const q = req();
    const rec = putScenario(q, runScenarioTs(q, gridSlopeSource(constGrid(1))));
    expect(rec.id).toBe('S1');
    expect(getScenario('S1')?.request.seed).toBe(7);
    expect(getScenario('nope')).toBeUndefined();
  });
  it('walkScenario is out_of_bounds outside the Jezero tile and delegates inside', async () => {
    const bounds = { lonMin: 77, lonMax: 78, latMin: 18, latMax: 19 };
    const calls: unknown[] = [];
    const terrain = { planRoute: async (r: unknown) => { calls.push(r); return { ok: true } as never; } };
    const out = await walkScenario({ from: { lon: 10, lat: 10 }, to: { lon: 77.5, lat: 18.5 }, constraints: DEFAULT_CONSTRAINTS }, terrain, bounds);
    expect(out.status).toBe('out_of_bounds');
    expect(calls.length).toBe(0);
    const ok = await walkScenario({ from: { lon: 77.4, lat: 18.4 }, to: { lon: 77.5, lat: 18.5 }, constraints: DEFAULT_CONSTRAINTS }, terrain, bounds);
    expect(ok.status).toBe('ok');
    expect(calls.length).toBe(1);
  });
});
