'use client';
import { useMemo } from 'react';
import { densify } from '@/lib/scene/drape';
import { meshHeightAt } from '@/lib/scene/terrainGrid';
import { useWorld } from '@/state/world';
import { MarkLine } from './MarkLine';
import { useLassoOutline } from './lassoStore';
import { useScene } from './sceneCtx';

/** The persisted lasso: 1 px dashed bone outline draped on the rendered ground. */
export function LassoOutline() {
  const v = useScene();
  const poly = useLassoOutline((s) => s.poly);
  const exag = useWorld((s) => s.exaggeration);
  const pts = useMemo(() => {
    if (!poly || poly.length < 3) return null;
    return densify([...poly, poly[0]], 15).pts.map((p) => {
      const { x, z } = v.rt.geo.toLocal(v.rt.meta, p.lon, p.lat);
      return [x, meshHeightAt(v.grid, x, z, exag) + 2 * exag, z] as [number, number, number];
    });
  }, [poly, v, exag]);
  if (!pts) return null;
  return <MarkLine points={pts} color="#ece7e1" width={1} opacity={0.9} dashPx={[6, 4]} renderOrder={13} />;
}
