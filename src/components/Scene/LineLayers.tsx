'use client';
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { densify } from '@/lib/scene/drape';
import { meshHeightAt } from '@/lib/scene/terrainGrid';
import { useWorld } from '@/state/world';
import { lineY, trueHeight, useScene } from './sceneCtx';

const noRaycast = () => null;
type Pt = [number, number, number];
interface Geo { x: number[]; z: number[]; h: (number | null)[] }

/** Traverse polyline (thin white dashed) and landing-ellipse outline (ochre), both toggleable layers. */
export function LineLayers() {
  const v = useScene();
  const exag = useWorld((s) => s.exaggeration);
  const layers = useWorld((s) => s.layers);
  const opacity = useWorld((s) => s.layerOpacity);

  const build = (pts: { lon: number; lat: number }[]): Geo => {
    const g: Geo = { x: [], z: [], h: [] };
    for (const p of pts) {
      const l = v.rt.geo.toLocal(v.rt.meta, p.lon, p.lat);
      g.x.push(l.x); g.z.push(l.z); g.h.push(trueHeight(v, p.lon, p.lat));
    }
    return g;
  };
  const traverse = useMemo(() => {
    const pts = v.rt.traverse?.points ?? [];
    return pts.length > 1 ? build(densify(pts, 25).pts) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.rt.traverse]);
  const ellipse = useMemo(() => (v.rt.ellipse ?? []).map((ring) => build(densify(ring.map(([lon, lat]) => ({ lon, lat })), 25).pts)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [v.rt.ellipse]);

  const toPts = (g: Geo, offset: number): Pt[] => {
    const meshH = (x: number, z: number) => meshHeightAt(v.grid, x, z, exag);
    return g.x.map((x, i) => [x, lineY(v, x, g.z[i], g.h[i], exag, offset, meshH), g.z[i]]);
  };
  const tPts = useMemo(() => (traverse ? toPts(traverse, 2) : null), // eslint-disable-next-line react-hooks/exhaustive-deps
    [traverse, exag]);
  const ePts = useMemo(() => ellipse.map((g) => toPts(g, 2)), // eslint-disable-next-line react-hooks/exhaustive-deps
    [ellipse, exag]);

  return (
    <>
      {layers.traverse && tPts && (
        <Line points={tPts} color="#ffffff" lineWidth={1.6} dashed dashSize={35} gapSize={30} transparent opacity={opacity.traverse} raycast={noRaycast} />
      )}
      {layers.ellipse && ePts.map((p, i) => p.length > 1 && (
        <Line key={i} points={p} color="#E0884A" lineWidth={2} transparent opacity={opacity.ellipse} raycast={noRaycast} />
      ))}
    </>
  );
}
