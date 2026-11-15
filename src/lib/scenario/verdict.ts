/**
 * Verdicts for the simulations, in one place (pure, unit-tested in tests/scenario/verdict.test.ts).
 *
 * LANDING RULE, an ASSUMPTION of this tool (not a NASA requirement), applied to the seeded Monte-Carlo touchdowns:
 *   GO     if at least 99 % of touchdowns land on ground at or under the slope limit AND under 1 % fall on cells with no data;
 *   HOLD   if at least 95 % land under the limit (or the 99 % test passes but no data reaches 1 %);
 *   NO GO  otherwise.
 * The 99 % mirrors the published ellipse being the ~99 % dispersion bound (3 sigma) used by the engine; 95 % is the
 * usual "needs a closer look" band. When the terrain cell is wider than the ellipse (global DEM), the slope at each
 * touchdown is the region's slope, so the verdict is marked "(includes estimates)".
 */

export type VerdictWord = 'GO' | 'HOLD' | 'NO GO';
export type VerdictTone = 'go' | 'caution' | 'nogo';

/** Share of touchdowns at or under the slope limit needed for GO (assumption). */
export const LANDING_GO_OK_FRACTION = 0.99;
/** Share of touchdowns at or under the slope limit needed for HOLD (assumption). */
export const LANDING_HOLD_OK_FRACTION = 0.95;
/** GO also needs fewer touchdowns than this on cells with no slope data (assumption). */
export const LANDING_GO_MAX_NODATA_FRACTION = 0.01;
/** The rule as one line, quoted in the formulas, the report and the end event. */
export const LANDING_VERDICT_RULE =
  'GO if ≥ 99 % of touchdowns are within the slope limit and no data < 1 %; HOLD if ≥ 95 % are within it; else NO GO (assumption, not a NASA requirement)';

export const VERDICT_TONE: Record<VerdictWord, VerdictTone> = { GO: 'go', HOLD: 'caution', 'NO GO': 'nogo' };

export interface LandingVerdictInput {
  /** Fraction (0..1) of all touchdowns at or under the slope limit with valid data. */
  okFraction: number;
  /** Fraction (0..1) of touchdowns on cells with no slope data. */
  nodataFraction?: number;
  /** Terrain posting (m) used for the slope at each touchdown. */
  demResM?: number;
  samples?: number;
}

export interface LandingVerdict {
  verdict: VerdictWord;
  /** The verdict word plus " (includes estimates)" when the terrain is coarser than the ellipse. */
  label: string;
  tone: VerdictTone;
  /** One sentence, the limiting reason, with the real numbers. */
  reason: string;
  rule: string;
  /** True when the terrain cell is at least as wide as the ellipse's minor axis. */
  estimated: boolean;
}

