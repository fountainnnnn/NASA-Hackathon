import { R_MARS } from '@/lib/contracts';
import type { Dem, LonLat, PlanningGrid } from '@/lib/contracts';

const DEG = Math.PI / 180;

/**
 * Planning grid at 2x coarsening (40 m). elev = mean of the 2x2 block (NaN if any NaN);
 * slopeMaxDeg = MAX of the four 20 m slopes (conservative; NaN if any is NaN, so cells next to
 * nodata or on the DEM border are treated as unusable). Odd trailing row/column is dropped.
 */
export function buildPlanningGrid(dem: Dem, slope: Float32Array): PlanningGrid {
  const { meta, elev } = dem;
  const W = Math.floor(meta.width / 2), H = Math.floor(meta.height / 2);
  const ge = new Float32Array(W * H);
  const gs = new Float32Array(W * H);
  const w = meta.width;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i0 = 2 * r * w + 2 * c;
      const i1 = i0 + 1, i2 = i0 + w, i3 = i2 + 1;
      const m = (elev[i0] + elev[i1] + elev[i2] + elev[i3]) / 4; // NaN propagates
      let s = Math.max(slope[i0], slope[i1], slope[i2], slope[i3]);
      const anyNaN = slope[i0] !== slope[i0] || slope[i1] !== slope[i1] || slope[i2] !== slope[i2] || slope[i3] !== slope[i3];
      if (anyNaN) s = NaN;
      ge[r * W + c] = m;
      gs[r * W + c] = s;
    }
  }
  return {
    width: W, height: H, lonMin: meta.lonMin, latMax: meta.latMax,
    dLon: meta.dLon * 2, dLat: meta.dLat * 2, elev: ge, slopeMaxDeg: gs, cellResM: meta.nominalResM * 2,
  };
}

/** Lon/lat of the centre of planning cell (c, r). */
export function gridCellLonLat(grid: PlanningGrid, c: number, r: number): LonLat {
  return { lon: grid.lonMin + (c + 0.5) * grid.dLon, lat: grid.latMax - (r + 0.5) * grid.dLat };
}

/** Planning cell containing lon/lat, or null if outside the grid. */
export function gridLonLatToCell(grid: PlanningGrid, lon: number, lat: number): { c: number; r: number } | null {
  const c = Math.floor((lon - grid.lonMin) / grid.dLon);
  const r = Math.floor((grid.latMax - lat) / grid.dLat);
  if (!(c >= 0 && c < grid.width && r >= 0 && r < grid.height)) return null;
  return { c, r };
}

/** East-west ground spacing (m) of row r (per-row dx). */
export function gridDxM(grid: PlanningGrid, r: number): number {
  const lat = (grid.latMax - (r + 0.5) * grid.dLat) * DEG;
  return R_MARS * Math.cos(lat) * grid.dLon * DEG;
}

/** North-south ground spacing (m). */
export function gridDyM(grid: PlanningGrid): number {
  return R_MARS * grid.dLat * DEG;
}
