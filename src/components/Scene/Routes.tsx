'use client';
import { useEffect, useMemo } from 'react';
import type { Annotation, RouteResult } from '@/lib/contracts';
import { densify } from '@/lib/scene/drape';
import { meshHeightAt } from '@/lib/scene/terrainGrid';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { useHud } from '@/state/hud';
import { useWorld } from '@/state/world';
import { Marker } from './Pins';
import { GroundRibbon } from './GroundRibbon';
import { useWalkTimeline } from '@/components/Ops/useWalk';
import { useThrottledT } from '@/state/playback';
import { MarkLine } from './MarkLine';
import { setNearFade } from './lineFx';
import { lineY, renderedGroundAt, trueHeight, useScene } from './sceneCtx';
import type { SceneCtxValue } from './sceneCtx';
import { getOps } from '@/app/opsCache';
import { issueNumber } from '@/components/Ops/routeOps';

const OCHRE = '#E0884A', CYAN = '#5CC8FF', GREY = '#6a645f', RED = '#d9423b';

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

/** Screen dash patterns (px): caution dashed, no-go short hatch, grey beyond the turn-back point, cyan for alternates. */
const DASH = { caution: [9, 6], nogo: [4, 3], grey: [6, 6], alt: [10, 6] } as const;

/**
 * Route marks. Planning views: 1.5 px ochre, a little above the true DEM so it reads from orbit; only the failing stretch is
 * red and hatched (dash pattern as well as colour), no casing. Helmet view: the same line draped on the rendered ground
 * (0.3 m up) so it lies under the walker's boots, and it fades out within a few metres of the eye.
 */
function RouteLines({ route, style, geoms, exag, helmet, ribbon }: { route: RouteResult; style: 'primary' | 'alternate'; geoms: LegGeom[]; exag: number; helmet: boolean; ribbon: RibbonLeg | null }) {
  const v = useScene();
  const pieces = useMemo(() => {
    const meshH = (x: number, z: number) => meshHeightAt(v.grid, x, z, exag);
    const tb = route.turnBackIndex;
    const limit = route.constraintsUsed.maxSlopeDeg;
    const out: { pts: Pt[]; grey: boolean; status: Status; leg: number; startS: number }[] = [];
    geoms.forEach((g, li) => {
      const pts: Pt[] = g.x.map((x, i) => [x, helmet ? renderedGroundAt(v, x, g.z[i], exag) + 0.3 * exag : lineY(v, x, g.z[i], g.h[i], exag, 3, meshH), g.z[i]]);
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
        let startS = 0;
        for (let i = 1; i <= a; i++) startS += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
        out.push({ pts: pts.slice(a, b + 1), grey, status: st, leg: li, startS });
      };
      for (let i = 1; i < pts.length - 1; i++) {
        const st = statusAt(i);
        if (st !== cur || i === cutAt) { push(startI, i, cur); startI = i; cur = st; }
      }
      push(startI, pts.length - 1, cur);
    });
    return out;
  }, [geoms, exag, route, v, helmet]);
  const alt = style === 'alternate';
  const ground = useMemo(() => (x: number, z: number) => renderedGroundAt(v, x, z, exag), [v, exag]);
  if (ribbon) {
    // helmet view: the leg being walked, painted on the ground at 0.4 m world width, chevrons every 10 m pointing the way
    const legLen = (li: number) => { const g = geoms[li]; let d = 0; for (let i = 1; i < g.x.length; i++) d += Math.hypot(g.x[i] - g.x[i - 1], g.z[i] - g.z[i - 1]); return d; };
    const len = legLen(ribbon.leg);
    return (
      <group>
        {pieces.filter((p) => p.leg === ribbon.leg).map((p, i) => {
          const segLen = p.pts.reduce((d, q, k) => (k ? d + Math.hypot(q[0] - p.pts[k - 1][0], q[2] - p.pts[k - 1][2]) : 0), 0);
          const pts = ribbon.reversed ? [...p.pts].reverse() : p.pts;
          const startS = ribbon.reversed ? len - p.startS - segLen : p.startS;
          const color = p.grey ? GREY : alt ? CYAN : STATUS_COLOR[p.status];
          const rs = p.grey || alt ? 'dashed' : p.status === 'nogo' ? 'hatched' : p.status === 'caution' ? 'dashed' : 'solid';
          return <GroundRibbon key={`${ribbon.leg}-${ribbon.reversed}-${i}`} points={pts} color={color} style={rs} startS={startS} ground={ground} />;
        })}
      </group>
    );
  }
  return (
    <group>
      {pieces.map((p, i) => {
        const dash = p.grey ? DASH.grey : alt ? DASH.alt : p.status === 'nogo' ? DASH.nogo : p.status === 'caution' ? DASH.caution : null;
        const color = p.grey ? GREY : alt ? CYAN : STATUS_COLOR[p.status];
        return <MarkLine key={i} points={p.pts} color={color} width={1.5} dashPx={dash ? [dash[0], dash[1]] : null} renderOrder={11} />;
      })}
    </group>
  );
}

