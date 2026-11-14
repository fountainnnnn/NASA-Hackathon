'use client';
import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type * as THREE from 'three';
import type { TerrainGrid } from '@/lib/scene/terrainGrid';
import { groundHeight } from './contextGrid';
import type { ContextScene } from './contextGrid';
import type { Runtime } from '@/state/services';

export interface SceneCtxValue {
  rt: Runtime;
  grid: TerrainGrid;
  /** Regional apron around the patch; null when the context data is not loaded. */
  context: ContextScene | null;
  meshRef: RefObject<THREE.Mesh | null>;
}
export const SceneCtx = createContext<SceneCtxValue | null>(null);
export function useScene() {
  const v = useContext(SceneCtx);
  if (!v) throw new Error('useScene outside SceneCtx');
  return v;
}

/** World-space position (metres) of a lon/lat standing just above the rendered mesh. */
export function surfacePos(
  v: SceneCtxValue, lon: number, lat: number, exag: number, offsetM: number, meshHeight: (x: number, z: number) => number,
): [number, number, number] {
  const { x, z } = v.rt.geo.toLocal(v.rt.meta, lon, lat);
  return [x, meshHeight(x, z) + offsetM * exag, z];
}

/** True-DEM height (m, absolute) for draping, falling back to null when nodata. */
export function trueHeight(v: SceneCtxValue, lon: number, lat: number): number | null {
  return v.rt.geo.sampleElevation(v.rt.dem, lon, lat);
}

/**
 * Line y for a draped vertex: true DEM height (h − hRef + offset)·exag, but never below the rendered
 * (coarser) mesh, so lines are not buried between mesh vertices.
 */
export function lineY(v: SceneCtxValue, x: number, z: number, h: number | null, exag: number, offsetM: number, meshH: (x: number, z: number) => number): number {
  const mesh = meshH(x, z) + 1 * exag;
  if (h == null) return mesh + offsetM * exag;
  return Math.max((h - v.rt.meta.hRef + offsetM) * exag, mesh);
}

/** Exaggerated, hRef-relative ground height anywhere in the scene (patch inside its rectangle, apron outside). */
export function groundAt(v: SceneCtxValue, x: number, z: number, exag: number): number {
  return groundHeight(v.grid, v.context, x, z, exag);
}

/**
 * Height of the rendered terrain triangles (not the bilinear patch): the mesh splits each cell along the (i+1, j) to
 * (i, j+1) diagonal, so objects that stand on the ground (crew, rover, habitat, draped lines) sit exactly on what is drawn.
 */
export function renderedGroundAt(v: SceneCtxValue, x: number, z: number, exag: number): number {
  const g = v.grid;
  let fx = (x - g.x0) / g.dx, fz = (z - g.z0) / g.dz;
  if (v.context && (fx < 0 || fz < 0 || fx > g.nx - 1 || fz > g.nz - 1)) return groundAt(v, x, z, exag);
  fx = Math.min(Math.max(fx, 0), g.nx - 1.000001);
  fz = Math.min(Math.max(fz, 0), g.nz - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, h = g.heights;
  const a = h[j * g.nx + i], b = h[(j + 1) * g.nx + i], c = h[j * g.nx + i + 1], d = h[(j + 1) * g.nx + i + 1];
  const y = tx + tz <= 1 ? a + tx * (c - a) + tz * (b - a) : d + (1 - tx) * (b - d) + (1 - tz) * (c - d);
  return y * exag;
}
