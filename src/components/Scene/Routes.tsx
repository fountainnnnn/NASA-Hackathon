'use client';
import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { Annotation, RouteResult } from '@/lib/contracts';
import { densify } from '@/lib/scene/drape';
import { meshHeightAt } from '@/lib/scene/terrainGrid';
import { useWorld } from '@/state/world';
import { Marker } from './Pins';
import { lineY, trueHeight, useScene } from './sceneCtx';
import type { SceneCtxValue } from './sceneCtx';

const OCHRE = '#F2A65A', CYAN = '#5CC8FF', GREY = '#9AA0A6', RED = '#FF4D4D';
const noRaycast = () => null;

interface LegGeom { x: number[]; z: number[]; h: (number | null)[]; vertexIndex: number[] }
const cache = new WeakMap<RouteResult, LegGeom[]>();

function legGeoms(v: SceneCtxValue, r: RouteResult): LegGeom[] {
  const hit = cache.get(r);
  if (hit) return hit;
  const out = r.legs.map((leg) => {
    const { pts, vertexIndex } = densify(leg.path, 10);
    const x: number[] = [], z: number[] = [], h: (number | null)[] = [];
    for (const p of pts) {
      const l = v.rt.geo.toLocal(v.rt.meta, p.lon, p.lat);
      x.push(l.x); z.push(l.z); h.push(trueHeight(v, p.lon, p.lat));
    }
    return { x, z, h, vertexIndex };
  });
  cache.set(r, out);
  return out;
}

type Pt = [number, number, number];

function RouteLines({ route, style, geoms, exag }: { route: RouteResult; style: 'primary' | 'alternate'; geoms: LegGeom[]; exag: number }) {
  const v = useScene();
  const pieces = useMemo(() => {
    const meshH = (x: number, z: number) => meshHeightAt(v.grid, x, z, exag);
    const tb = route.turnBackIndex;
    const out: { pts: Pt[]; grey: boolean }[] = [];
    geoms.forEach((g, li) => {
      const pts: Pt[] = g.x.map((x, i) => [x, lineY(v, x, g.z[i], g.h[i], exag, 3, meshH), g.z[i]]);
      if (pts.length < 2) return;
      if (!tb || li < tb.leg) out.push({ pts, grey: false });
      else if (li > tb.leg) out.push({ pts, grey: true });
      else {
        const cut = Math.min(pts.length - 1, Math.max(1, g.vertexIndex[Math.min(tb.vertex, g.vertexIndex.length - 1)] ?? 1));
        out.push({ pts: pts.slice(0, cut + 1), grey: false });
        if (cut < pts.length - 1) out.push({ pts: pts.slice(cut), grey: true });
      }
    });
    return out;
  }, [geoms, exag, route, v]);
  const color = style === 'primary' ? OCHRE : CYAN;
  return (
    <>
      {pieces.map((p, i) => (
        <group key={i}>
          <Line points={p.pts} color="#0b0809" lineWidth={7} transparent opacity={0.55} raycast={noRaycast} />
          <Line
            points={p.pts} color={p.grey ? GREY : color} lineWidth={4} raycast={noRaycast}
            dashed={style === 'alternate' && !p.grey} dashSize={60} gapSize={40}
          />
        </group>
      ))}
    </>
  );
}

function Highlight({ ann, n, route, geoms, exag }: { ann: Annotation; n: number; route: RouteResult; geoms: LegGeom[]; exag: number }) {
  const v = useScene();
  const h = ann.highlight!;
  const g = geoms[h.leg];
  const pts = useMemo(() => {
    if (!g) return [] as Pt[];
    const meshH = (x: number, z: number) => meshHeightAt(v.grid, x, z, exag);
    const a = g.vertexIndex[h.startIdx] ?? 0, b = g.vertexIndex[h.endIdx] ?? g.x.length - 1;
    const out: Pt[] = [];
    for (let i = a; i <= b; i++) out.push([g.x[i], lineY(v, g.x[i], g.z[i], g.h[i], exag, 4, meshH), g.z[i]]);
    return out;
  }, [g, h.startIdx, h.endIdx, exag, v]);
  if (pts.length < 2 || !route) return null;
  const mid = pts[pts.length >> 1];
  return (
    <>
      <Line points={pts} color="#0b0809" lineWidth={10} transparent opacity={0.6} raycast={noRaycast} />
      <Line points={pts} color={RED} lineWidth={6} raycast={noRaycast} />
      <Marker pos={[mid[0], mid[1] + 6 * exag, mid[2]]} kind="hazard" label={`${n}. ${ann.label}`} tone="num" />
    </>
  );
}

export function Routes() {
  const v = useScene();
  const routes = useWorld((s) => s.routes);
  const visible = useWorld((s) => s.visibleRouteIds);
  const styles = useWorld((s) => s.routeStyles);
  const annotations = useWorld((s) => s.annotations);
  const exag = useWorld((s) => s.exaggeration);
  const highlights = annotations.filter((a) => a.kind === 'highlight' && a.highlight);
  return (
    <>
      {visible.map((id) => {
        const r = routes[id];
        return r ? <RouteLines key={id} route={r} style={styles[id] ?? 'primary'} geoms={legGeoms(v, r)} exag={exag} /> : null;
      })}
      {highlights.map((a, i) => {
        const r = routes[a.highlight!.routeId];
        return r && visible.includes(r.id) ? <Highlight key={a.id} ann={a} n={i + 1} route={r} geoms={legGeoms(v, r)} exag={exag} /> : null;
      })}
    </>
  );
}
