/**
 * Regional context terrain ("apron"): the ~463 m MOLA grid around the 20 m CTX DEM patch, in the SAME local frame
 * and with the same exaggeration as the patch (contracts.ts: x = R·cos(latC)·Δlon, z = −R·Δlat, y = (h − hRef)·exag,
 * with the CTX DEM centre and hRef). Pure functions, no three.js scene objects, so they are unit-testable.
 */
import type { Texture } from 'three';
import type { ContextMeta, Dem, DemMeta, GeoApi } from '@/lib/contracts';
import { buildTerrainGrid, meshHeightAt } from '@/lib/scene/terrainGrid';
import type { TerrainGrid } from '@/lib/scene/terrainGrid';

export interface Rect { xMin: number; zMin: number; xMax: number; zMax: number }

/** Decoded context data as loaded by services.ts (texture is the CTX global mosaic crop). */
export interface ContextData { meta: ContextMeta; dem: Dem; texture: Texture }

export interface ContextScene {
  data: ContextData;
  grid: TerrainGrid;      // apron grid, heights already blended onto the patch edge
  patchRect: Rect;        // extent of the high-resolution patch, local metres
  rect: Rect;             // extent of the apron, local metres
}

/** Distance (m) over which apron heights are pulled onto the patch edge heights, so the two surfaces meet. */
export const EDGE_BAND_M = 1500;
/** Width (m) of the patch's colour ramp into the apron imagery. */
export const PATCH_BLEND_M = 1000;
/** The apron hole is the patch rectangle shrunk by this much, so no sliver of sky shows between the surfaces. */
export const HOLE_INSET_M = 30;

export function gridRect(g: Pick<TerrainGrid, 'x0' | 'z0' | 'dx' | 'dz' | 'nx' | 'nz'>): Rect {
  const x1 = g.x0 + (g.nx - 1) * g.dx, z1 = g.z0 + (g.nz - 1) * g.dz;
  return { xMin: Math.min(g.x0, x1), xMax: Math.max(g.x0, x1), zMin: Math.min(g.z0, z1), zMax: Math.max(g.z0, z1) };
}

export const insideRect = (r: Rect, x: number, z: number) => x >= r.xMin && x <= r.xMax && z >= r.zMin && z <= r.zMax;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Bilinear height (hRef-relative, not exaggerated) using only valid vertices; null if none. */
export function validHeightAt(g: TerrainGrid, x: number, z: number): number | null {
  const fx = Math.min(Math.max((x - g.x0) / g.dx, 0), g.nx - 1), fz = Math.min(Math.max((z - g.z0) / g.dz, 0), g.nz - 1);
  const i = Math.min(Math.floor(fx), g.nx - 2), j = Math.min(Math.floor(fz), g.nz - 2);
  const tx = fx - i, tz = fz - j;
  let acc = 0, ws = 0;
  const add = (ii: number, jj: number, w: number) => {
    const k = jj * g.nx + ii;
    if (w > 0 && g.valid[k]) { acc += g.heights[k] * w; ws += w; }
  };
  add(i, j, (1 - tx) * (1 - tz)); add(i + 1, j, tx * (1 - tz)); add(i, j + 1, (1 - tx) * tz); add(i + 1, j + 1, tx * tz);
  if (ws === 0) { // sitting exactly on a nodata vertex: fall back to the valid corners of the cell
    for (const [ii, jj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) add(ii, jj, 1e-6);
  }
  return ws > 0 ? acc / ws : null;
}

/**
 * Pull apron heights onto the patch: inside the patch rectangle the apron takes the patch heights (the apron is
 * discarded there anyway); outside, heights blend from the patch EDGE height at the nearest edge point back to the
 * MOLA value over `bandM`. Result: no cliff where the two meshes meet, even though MOLA and the CTX DEM differ by
 * tens of metres locally. Mutates `apron.heights` and refreshes min/max.
 */
export function blendApronOntoPatch(apron: TerrainGrid, patch: TerrainGrid, bandM = EDGE_BAND_M): void {
  const r = gridRect(patch);
  for (let j = 0; j < apron.nz; j++) {
    const z = apron.z0 + j * apron.dz;
    for (let i = 0; i < apron.nx; i++) {
      const x = apron.x0 + i * apron.dx;
      const cx = Math.min(Math.max(x, r.xMin), r.xMax), cz = Math.min(Math.max(z, r.zMin), r.zMax);
      const d = Math.hypot(x - cx, z - cz);
      if (d >= bandM) continue;
      const target = validHeightAt(patch, cx, cz);
      if (target == null) continue;
      const w = d === 0 ? 1 : 1 - smooth(0, bandM, d);
      const k = j * apron.nx + i;
      apron.heights[k] = apron.heights[k] * (1 - w) + target * w;
    }
  }
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < apron.heights.length; k++) { const h = apron.heights[k]; if (h < mn) mn = h; if (h > mx) mx = h; }
  apron.minH = mn; apron.maxH = mx;
}

/** Build the apron grid in the patch's local frame. `geo` is the shared lon/lat -> local mapping. */
export function buildContextScene(
  data: ContextData, patchMeta: DemMeta, geo: Pick<GeoApi, 'toLocal'>, patch: TerrainGrid,
): ContextScene {
  // the frame (origin, hRef) belongs to the CTX DEM, not to the context grid
  const frame: Pick<GeoApi, 'toLocal'> = { toLocal: (_m, lon, lat) => geo.toLocal(patchMeta, lon, lat) };
  const dem: Dem = {
    meta: { ...data.meta, hRef: patchMeta.hRef, elevMin: patchMeta.elevMin, elevMax: patchMeta.elevMax },
    elev: data.dem.elev,
  };
  const grid = buildTerrainGrid(dem, frame, 512);
  blendApronOntoPatch(grid, patch);
  return { data, grid, patchRect: gridRect(patch), rect: gridRect(grid) };
}

/** Exaggerated ground height at (x, z): patch inside its rectangle, apron elsewhere. hRef-relative. */
export function groundHeight(patch: TerrainGrid, ctx: ContextScene | null, x: number, z: number, exag: number): number {
  if (ctx && !insideRect(ctx.patchRect, x, z)) return meshHeightAt(ctx.grid, x, z, exag);
  return meshHeightAt(patch, x, z, exag);
}