const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)} %`;

/** True when a terrain cell of `demResM` is at least as wide as the ellipse (its minor axis, 2 × semi-minor). */
export function terrainCoarserThanEllipse(demResM: number | undefined, ellipse: { semiMinorKm: number } | null | undefined): boolean {
  if (!ellipse || !(demResM != null && demResM > 0)) return false;
  return demResM / 1000 >= 2 * ellipse.semiMinorKm;
}

/**
 * GO / HOLD / NO GO for a landing Monte-Carlo result (LandingScenarioResult or anything with okFraction and
 * nodataFraction). Pass the ellipse to mark "(includes estimates)" when the terrain cell is wider than the ellipse.
 */
export function landingVerdict(result: LandingVerdictInput, ellipse?: { semiMinorKm: number } | null, maxSlopeDeg?: number): LandingVerdict {
  const ok = Number.isFinite(result.okFraction) ? result.okFraction : 0;
  const nd = Number.isFinite(result.nodataFraction ?? NaN) ? (result.nodataFraction as number) : 0;
  const lim = maxSlopeDeg != null ? `${maxSlopeDeg}°` : 'the slope limit';
  let verdict: VerdictWord, reason: string;
  if (ok >= LANDING_GO_OK_FRACTION && nd < LANDING_GO_MAX_NODATA_FRACTION) {
    verdict = 'GO'; reason = `${pct(ok)} of touchdowns land within ${lim} (GO needs 99 %) and ${pct(nd)} have no data.`;
  } else if (ok >= LANDING_HOLD_OK_FRACTION) {
    verdict = 'HOLD';
    reason = ok >= LANDING_GO_OK_FRACTION
      ? `${pct(nd)} of touchdowns fall where there is no slope data (GO needs under 1 %).`
      : `${pct(ok)} of touchdowns land within ${lim}, short of the 99 % for GO.`;
  } else {
    verdict = 'NO GO'; reason = `Only ${pct(ok)} of touchdowns land within ${lim} (HOLD needs 95 %).`;
  }
  const estimated = terrainCoarserThanEllipse(result.demResM, ellipse);
  if (estimated) reason += ' The terrain cell is wider than the ellipse, so the slopes are regional estimates.';
  return { verdict, label: estimated ? `${verdict} (includes estimates)` : verdict, tone: VERDICT_TONE[verdict], reason, rule: LANDING_VERDICT_RULE, estimated };
}

/** Formula lines for the "How I worked it out" list: the rule with the real numbers substituted. */
export function landingVerdictCalc(result: LandingVerdictInput, v: LandingVerdict = landingVerdict(result)): string[] {
  const ok = result.okFraction, nd = result.nodataFraction ?? 0;
  const goOk = ok >= LANDING_GO_OK_FRACTION, goNd = nd < LANDING_GO_MAX_NODATA_FRACTION, hold = ok >= LANDING_HOLD_OK_FRACTION;
  return [
    `verdict rule: ${LANDING_VERDICT_RULE}`,
    `ok ${pct(ok)} ${goOk ? '≥' : '<'} 99 %, no data ${pct(nd)} ${goNd ? '<' : '≥'} 1 %${goOk && goNd ? '' : `, ok ${hold ? '≥' : '<'} 95 %`} → ${v.label}`,
  ];
}

/* ------------------------------------------------------------------ walk, rover assist, base camp */

export interface SimpleVerdict { verdict: VerdictWord; tone: VerdictTone; reason: string }

/**
 * Walk and rover assist: the route's go/no-go board (lib/ops/goNoGo, worst item wins), as the shell's Verdict
 * ({ word, reason }). Without one, the timeline's own feasibility: a turn-back before the target is NO GO.
 */
export function walkVerdict(ops: { word: string; reason: string } | null | undefined, tl: { feasible: boolean; turnBack: { tS: number } | null }): SimpleVerdict {
  if (ops && (ops.word === 'GO' || ops.word === 'HOLD' || ops.word === 'NO GO')) {
    const w = ops.word as VerdictWord;
    return { verdict: w, tone: VERDICT_TONE[w], reason: ops.reason };
  }
  if (tl.turnBack || !tl.feasible) return { verdict: 'NO GO', tone: 'nogo', reason: 'The battery reserve is reached before the target, so the crew turns back.' };
  return { verdict: 'GO', tone: 'go', reason: 'The crew reaches the target and is back with the battery above the reserve.' };
}

/**
 * Base camp reach: GO when there is ground the crew can walk out to and still get home with the reserve, NO GO when
 * nothing is reachable. Comms is not part of reach (it is checked per route), and the reason says so.
 */
export function reachVerdict(areaKm2: number, farthestM: number): SimpleVerdict {
  if (!(areaKm2 > 0.005) || !(farthestM > 0)) return { verdict: 'NO GO', tone: 'nogo', reason: 'No round trip from the base fits the battery, EVA and slope limits.' };
  const km = farthestM >= 1000 ? `${(farthestM / 1000).toFixed(1)} km` : `${Math.round(farthestM)} m`;
  return { verdict: 'GO', tone: 'go', reason: `The crew can get home from ${areaKm2.toFixed(1)} km², up to ${km} out. Comms is checked per route, not here.` };
}
