import { R_MARS } from '@/lib/contracts';
import type { Dem, LonLat, TerrainAnalysis } from '@/lib/contracts';
import { lonLatToPixel, sampleElevation } from '../geo/frame';

const DEG = Math.PI / 180;

/** Terrain statistics within radiusM of center, from the 20 m slope field (cells whose centre is inside the disc). */
export function analyzeTerrain(dem: Dem, slope: Float32Array, req: { center: LonLat; radiusM: number; limitDeg: number }): TerrainAnalysis {
  const { meta, elev } = dem;
  const { center, radiusM, limitDeg } = req;
  const base = {
    center, radiusM, limitDeg, demResM: meta.nominalResM,
    elevationM: sampleElevation(dem, center.lon, center.lat),
  };
  const dy = R_MARS * meta.dLat * DEG;
  const { c: pc, r: pr } = lonLatToPixel(meta, center.lon, center.lat);
  const rr = Math.ceil(radiusM / dy) + 1;
  const r0 = Math.max(0, Math.floor(pr) - rr), r1 = Math.min(meta.height - 1, Math.ceil(pr) + rr);
  let total = 0, valid = 0, above = 0, sum = 0, max = 0, zmin = Infinity, zmax = -Infinity;
  const vals: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const lat = meta.latMax - (r + 0.5) * meta.dLat;
    const dx = R_MARS * Math.cos(lat * DEG) * meta.dLon * DEG;
    const cr = Math.ceil(radiusM / dx) + 1;
    const c0 = Math.max(0, Math.floor(pc) - cr), c1 = Math.min(meta.width - 1, Math.ceil(pc) + cr);
    const ny = (r - pr) * dy;
    for (let c = c0; c <= c1; c++) {
      const nx = (c - pc) * dx;
      if (nx * nx + ny * ny > radiusM * radiusM) continue;
      total++;
      const i = r * meta.width + c;
      const z = elev[i];
      if (z === z) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      const s = slope[i];
      if (s !== s) continue;
      valid++; sum += s; vals.push(s);
      if (s > max) max = s;
      if (s > limitDeg) above++;
    }
  }
  vals.sort((a, b) => a - b);
  const p90 = vals.length ? vals[Math.min(vals.length - 1, Math.floor(0.9 * vals.length))] : 0;
  return {
    ...base,
    reliefM: zmax >= zmin ? zmax - zmin : 0,
    slopeMeanDeg: valid ? sum / valid : 0,
    slopeP90Deg: p90,
    slopeMaxDeg: max,
    pctAboveLimit: valid ? (above / valid) * 100 : 0,
    validPct: total ? (valid / total) * 100 : 0,
    note: valid
      ? `Horn 3x3 slopes on the ${meta.nominalResM} m DEM over ${valid} cells; slope at this posting understates steeper local relief.`
      : 'No valid slope cells within this radius (nodata or outside the DEM).',
  };
}
