/**
 * Ruler ticks along a route: a short tick every 100 m of path and a longer tick every 10 minutes of moving time,
 * so distance and time can be read off the ground (design system, signature 1). Long ticks are labelled with the mission
 * elapsed time at that point ("T+01:00"). Pure, testable.
 */
import { sampleAtOdometer } from './model';
import type { Timeline } from './model';

export interface RulerTick {
  kind: 'distance' | 'time';
  odometerM: number;
  x: number; z: number; h: number;
  /** unit vector perpendicular to the path in the xz plane */
  nx: number; nz: number;
  label: string | null;
}

/** Mission elapsed time at a long tick, "T+01:00" (hours and minutes since the EVA start, dwell included). */
export const tickLabel = (elapsedS: number) => { const m = Math.max(0, Math.round(elapsedS / 60)); return `T+${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export function rulerTicks(tl: Timeline, opts: { everyM?: number; everyMin?: number } = {}): RulerTick[] {
  const everyM = opts.everyM ?? 100, everyMin = opts.everyMin ?? 10;
  const out: RulerTick[] = [];
  const fwd = tl.segs.filter((s) => !s.reversed);
  const total = fwd.length ? fwd[fwd.length - 1].d1 : 0;
  const mk = (kind: RulerTick['kind'], odo: number, label: string | null) => {
    const s = sampleAtOdometer(tl, odo);
    if (!s) return;
    out.push({ kind, odometerM: odo, x: s.x, z: s.z, h: s.h, nx: Math.cos(s.headingRad), nz: Math.sin(s.headingRad), label });
  };
  for (let d = everyM; d < total; d += everyM) mk('distance', d, null);
  // time ticks: accumulate MOVING time (dwell excluded) along the forward path
  let moving = 0, nextMin = everyMin;
  for (const s of fwd) {
    if (s.kind === 'dwell') continue;
    const dur = (s.t1 - s.t0) / 60;
    while (moving + dur >= nextMin && dur > 0) {
      const f = (nextMin - moving) / dur;
      mk('time', s.d0 + (s.d1 - s.d0) * f, tickLabel(s.t0 + (s.t1 - s.t0) * f));
      nextMin += everyMin;
    }
    moving += dur;
  }
  return out;
}
