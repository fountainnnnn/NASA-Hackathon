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

const OCHRE = '#E0884A', CYAN = '#5CC8FF', GREY = '#6a645f', RED = '#d9423b';
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

/** Slope status of a stretch: solid ochre, dashed caution, hatched no-go. Style carries it as well as colour. */
type Status = 'ok' | 'caution' | 'nogo';
const STATUS_COLOR: Record<Status, string> = { ok: OCHRE, caution: '#f3d250', nogo: '#d9423b' };

function RouteLines({ route, style, geoms, exag }: { route: RouteResult; style: 'primary' | 'alternate'; geoms: LegGeom[]; exag: number }) {
  const v = useScene();
  const pieces = useMemo(() => {
    const meshH = (x: number, z: number) => meshHeightAt(v.grid, x, z, exag);
    const tb = route.turnBackIndex;
    const limit = route.constraintsUsed.maxSlopeDeg;
    const out: { pts: Pt[]; grey: boolean; status: Status }[] = [];
    geoms.forEach((g, li) => {
      const pts: Pt[] = g.x.map((x, i) => [x, lineY(v, x, g.z[i], g.h[i], exag, 3, meshH), g.z[i]]);
      if (pts.length < 2) return;
      const seg = route.legs[li]?.segSlopeDeg ?? [];
      // status of the dense segment i -> i + 1, from the planner's per-vertex-segment slope
      const statusAt = (i: number): Status => {
        let s = 0;
        while (s + 1 < g.vertexIndex.length - 1 && g.vertexIndex[s + 1] <= i) s++;
        const d = seg[s] ?? 0;
        return d >= limit ? 'nogo' : d >= 0.8 * limit ? 'caution' : 'ok';
      };
      const cutAt = tb && li === tb.leg ? Math.min(pts.length - 1, Math.max(1, g.vertexIndex[Math.min(tb.vertex, g.vertexIndex.length - 1)] ?? 1)) : -1;
      let startI = 0, cur = statusAt(0);
      const push = (a: number, b: number, st: Status) => {
        if (b <= a) return;
        const grey = !!tb && (li > tb.leg || (li === tb.leg && a >= cutAt));
        out.push({ pts: pts.slice(a, b + 1), grey, status: st });
      };
      for (let i = 1; i < pts.length - 1; i++) {
        const st = statusAt(i);
        if (st !== cur || i === cutAt) { push(startI, i, cur); startI = i; cur = st; }
      }
      push(startI, pts.length - 1, cur);
    });
    return out;
  }, [geoms, exag, route, v]);
  const alt = style === 'alternate';
  return (
    <>
      {pieces.map((p, i) => {
        const dash = p.grey || alt || p.status === 'caution' ? { dashed: true, dashSize: 24, gapSize: 16 } : p.status === 'nogo' ? { dashed: true, dashSize: 6, gapSize: 5 } : {};
        const color = p.grey ? GREY : alt ? CYAN : STATUS_COLOR[p.status];
        return (
          <group key={i}>
            {/* both transparent + explicit renderOrder, so the keyline is drawn first and never tints the route colour */}
            <Line points={p.pts} color="#060505" lineWidth={3.5} transparent opacity={0.7} depthWrite={false} renderOrder={10} raycast={noRaycast} {...dash} />
            <Line points={p.pts} color={color} lineWidth={p.status === 'nogo' ? 2.5 : 1.5} transparent depthWrite={false} renderOrder={11} raycast={noRaycast} {...dash} />
          </group>
        );
      })}
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
      <Line points={pts} color="#2a0606" lineWidth={5} transparent opacity={0.8} depthWrite={false} renderOrder={20} raycast={noRaycast} />
      <Line points={pts} color={RED} lineWidth={3} transparent depthWrite={false} renderOrder={21} raycast={noRaycast} />
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
