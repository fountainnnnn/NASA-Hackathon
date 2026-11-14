/** Landing playback maths (pure). EDL phases come from NASA material via the caller; nothing about them is invented here. */
import type { EdlPhase } from '../../lib/globeContracts';

/**
 * ASSUMPTION (visual only): seconds of simulated time after touchdown over which the Monte-Carlo touchdown points
 * appear. The real EDL timeline ends at touchdown; this window is just the reveal animation.
 */
export const LANDING_REVEAL_S = 90;
/** ASSUMPTION (schematic only): the approach comes from this compass bearing relative to the site (270 = from the west). */
export const APPROACH_FROM_BEARING_DEG = 270;
/** ASSUMPTION (schematic only): ground range of the drawn approach arc, km. NOT the mission's entry-to-touchdown range. */
export const APPROACH_RANGE_KM = 650;

export function edlEndS(phases: EdlPhase[]): number {
  return phases.reduce((m, p) => Math.max(m, p.tEndS), 0);
}
export function landingDurationS(phases: EdlPhase[], revealS = LANDING_REVEAL_S): number {
  return edlEndS(phases) + revealS;
}

/**
 * Current clock-timed phase at time t (the last started phase after the end), or null before the first. Phases NASA defines
 * by altitude ("trigger": "altitude", e.g. Terrain-Relative Navigation) are skipped: they do not own a time span.
 */
export function phaseAt(phases: EdlPhase[], t: number): EdlPhase | null {
  let cur: EdlPhase | null = null;
  for (const p of [...phases].sort((a, b) => a.tStartS - b.tStartS)) if (p.tStartS <= t && (p as EdlPhase & { trigger?: string }).trigger !== 'altitude') cur = p;
  return cur;
}

/** Altitude (km) at time t by linear interpolation inside the phase using its cited start/end altitudes. */
export function altitudeKmAt(phases: EdlPhase[], t: number): number | null {
  const p = phaseAt(phases, t);
  if (!p) return phases.length ? phases[0].altitudeKmStart ?? null : null;
  const a = p.altitudeKmStart, b = p.altitudeKmEnd ?? p.altitudeKmStart;
  if (a == null) return b ?? null;
  if (b == null || p.tEndS <= p.tStartS) return a;
  const f = Math.min(1, Math.max(0, (t - p.tStartS) / (p.tEndS - p.tStartS)));
  return a + (b - a) * f;
}

/**
 * Fraction 0..1 along the approach arc. Schematic ease-out (quartic): fast during entry, slow under the parachute and in
 * powered descent, so the discarded heat shield and back shell come down within the touchdown view, up-range of the rover instead of tens of
 * kilometres off, where it sat at the edge of the touchdown view. Visual only, not a trajectory.
 */
export function approachFraction(t: number, endS: number): number {
  if (endS <= 0) return 1;
  const u = Math.min(1, Math.max(0, t / endS));
  return 1 - Math.pow(1 - u, 4);
}

/** Reveal progress 0..1 of the touchdown scatter. */
export function revealProgress(t: number, endS: number, revealS = LANDING_REVEAL_S): number {
  if (revealS <= 0) return t >= endS ? 1 : 0;
  return Math.min(1, Math.max(0, (t - endS) / revealS));
}

export function revealCount(t: number, endS: number, n: number, revealS = LANDING_REVEAL_S): number {
  return Math.floor(revealProgress(t, endS, revealS) * n + 1e-9);
}

/** Pop-in scale for a point that appeared `age` (0..1 of its pop window); ease out with a small overshoot. */
export function popScale(age: number): number {
  if (age <= 0) return 0;
  if (age >= 1) return 1;
  const c1 = 1.2, c3 = c1 + 1;
  return 1 + c3 * Math.pow(age - 1, 3) + c1 * Math.pow(age - 1, 2);
}

/** Unpack the renderable touchdown points. ok = finite slope at or below the limit. */
export function unpackTouchdowns(points: Float32Array, maxSlopeDeg: number): { lon: number; lat: number; slope: number; ok: boolean }[] {
  const out: { lon: number; lat: number; slope: number; ok: boolean }[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const slope = points[i + 2];
    out.push({ lon: points[i], lat: points[i + 1], slope, ok: Number.isFinite(slope) && slope <= maxSlopeDeg });
  }
  return out;
}
