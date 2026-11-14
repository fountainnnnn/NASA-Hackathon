'use client';
import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type * as THREE from 'three';
import type { TerrainGrid } from '@/lib/scene/terrainGrid';
import type { Runtime } from '@/state/services';

export interface SceneCtxValue {
  rt: Runtime;
  grid: TerrainGrid;
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
