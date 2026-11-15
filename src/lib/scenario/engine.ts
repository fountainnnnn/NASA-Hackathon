/**
 * TypeScript Monte-Carlo landing-dispersion engine (reference + fallback for the Rust/WASM crate).
 *
 * Dispersion model (documented choice): touchdown offsets are a 2-D Gaussian in the ellipse frame with
 * 3 sigma = the ellipse semi-axes (so the published ellipse is the ~99% dispersion bound), truncated at the
 * ellipse by rejection (about 1.1% of draws). `distribution: 'uniform'` samples the ellipse area uniformly.
 * The semi-axes are the ellipse's, major axis along `azimuthDeg` (clockwise from north).
 */
import { R_MARS } from '../contracts';
import type { LandingScenarioRequest, LandingScenarioResult } from '../globeContracts';
import { createRng } from './prng';
import type { RunningCounts, ScenarioOptions, SlopeSource } from './types';

const D2R = Math.PI / 180;
export const MAX_RENDER_POINTS = 2000;

export function wrapLon(lon: number): number {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (l === -180 && lon > 0) l = 180;
  return l;
}

/** East/north offsets (m) from the ellipse centre -> lon/lat. */
export function offsetToLonLat(center: { lon: number; lat: number }, eastM: number, northM: number) {
  const lat = center.lat + (northM / R_MARS) / D2R;
  const cosLat = Math.max(Math.cos(center.lat * D2R), 1e-6);
  const lon = center.lon + (eastM / (R_MARS * cosLat)) / D2R;
  return { lon: wrapLon(lon), lat: Math.max(-90, Math.min(90, lat)) };
}

/** Draws one touchdown offset (east, north) in metres. Exposed for tests. */
export function sampleOffset(
  rng: ReturnType<typeof createRng>, aM: number, bM: number, azimuthDeg: number, distribution: 'gaussian' | 'uniform',
): { eastM: number; northM: number; u: number; v: number } {
  let u: number, v: number; // u along the major axis, v along the minor axis, metres
  if (distribution === 'uniform') {
    const r = Math.sqrt(rng.next());
    const th = 2 * Math.PI * rng.next();
    u = aM * r * Math.cos(th); v = bM * r * Math.sin(th);
  } else {
    for (;;) {
      u = (aM / 3) * rng.gauss(); v = (bM / 3) * rng.gauss();
      if ((u / aM) ** 2 + (v / bM) ** 2 <= 1) break;
    }
  }
  const az = azimuthDeg * D2R;
  // major axis unit vector (east, north) = (sin az, cos az); minor = (cos az, -sin az)
  return { eastM: u * Math.sin(az) + v * Math.cos(az), northM: u * Math.cos(az) - v * Math.sin(az), u, v };
}

function percentile(sorted: Float32Array, n: number, q: number): number {
  if (n === 0) return NaN;
  const idx = (n - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function runScenarioTs(req: LandingScenarioRequest, source: SlopeSource, opts: ScenarioOptions = {}): LandingScenarioResult & { running: RunningCounts } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const distribution = opts.distribution ?? 'gaussian';
  const n = Math.max(1, Math.floor(req.samples));
  const rng = createRng(req.seed);
  const aM = req.semiMajorKm * 1000, bM = req.semiMinorKm * 1000;
  const keep = Math.min(n, MAX_RENDER_POINTS);
  const points = new Float32Array(keep * 3);
  const valid = new Float32Array(n);
  // running tallies at each kept point, so the playback counter is exact (playback.ts)
  const running: RunningCounts = { runs: new Uint32Array(keep), ok: new Uint32Array(keep), nodata: new Uint32Array(keep) };
  let nValid = 0, nOk = 0, nNodata = 0;
  // keep an evenly spaced subset of draws for rendering, so the picture is an unbiased sample
  for (let i = 0; i < n; i++) {
    const o = sampleOffset(rng, aM, bM, req.azimuthDeg, distribution);
    const p = offsetToLonLat(req.center, o.eastM, o.northM);
    const s = source.slopeDegAt(p.lon, p.lat);
    const has = s != null && Number.isFinite(s);
    if (has) { valid[nValid++] = s as number; if ((s as number) <= req.maxSlopeDeg) nOk++; } else nNodata++;
    const slot = Math.floor(((i + 1) * keep) / n);
    if (slot > Math.floor((i * keep) / n)) {
      const k = (slot - 1) * 3;
      points[k] = p.lon; points[k + 1] = p.lat; points[k + 2] = has ? (s as number) : NaN;
      running.runs[slot - 1] = i + 1; running.ok[slot - 1] = nOk; running.nodata[slot - 1] = nNodata;
    }
  }
  const sorted = valid.subarray(0, nValid);
  sorted.sort();
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    samples: n,
    okFraction: nOk / n,
    slopeP50: percentile(sorted, nValid, 0.5),
    slopeP95: percentile(sorted, nValid, 0.95),
    nodataFraction: nNodata / n,
    points,
    engine: 'ts',
    computeMs: now - t0,
    demResM: source.demResM,
    running,
  };
}