/** A flagged stretch (comms shadow, steepest part): red, hatched, 1.5 px, numbered marker. Ground-draped in helmet view. */
function Highlight({ ann, n, route, geoms, exag, helmet, hideMarker, ribbon }: { ann: Annotation; n: number; route: RouteResult; geoms: LegGeom[]; exag: number; helmet: boolean; hideMarker: boolean; ribbon: RibbonLeg | null }) {
  const v = useScene();
  const h = ann.highlight!;
  const g = geoms[h.leg];
  const pts = useMemo(() => {
    if (!g) return [] as Pt[];
    const meshH = (x: number, z: number) => meshHeightAt(v.grid, x, z, exag);
    const a = g.vertexIndex[h.startIdx] ?? 0, b = g.vertexIndex[h.endIdx] ?? g.x.length - 1;
    const out: Pt[] = [];
    for (let i = a; i <= b; i++) out.push([g.x[i], helmet ? renderedGroundAt(v, g.x[i], g.z[i], exag) + 0.35 * exag : lineY(v, g.x[i], g.z[i], g.h[i], exag, 3.2, meshH), g.z[i]]);
    return out;
  }, [g, h.startIdx, h.endIdx, exag, v, helmet]);
  const ground = useMemo(() => (x: number, z: number) => renderedGroundAt(v, x, z, exag), [v, exag]);
  if (pts.length < 2 || !route) return null;
  // helmet view: the flagged stretch is a red hatched band on the ground (no marker, no screen line)
  if (ribbon) return ribbon.leg === h.leg ? <GroundRibbon points={ribbon.reversed ? [...pts].reverse() : pts} color={RED} style="hatched" liftM={0.08} ground={ground} renderOrder={12} /> : null;
  // the numbered label marks where the red stretch starts (where the crew loses contact), lifted a little off the line
  const start = pts[0];
  return (
    <>
      <MarkLine points={pts} color={RED} width={1.5} dashPx={[DASH.nogo[0], DASH.nogo[1]]} renderOrder={21} />
      {!hideMarker && <Marker pos={[start[0], start[1] + 6 * exag, start[2]]} kind="hazard" label={`${n}. ${ann.label}`} tone="num" />}
    </>
  );
}

/** The leg the walker is on in helmet view (and whether it is walked backwards, on the way home). */
interface RibbonLeg { leg: number; reversed: boolean }
function useHelmetLeg(on: boolean): RibbonLeg | null {
  const tl = useWalkTimeline();
  const t = useThrottledT(2);
  if (!on || !tl) return null;
  const seg = tl.segs.find((g) => t >= g.t0 && t < g.t1) ?? tl.segs[tl.segs.length - 1];
  return seg ? { leg: seg.leg, reversed: !!seg.reversed } : null;
}

export function Routes() {
  const v = useScene();
  const routes = useWorld((s) => s.routes);
  const visible = useWorld((s) => s.visibleRouteIds);
  const styles = useWorld((s) => s.routeStyles);
  const annotations = useWorld((s) => s.annotations);
  const exag = useWorld((s) => s.exaggeration);
  const helmet = useWalkUi((w) => w.helmet);
  // during a walk (chase camera, helmet) the line lies on the rendered ground: lifted 3 m it would float beside the crew
  const draped = useHud((h) => h.walkOn) || helmet;
  // helmet view: marks fade in between 6 m and 30 m from the eye. Seen from eye height the path ahead projects onto the
  // middle of the view; faded like this it starts as a short ground line below the horizon instead of a bar from the boots up
  useEffect(() => { setNearFade(helmet ? 6 : 0, helmet ? 30 : 0); }, [helmet]);
  const highlights = annotations.filter((a) => a.kind === 'highlight' && a.highlight);
  const ribbon = useHelmetLeg(helmet);
  const activeId = useHud((h) => h.activeRouteId);
  return (
    <>
      {visible.map((id) => {
        const r = routes[id];
        return r ? <RouteLines key={id} route={r} style={styles[id] ?? 'primary'} geoms={legGeoms(v, r)} exag={exag} helmet={draped} ribbon={ribbon && activeId === id ? ribbon : null} /> : null;
      })}
      {highlights.map((a, i) => {
        const r = routes[a.highlight!.routeId];
        // a radio shadow carries the number comms has in the ordered issue list (card rows and headline), not its draw order
        const n = (/^Radio shadow/.test(a.label) ? issueNumber(getOps(r?.id ?? null)?.order ?? [], 'comms') : null) ?? i + 1;
        return r && visible.includes(r.id) ? <Highlight key={a.id} ann={a} n={n} route={r} geoms={legGeoms(v, r)} exag={exag} helmet={draped} hideMarker={helmet} ribbon={ribbon && activeId === r.id ? ribbon : null} /> : null;
      })}
    </>
  );
}
