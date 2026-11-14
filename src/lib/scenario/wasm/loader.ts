import type { LandingScenarioRequest } from '@/lib/globeContracts';

/** Slope grid in the DEM frame (degrees, NaN = nodata, row 0 = north, pixel centres at +0.5). */
export interface SlopeGridInput {
  slope: Float32Array;
  width: number; height: number;
  lonMin: number; latMax: number; dLon: number; dLat: number;
}

/** Unpacked WASM Monte-Carlo result. NaN percentiles mean no valid samples. */
export interface LandingMonteCarloRaw {
  okFraction: number; nodataFraction: number; slopeP50: number; slopeP95: number;
  nKept: number;
  /** packed [lon, lat, slopeDeg] x nKept; slope is NaN for nodata draws */
  points: Float32Array;
}

export interface ScenarioWasm {
  landingMonteCarlo(
    req: Pick<LandingScenarioRequest, 'center' | 'semiMajorKm' | 'semiMinorKm' | 'azimuthDeg' | 'samples' | 'maxSlopeDeg' | 'seed'>,
    grid: SlopeGridInput,
    keepPoints?: number,           // default min(samples, 2000)
  ): LandingMonteCarloRaw;
  /** Horn slope (degrees), per-row dx; matches src/lib/terrain/slope.ts. dLat/dLon in degrees. */
  slopeField(elev: Float32Array, width: number, height: number, latMax: number, dLat: number, dLon: number): Float32Array;
}

const WASM_URL = '/wasm/scenario_bg.wasm';
let cached: Promise<ScenarioWasm | null> | null = null;

async function readWasmBytes(): Promise<BufferSource | Response> {
  if (typeof window === 'undefined') {
    // Node (SSR, Vitest): read from disk. webpackIgnore keeps these out of client bundles.
    const fs = await import(/* webpackIgnore: true */ 'node:fs/promises');
    const path = await import(/* webpackIgnore: true */ 'node:path');
    const buf = await fs.readFile(path.join(process.cwd(), 'public', 'wasm', 'scenario_bg.wasm'));
    return new Uint8Array(buf);
  }
  const res = await fetch(WASM_URL);
  if (!res.ok) throw new Error(`fetch ${WASM_URL}: ${res.status}`);
  return res;
}

async function init(): Promise<ScenarioWasm | null> {
  try {
    const mod = await import('./scenario.js');
    const src = await readWasmBytes();
    await mod.default({ module_or_path: src });
    return {
      landingMonteCarlo(req, g, keepPoints) {
        const keep = keepPoints ?? Math.min(req.samples, 2000);
        const seed = BigInt.asUintN(64, BigInt(Math.trunc(req.seed)));
        const out = mod.landing_monte_carlo(
          g.slope, g.width, g.height, g.lonMin, g.latMax, g.dLon, g.dLat,
          req.center.lon, req.center.lat, req.semiMajorKm, req.semiMinorKm, req.azimuthDeg,
          req.samples >>> 0, req.maxSlopeDeg, seed, keep >>> 0,
        );
        const nKept = out[4];
        return {
          okFraction: out[0], nodataFraction: out[1], slopeP50: out[2], slopeP95: out[3],
          nKept, points: out.slice(5, 5 + nKept * 3),
        };
      },
      slopeField(elev, width, height, latMax, dLat, dLon) {
        return mod.slope_field(elev, width, height, latMax, dLat, dLon);
      },
    };
  } catch {
    return null;
  }
}

/** Loads and initialises the scenario WASM once. Never throws; resolves null on any failure. SSR-safe (no work at import time). */
export function loadScenarioWasm(): Promise<ScenarioWasm | null> {
  if (!cached) cached = init();
  return cached;
}
