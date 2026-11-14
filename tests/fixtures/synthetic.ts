/**
 * Synthetic test fixture — NOT NASA data.
 * Hand-built terrains used only by the terrain-engine unit tests.
 */
import { R_MARS } from '@/lib/contracts';
import type { Dem, DemMeta } from '@/lib/contracts';

const DEG = Math.PI / 180;

export function makeMeta(width: number, height: number, lonC = 77.4, latC = 18.4, resM = 20): DemMeta {
  const dLat = (resM / R_MARS) / DEG;
  const dLon = dLat / Math.cos(latC * DEG);
  return {
    productLabel: 'SYNTHETIC', sourceUrl: 'about:synthetic', width, height,
    lonMin: lonC - (width / 2) * dLon, lonMax: lonC + (width / 2) * dLon,
    latMin: latC - (height / 2) * dLat, latMax: latC + (height / 2) * dLat,
    dLon, dLat, nominalResM: resM,
    encoding: { type: 'int16le', scale: 1, offset: 0, nodata: -32768 },
    file: 'synthetic.i16', elevMin: -3000, elevMax: 0, hRef: -2500, datum: 'synthetic sphere',
  };
}

export const SYN = {
  size: 120,
  base: -2500,
  /** Ridge runs east-west across the whole DEM, centred on this DEM row. */
  ridgeRow: 60,
  /** One gentle saddle in the ridge, centred on this DEM column. */
  saddleCol: 60,
  /** Nodata hole (inclusive pixel ranges) on the south plain. */
  hole: { c0: 90, c1: 95, r0: 90, r1: 95 },
};

/** 120x120 DEM: flat plain (<1 m undulation), steep E-W ridge with one gentle saddle, a nodata hole. */
export function makeSyntheticDem(): Dem {
  const n = SYN.size;
  const meta = makeMeta(n, n);
  const elev = new Float32Array(n * n);
  const sigma = 6; // cells
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const across = (r - SYN.ridgeRow) / sigma;
      const ridgeH = 300 * (1 - 0.95 * Math.exp(-(((c - SYN.saddleCol) / 20) ** 2)));
      elev[r * n + c] = SYN.base + ridgeH * Math.exp(-across * across) + 0.5 * Math.sin(c / 7) * Math.cos(r / 9);
    }
  }
  const h = SYN.hole;
  for (let r = h.r0; r <= h.r1; r++) for (let c = h.c0; c <= h.c1; c++) elev[r * n + c] = NaN;
  return { meta, elev };
}

/** Plane z = gx·x_east + gy·y_north (metres, per-row dx like the slope code). */
export function makeInclinedPlaneDem(gx: number, gy: number, n = 40): Dem {
  const meta = makeMeta(n, n);
  const elev = new Float32Array(n * n);
  const dy = R_MARS * meta.dLat * DEG;
  for (let r = 0; r < n; r++) {
    const lat = (meta.latMax - (r + 0.5) * meta.dLat) * DEG;
    const dx = R_MARS * Math.cos(lat) * meta.dLon * DEG;
    for (let c = 0; c < n; c++) elev[r * n + c] = -2000 + gx * c * dx + gy * (n - 1 - r) * dy;
  }
  return { meta, elev };
}

/** Smooth pseudo-random terrain with gradients well under 15 degrees (for performance tests). */
export function makeSmoothDem(n: number, seed = 1): Dem {
  const meta = makeMeta(n, n);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 6 }, () => rnd() * 6.28);
  const elev = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      elev[r * n + c] = -2500 +
        150 * Math.sin(c / 150 + p[0]) * Math.cos(r / 125 + p[1]) +
        60 * Math.sin(c / 35 + p[2]) * Math.sin(r / 45 + p[3]) +
        8 * Math.sin((c + r) / 9 + p[4]);
    }
  }
  return { meta, elev };
}
