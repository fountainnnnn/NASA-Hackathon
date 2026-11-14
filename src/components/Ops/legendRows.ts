/** Which legend rows apply right now (pure, unit-tested in tests/ops/legendRows.test.ts). */
import type { RouteResult } from '@/lib/contracts';
import { REVEAL_DELAY_S } from '@/components/Planet/descent';

/** During a landing the legend sits top left, under the phase caption (46 px tall at top 8 px, Planet/planet.module.css). */
export const LANDING_LEGEND_TOP_PX = 8 + 46 + 6;

/** Rows of the landing legend that apply at simulated time `t` (pure, tested): dots only once the scatter is on screen. */
export function landingLegendRows(t: number, edlEndS: number): { dots: boolean } {
  return { dots: edlEndS > 0 && t >= edlEndS + REVEAL_DELAY_S };
}

/** Rows of the Jezero legend that apply (pure, tested): nothing about routes when no route is shown. */
export function jezeroLegendRows(o: { route: RouteResult | null; highlights: number; traverse: boolean; scenario: boolean; hirise: boolean; close: boolean }): {
  route: boolean; fails: boolean; traverse: boolean; imagery: string | null;
} {
  const r = o.route;
  const limit = r?.constraintsUsed.maxSlopeDeg ?? Infinity;
  const fails = !!r && (o.highlights > 0 || r.legs.some((l) => (l.segSlopeDeg ?? []).some((d) => d >= limit)));
  return {
    route: !!r && r.legs.some((l) => l.path.length > 1),
    fails: !!r && r.legs.some((l) => l.path.length > 1) && fails,
    traverse: o.traverse && !o.scenario,
    imagery: o.hirise ? 'Imagery: HiRISE 1.3 m per pixel (MRO, Mars 2020 basemap)' : o.close ? 'Imagery: CTX 6 m per pixel' : null,
  };
}
