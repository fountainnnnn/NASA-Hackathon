/**
 * Route operations for the Ops layer: comms from the base habitat, lighting from Mars24, the go/no-go board and
 * the one-word verdict. Everything here is a thin wrapper over lib/ops (tested there).
 */
import type { Dem, LonLat, MissionConstraints, RouteResult } from '@/lib/contracts';
import { evaluateGoNoGo } from '@/lib/ops/goNoGo';
import { daylightCheck, latestSafeStart, sunAlongRoute, SOL_MS } from '@/lib/ops/lighting';
import { ltstHours, formatHms, marsState, sunPosition } from '@/lib/ops/mars24';
import { buildTimeline } from '@/lib/ops/timeline';
import { commsAlongRoute } from '@/lib/ops/viewshed';
import type { CommsResult, DaylightCheck, GoNoGo, GoNoGoItem } from '@/lib/opsContracts';
import type { Tone, Verdict } from '@/state/hud';

export interface RouteOps {
  goNoGo: GoNoGo;
  comms: CommsResult | null;
  daylight: DaylightCheck | null;
  verdict: Verdict;
  /** "NO GO: 1.6 km radio shadow" */
  headline: string;
  startUtcMs: number;
  /** Local true solar time at the start, "HH:MM:SS". */
  ltst: string;
}

const TONE: Record<GoNoGo['overall'], Tone> = { go: 'go', caution: 'caution', 'no-go': 'nogo' };
const WORD: Record<GoNoGo['overall'], Verdict['word']> = { go: 'GO', caution: 'HOLD', 'no-go': 'NO GO' };

export function ltstAt(startUtcMs: number, lon: number): string {
  return formatHms(ltstHours(marsState(startUtcMs), lon));
}

/** A few words naming the single limiting item, for the bubble headline. */
export function headlineFor(item: GoNoGoItem | undefined, route: RouteResult): string {
  if (!item) return 'every limit holds';
  switch (item.id) {
    case 'slope': return route.reasons.includes('no_path_slope') ? 'no path under the limit' : 'slope over the limit';
    case 'battery': return 'battery below reserve';
    case 'eva-time': return 'EVA over its time limit';
    case 'daylight': return item.status === 'no-go' ? 'sun below the horizon' : 'sunset close';
    case 'comms': return `${((item.value ?? 0) / 1000).toFixed(1)} km radio shadow`;
    case 'data': return 'terrain data missing';
  }
}

/** One sentence naming the single limiting item (never a score). */
export function reasonFor(item: GoNoGoItem | undefined, route: RouteResult, ltst: string): string {
  if (!item) return 'Every limit holds.';
  const v = item.value, l = item.limit;
  switch (item.id) {
    case 'slope':
      return route.reasons.includes('no_path_slope') ? `No path stays under ${l} deg${route.minFeasibleSlopeDeg ? `, ${route.minFeasibleSlopeDeg} deg would work` : ''}.`
        : `Slope reaches ${v} deg against a ${l} deg limit.`;
    case 'battery': return `Battery ends at ${v}% against a ${l}% reserve.`;
    case 'eva-time': return `EVA takes ${v} min against a ${l} min limit.`;
    case 'daylight': return item.status === 'no-go' ? `Sun is below the horizon at the start, local time ${ltst}.` : `Sun sets close to the end of the walk, local time ${ltst}.`;
    case 'comms': return item.status === 'no-go' ? `Radio shadow of ${((v ?? 0) / 1000).toFixed(1)} km with no line of sight to base.` : `Radio shadow of ${Math.round(v ?? 0)} m on the way.`;
    case 'data': return 'Part of the route has no terrain data.';
  }
}

/** Go/no-go for a committed route. Comms: line of sight from a mast on the habitat at the base. Lighting: Mars24 at startUtcMs. */
export function evaluateRoute(route: RouteResult, dem: Dem, base: LonLat | null, startUtcMs: number, constraints?: MissionConstraints): RouteOps {
  const timeline = buildTimeline(route);
  let comms: CommsResult | null = null;
  if (base && timeline.samples.length > 1) {
    try { comms = commsAlongRoute(dem, timeline, { ...base, id: 'habitat', label: 'Habitat' }); } catch { comms = null; }
  }
  let daylight: DaylightCheck | null = null;
  if (timeline.samples.length > 1) {
    try { daylight = daylightCheck(timeline, startUtcMs); } catch { daylight = null; }
  }
  const goNoGo = evaluateGoNoGo({ route, comms, lighting: daylight, constraints });
  const ltst = ltstAt(startUtcMs, route.from.lon);
  const order = [...goNoGo.blockers, ...goNoGo.cautions];
  const limiting = goNoGo.items.find((i) => i.id === order[0]);
  const verdict: Verdict = { word: WORD[goNoGo.overall], tone: TONE[goNoGo.overall], reason: reasonFor(limiting, route, ltst), routeId: route.id };
  const headline = `${verdict.word}: ${headlineFor(limiting, route)}`;
  return { goNoGo, comms, daylight, verdict, headline, startUtcMs, ltst };
}

/** Sun elevation (deg) at a site for an EVA that began at startUtcMs, tS seconds in. */
export function sunElevationAt(site: LonLat, startUtcMs: number, tS: number): number {
  return sunPosition(startUtcMs + tS * 1000, site.lat, site.lon).elevationDeg;
}

/** Next time (from `fromMs`) the sun is at its highest at the site, within one sol. Used by "Start at local noon". */
export function nextLocalNoon(site: LonLat, fromMs: number): number {
  let best = fromMs, bestEl = -90;
  for (let t = fromMs; t <= fromMs + SOL_MS; t += 10 * 60_000) {
    const el = sunPosition(t, site.lat, site.lon).elevationDeg;
    if (el > bestEl) { bestEl = el; best = t; }
  }
  // search backwards from the best time for the start of the safe window so the whole walk fits when it can
  return best;
}


/** Constraint-based colour for a one-way preview: judged as the round trip it would become. */
export function previewTone(
  oneWay: { feasible: boolean; totals: { walkMin: number; maxSlopeDeg: number } },
  c: MissionConstraints,
): Tone {
  if (!oneWay.feasible) return 'nogo';
  const evaMin = 2 * oneWay.totals.walkMin + c.dwellMin;
  const used = (evaMin * c.suitPowerW) / 60 / c.batteryWh * 100;
  const left = 100 - used;
  if (left < c.batteryReservePct || evaMin > c.evaMaxMin) return 'nogo';
  if (left < c.batteryReservePct + 10 || evaMin > 0.85 * c.evaMaxMin || oneWay.totals.maxSlopeDeg >= 0.8 * c.maxSlopeDeg) return 'caution';
  return 'go';
}

export { daylightCheck, latestSafeStart, sunAlongRoute };
