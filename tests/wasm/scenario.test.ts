import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadScenarioWasm, type ScenarioWasm, type SlopeGridInput } from '@/lib/scenario/wasm/loader';
import { computeSlopeField } from '@/lib/terrain/slope';
import { sampleElevation, decodeDem } from '@/lib/geo/frame';
import type { Dem, DemMeta } from '@/lib/contracts';

const R = 3_396_190, DEG = Math.PI / 180;
let wasm: ScenarioWasm;

// synthetic test fixture: 200x200 grid at ~20 m posting near Jezero
const FIX = { width: 200, height: 200, lonMin: 77.3, latMax: 18.5, dLon: 0.000337412, dLat: 0.000337412 };
const center = { lon: FIX.lonMin + 100 * FIX.dLon, lat: FIX.latMax - 100 * FIX.dLat };
const grid = (v: number): SlopeGridInput => ({ slope: new Float32Array(FIX.width * FIX.height).fill(v), ...FIX });
const req = (over = {}) => ({ center, semiMajorKm: 1.5, semiMinorKm: 0.8, azimuthDeg: 40, samples: 20_000, maxSlopeDeg: 10, seed: 42, ...over });

beforeAll(async () => {
  const w = await loadScenarioWasm();
  expect(w).not.toBeNull();
  wasm = w!;
});

describe('landing monte carlo (synthetic test fixture)', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = wasm.landingMonteCarlo(req(), grid(5));
    const b = wasm.landingMonteCarlo(req(), grid(5));
    expect(Array.from(a.points)).toEqual(Array.from(b.points));
    expect(a.okFraction).toBe(b.okFraction);
    const c = wasm.landingMonteCarlo(req({ seed: 43 }), grid(5));
    expect(Array.from(c.points)).not.toEqual(Array.from(a.points));
  });

  it('keeps every point inside the rotated ellipse', () => {
    const r = wasm.landingMonteCarlo(req({ samples: 5000 }), grid(5), 2000);
    expect(r.nKept).toBe(2000);
    const az = 40 * DEG;
    for (let i = 0; i < r.nKept; i++) {
      const lon = r.points[3 * i], lat = r.points[3 * i + 1];
      const e = R * Math.cos(center.lat * DEG) * (lon - center.lon) * DEG;
      const n = R * (lat - center.lat) * DEG;
      const along = e * Math.sin(az) + n * Math.cos(az);
      const across = e * Math.cos(az) - n * Math.sin(az);
      const q = (along / 1500) ** 2 + (across / 800) ** 2;
      expect(q).toBeLessThanOrEqual(1 + 1e-4); // float32 point rounding
    }
  });

  it('flat grid gives ok_fraction 1, steep grid gives 0, nodata grid gives nodata 1', () => {
    expect(wasm.landingMonteCarlo(req(), grid(2)).okFraction).toBe(1);
    const steep = wasm.landingMonteCarlo(req(), grid(25));
    expect(steep.okFraction).toBe(0);
    expect(steep.slopeP50).toBeCloseTo(25, 0);
    const nd = wasm.landingMonteCarlo(req(), grid(NaN));
    expect(nd.nodataFraction).toBe(1);
    expect(Number.isNaN(nd.slopeP95)).toBe(true);
  });

  it('percentiles and fractions match a TS reference within histogram resolution', () => {
    const s = new Float32Array(FIX.width * FIX.height);
    for (let r = 0; r < FIX.height; r++) for (let c = 0; c < FIX.width; c++) s[r * FIX.width + c] = (c / FIX.width) * 20; // ramp 0..20 deg
    const g: SlopeGridInput = { slope: s, ...FIX };
    const res = wasm.landingMonteCarlo(req({ samples: 50_000 }), g, 50_000);
    const vals: number[] = [];
    for (let i = 0; i < res.nKept; i++) vals.push(res.points[3 * i + 2]);
    vals.sort((a, b) => a - b);
    expect(res.slopeP50).toBeCloseTo(vals[Math.floor(0.5 * vals.length)], 1);
    expect(Math.abs(res.slopeP95 - vals[Math.floor(0.95 * vals.length)])).toBeLessThan(0.15);
    const ok = vals.filter((v) => v <= 10).length / vals.length;
    expect(res.okFraction).toBeCloseTo(ok, 6);
  });
});

