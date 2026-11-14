/**
 * Go / caution / no-go board for a planned route. Hard limits come from MissionConstraints (the user's
 * numbers); caution bands are ASSUMPTIONS defined in assumptions.ts and quoted in each item's `rule`.
 */
import type { MissionConstraints, RouteResult } from '../contracts';
import type { CommsResult, DaylightCheck, GoItemId, GoNoGo, GoNoGoItem, GoStatus } from '../opsContracts';
import {
  BATTERY_CAUTION_MARGIN_PCT, COMMS_NOGO_SHADOW_M, EVA_CAUTION_FRACTION, SLOPE_CAUTION_FRACTION, SUN_CAUTION_MARGIN_DEG,
} from './assumptions';

export interface GoNoGoInput {
  route: RouteResult;
  comms?: CommsResult | null;
  lighting?: DaylightCheck | null;
  /** Defaults to route.constraintsUsed. */
  constraints?: MissionConstraints;
}

const worst = (a: GoStatus, b: GoStatus): GoStatus =>
  a === 'no-go' || b === 'no-go' ? 'no-go' : a === 'caution' || b === 'caution' ? 'caution' : 'go';

export function evaluateGoNoGo({ route, comms, lighting, constraints }: GoNoGoInput): GoNoGo {
  const k = constraints ?? route.constraintsUsed;
  const t = route.totals;
  const has = (r: RouteResult['reasons'][number]) => route.reasons.includes(r);
  const items: GoNoGoItem[] = [];
  const r1 = (x: number) => Math.round(x * 10) / 10;

  // slope
  {
    const slopeVal = r1(t.maxSlopeDeg);
    let status: GoStatus = t.maxSlopeDeg > k.maxSlopeDeg ? 'no-go' : t.maxSlopeDeg >= SLOPE_CAUTION_FRACTION * k.maxSlopeDeg ? 'caution' : 'go';
    if (has('no_path_slope')) status = 'no-go';
    items.push({
      id: 'slope', label: 'Max slope on route', status, value: has('no_path_slope') ? null : slopeVal, limit: k.maxSlopeDeg, unit: 'deg',
      source: 'RouteResult.totals.maxSlopeDeg (CTX 20 m DEM, max |edge grade|) vs MissionConstraints.maxSlopeDeg', provenance: 'computed',
      rule: `no-go if no path under the limit or max slope > limit; caution if ≥ ${SLOPE_CAUTION_FRACTION * 100}% of limit (ASSUMPTION)`,
    });
  }
  // battery
  {
    const remaining = 100 - t.batteryUsedPct;
    const limit = k.batteryReservePct;
    const status: GoStatus = has('battery_reserve') || remaining < limit ? 'no-go' : remaining < limit + BATTERY_CAUTION_MARGIN_PCT ? 'caution' : 'go';
    items.push({
      id: 'battery', label: 'Battery remaining at EVA end', status, value: r1(remaining), limit, unit: '%',
      source: 'RouteResult.totals.batteryUsedPct (suitPowerW × evaMin / batteryWh) vs MissionConstraints.batteryReservePct', provenance: 'assumption',
      rule: `no-go if remaining < reserve; caution if within ${BATTERY_CAUTION_MARGIN_PCT} points of reserve (ASSUMPTION). Suit power/capacity are assumptions`,
    });
  }
  // eva time
  {
    const status: GoStatus = has('eva_time') || t.evaMin > k.evaMaxMin ? 'no-go' : t.evaMin > EVA_CAUTION_FRACTION * k.evaMaxMin ? 'caution' : 'go';
    items.push({
      id: 'eva-time', label: 'EVA duration (walk + dwell)', status, value: r1(t.evaMin), limit: k.evaMaxMin, unit: 'min',
      source: 'RouteResult.totals.evaMin vs MissionConstraints.evaMaxMin', provenance: 'assumption',
      rule: `no-go if > EVA limit; caution if > ${EVA_CAUTION_FRACTION * 100}% of limit (ASSUMPTION)`,
    });
  }
  // daylight
  if (lighting) {
    const status: GoStatus = !lighting.ok ? 'no-go' : lighting.minElevationDeg < lighting.thresholdDeg + SUN_CAUTION_MARGIN_DEG ? 'caution' : 'go';
    items.push({
      id: 'daylight', label: 'Lowest sun elevation during EVA', status, value: r1(lighting.minElevationDeg), limit: lighting.thresholdDeg, unit: 'deg',
      source: 'NASA GISS Mars24 (Allison & McEwen 2000) at route vertices; geometric elevation, no refraction', provenance: 'computed',
      rule: `no-go if sun < minimum (ASSUMPTION constant) at any point; caution within ${SUN_CAUTION_MARGIN_DEG}° of it (ASSUMPTION)`,
    });
  } else {
    items.push({
      id: 'daylight', label: 'Lowest sun elevation during EVA', status: 'caution', value: null, limit: null, unit: 'deg',
      source: 'not evaluated (no start time supplied)', provenance: 'unavailable', rule: 'caution while the start time is unknown',
    });
  }
  // comms
  if (comms) {
    const longest = comms.longestShadowM;
    const status: GoStatus = comms.shadows.length === 0 ? 'go' : longest > COMMS_NOGO_SHADOW_M ? 'no-go' : 'caution';
    items.push({
      id: 'comms', label: 'Longest comms shadow on route', status, value: r1(longest), limit: COMMS_NOGO_SHADOW_M, unit: 'm',
      source: `Line of sight from ${comms.stationId} (mast ${comms.stationHeightM} m) to suit (${comms.suitHeightM} m) on the 20 m DEM, Mars curvature included`, provenance: 'computed',
      rule: `go if no shadow; caution for any shadow; no-go if one stretch > ${COMMS_NOGO_SHADOW_M} m (ASSUMPTION); antenna heights are assumptions`,
    });
  } else {
    items.push({
      id: 'comms', label: 'Longest comms shadow on route', status: 'caution', value: null, limit: COMMS_NOGO_SHADOW_M, unit: 'm',
      source: 'not evaluated (no comms station supplied)', provenance: 'unavailable', rule: 'caution while no station is defined',
    });
  }
  // data quality
  {
    const vertexCount = route.legs.reduce((n, l) => n + l.path.length, 0);
    const noLegs = route.legs.length === 0;
    const bad = noLegs || has('nodata_endpoint') || has('out_of_bounds');
    const nodataV = comms ? comms.nodataVertices : null;
    const validPct = nodataV === null || vertexCount === 0 ? null : r1(100 * (1 - nodataV / Math.max(1, comms!.visible.length)));
    const missing = !comms || !lighting;
    const status: GoStatus = bad || (validPct !== null && validPct < 100) ? 'no-go' : missing ? 'caution' : 'go';
    items.push({
      id: 'data', label: 'Terrain data coverage on route', status, value: bad ? 0 : validPct, limit: 100, unit: '% DEM-valid vertices',
      source: `CTX DEM ${route.demResM} m (route planned on ${route.gridResM} m grid); comms/lighting inputs present: ${comms ? 'comms' : 'no comms'}, ${lighting ? 'lighting' : 'no lighting'}`,
      provenance: 'computed',
      rule: 'no-go if endpoints are nodata/out of bounds, no route exists, or any route vertex has no DEM data; caution if comms or lighting were not evaluated',
    });
  }

  const overall = items.reduce<GoStatus>((s, i) => worst(s, i.status), 'go');
  const ids = (st: GoStatus): GoItemId[] => items.filter((i) => i.status === st).map((i) => i.id);
  return { items, overall, blockers: ids('no-go'), cautions: ids('caution') };
}
