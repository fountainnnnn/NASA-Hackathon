/**
 * Ruler ticks along a route: a short tick every 100 m of path and a longer tick every 10 minutes of moving time,
 * so distance and time can be read off the ground (design system, signature 1). Pure, testable.
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
      mk('time', s.d0 + (s.d1 - s.d0) * f, `${nextMin} min`);
      nextMin += everyMin;
    }
    moving += dur;
  }
  return out;
}