function syntheticDem(w: number, h: number): Dem {
  const meta = { width: w, height: h, lonMin: 77.3, latMax: 18.5, dLon: 0.000337412, dLat: 0.000337412 } as unknown as DemMeta;
  const elev = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) elev[r * w + c] = -2400 + 30 * Math.sin(c / 9) + 20 * Math.cos(r / 7) + 0.4 * c;
  elev[50 * w + 50] = NaN; // nodata hole
  return { meta, elev };
}

function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]) !== Number.isNaN(b[i])) return Infinity;
    if (!Number.isNaN(a[i])) m = Math.max(m, Math.abs(a[i] - b[i]));
  }
  return m;
}

describe('slope_field parity with src/lib/terrain/slope.ts', () => {
  it('synthetic test fixture DEM', () => {
    const dem = syntheticDem(200, 200);
    const ts = computeSlopeField(dem);
    const rs = wasm.slopeField(dem.elev, 200, 200, dem.meta.latMax, dem.meta.dLat, dem.meta.dLon);
    const d = maxDiff(ts, rs);
    console.log(`slope parity synthetic max |diff| = ${d} deg`);
    expect(d).toBeLessThan(1e-3);
  });

  const demPath = join(process.cwd(), 'public/data/dem.i16');
  it.skipIf(!existsSync(demPath))('200x200 crop of the real Jezero DEM', () => {
    const meta = JSON.parse(readFileSync(join(process.cwd(), 'public/data/dem_meta.json'), 'utf8')) as DemMeta;
    const raw = readFileSync(demPath);
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const full = decodeDem(meta, buf);
    const W = 200, c0 = 700, r0 = 600;
    const elev = new Float32Array(W * W);
    for (let r = 0; r < W; r++) for (let c = 0; c < W; c++) elev[r * W + c] = full.elev[(r0 + r) * meta.width + c0 + c];
    const crop: Dem = { meta: { ...meta, width: W, height: W, latMax: meta.latMax - r0 * meta.dLat, lonMin: meta.lonMin + c0 * meta.dLon }, elev };
    const d = maxDiff(computeSlopeField(crop), wasm.slopeField(elev, W, W, crop.meta.latMax, meta.dLat, meta.dLon));
    console.log(`slope parity real DEM crop max |diff| = ${d} deg`);
    expect(d).toBeLessThan(1e-3);
  });
});

describe('benchmark 100k samples', () => {
  it('WASM vs straightforward TS loop (synthetic test fixture)', () => {
    const dem = syntheticDem(FIX.width, FIX.height);
    const slope = computeSlopeField(dem);
    const g: SlopeGridInput = { slope, ...FIX };
    const R_ = req({ samples: 100_000 });
    // warm-up
    wasm.landingMonteCarlo(R_, g, 0);
    const t0 = performance.now();
    const w = wasm.landingMonteCarlo(R_, g, 0);
    const tw = performance.now() - t0;

    const slopeDem: Dem = { meta: { ...dem.meta }, elev: slope };
    const tsRun = () => {
      let s = 42 >>> 0;
      const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const az = 40 * DEG, hist = new Uint32Array(900);
      let ok = 0, nd = 0, valid = 0;
      for (let i = 0; i < R_.samples; i++) {
        const rad = Math.sqrt(rnd()), th = 2 * Math.PI * rnd();
        const da = 1500 * rad * Math.cos(th), db = 800 * rad * Math.sin(th);
        const e = da * Math.sin(az) + db * Math.cos(az), n = da * Math.cos(az) - db * Math.sin(az);
        const lon = center.lon + e / (R * Math.cos(center.lat * DEG) * DEG), lat = center.lat + n / (R * DEG);
        const v = sampleElevation(slopeDem, lon, lat);
        if (v === null) { nd++; continue; }
        valid++; if (v <= 10) ok++;
        hist[Math.min(899, Math.floor(v / 0.1))]++;
      }
      return { ok: ok / R_.samples, nd: nd / R_.samples, valid };
    };
    tsRun();
    const t1 = performance.now();
    const t = tsRun();
    const tt = performance.now() - t1;
    console.log(`BENCH 100k samples: wasm ${tw.toFixed(1)} ms, ts ${tt.toFixed(1)} ms, speedup ${(tt / tw).toFixed(1)}x`);
    // different RNGs, so only statistical agreement
    expect(Math.abs(w.okFraction - t.ok)).toBeLessThan(0.02);
    expect(Math.abs(w.nodataFraction - t.nd)).toBeLessThan(0.02);
  });
});
