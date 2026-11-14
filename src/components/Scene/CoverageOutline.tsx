'use client';
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { meshHeightAt } from '@/lib/scene/terrainGrid';
import { useWorld } from '@/state/world';
import { useScene } from './sceneCtx';

const noRaycast = () => null;
type Pt = [number, number, number];

/** Thin, subtle outline of the high-resolution (20 m DEM) coverage, draped on the patch's outer edge. */
export function CoverageOutline() {
  const { grid, context } = useScene();
  const exag = useWorld((s) => s.exaggeration);
  const pts = useMemo<Pt[]>(() => {
    if (!context) return [];
    const r = context.patchRect, step = 120, out: Pt[] = [];
    const add = (x: number, z: number) => out.push([x, meshHeightAt(grid, x, z, exag) + 6, z]);
    for (let x = r.xMin; x < r.xMax; x += step) add(x, r.zMin);
    for (let z = r.zMin; z < r.zMax; z += step) add(r.xMax, z);
    for (let x = r.xMax; x > r.xMin; x -= step) add(x, r.zMax);
    for (let z = r.zMax; z > r.zMin; z -= step) add(r.xMin, z);
    out.push(out[0]);
    return out;
  }, [grid, context, exag]);
  if (pts.length < 2) return null;
  return <Line points={pts} color="#f4efea" lineWidth={1} transparent opacity={0.3} depthWrite={false} renderOrder={5} raycast={noRaycast} />;
}
