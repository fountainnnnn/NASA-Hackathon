'use client';
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { densify } from '@/lib/scene/drape';
import { meshHeightAt } from '@/lib/scene/terrainGrid';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { useHud } from '@/state/hud';
import { useWorld } from '@/state/world';
import { lineY, trueHeight, useScene } from './sceneCtx';

const noRaycast = () => null;
type Pt = [number, number, number];
interface Geo { x: number[]; z: number[]; h: (number | null)[] }

/**
 * Perseverance traverse (1 px solid bone at 45 % opacity, screen-space width) and the landing-ellipse outline, both
 * toggleable layers. The traverse is context for planning views only: hidden while a walk, the helmet or reach is shown.
 */
export function LineLayers() {
  const v = useScene();
  const exag = useWorld((s) => s.exaggeration);
  const layers = useWorld((s) => s.layers);
  const opacity = useWorld((s) => s.layerOpacity);
  const scenario = useHud((h) => h.walkOn || h.reachOn);
  const helmet = useWalkUi((w) => w.helmet);

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
      {layers.traverse && tPts && !scenario && !helmet && (
        <Line points={tPts} color="#ece7e1" lineWidth={1} transparent opacity={0.45 * opacity.traverse} depthWrite={false} renderOrder={6} raycast={noRaycast} />
      )}
      {layers.ellipse && ePts.map((p, i) => p.length > 1 && (
        <Line key={i} points={p} color="#E0884A" lineWidth={2} transparent opacity={opacity.ellipse} raycast={noRaycast} />
      ))}
    </>
  );
}
