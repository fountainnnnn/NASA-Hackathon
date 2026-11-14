/**
 * MarsWalk Copilot — OPS-science contract types (lib/ops). Appended separately from contracts.ts.
 * All times: "min" = SI minutes of elapsed EVA time (Earth minutes, NOT Mars-minutes). UTC = JS Date.
 */
import type { LonLat, Provenance } from './contracts';

/* ------------------------------------------------------------------ route timeline */

export interface TimelineSample {
  /** Flat index over all leg vertices concatenated (leg boundary vertices appear twice: arrival / departure). */
  idx: number;
  leg: number; vertex: number;
  lon: number; lat: number;
  /** Elevation stored in the route vertex (planning-grid cell mean), metres. */
  h: number;
  /** Cumulative 3D distance walked, metres. */
  distM: number;
  /** Elapsed EVA time at this sample, minutes (walking + dwell). */
  tMin: number;
  /** Suit battery remaining, % (100 − elapsed·suitPowerW/batteryWh). */
  batteryPct: number;
  /** Arrival at the end of an outbound leg (a stop or the target): dwell of this many minutes follows. */
  dwellAfterMin: number;
  /** Role of the vertex. */
  kind: 'start' | 'path' | 'stop' | 'target' | 'end';
}

export interface Timeline {
  routeId: string;
  samples: TimelineSample[];
  /** Number of outbound legs (legs.length minus 1 when roundTrip). */
  outboundLegs: number;
  /** Total EVA minutes including every dwell (equals route.totals.evaMin). */
  totalMin: number;
  totalDistM: number;
  pctPerMin: number;
}

/* ------------------------------------------------------------------ sun / lighting */

export interface SunSample { idx: number; tMin: number; utcMs: number; elevationDeg: number; azimuthDeg: number }

export interface DaylightCheck {
  ok: boolean;
  thresholdDeg: number;
  minElevationDeg: number;
  minElevationAtMin: number;
  startElevationDeg: number;
  endElevationDeg: number;
  /** First elapsed minute at which the sun is below the threshold, or null. */
  firstViolationMin: number | null;
}

export interface SafeStartResult {
  /** Latest UTC start (ms) for which the whole EVA stays at or above the elevation threshold. */
  latestStartUtcMs: number;
  earliestStartUtcMs: number;
  /** EVA end (ms) when starting at the latest safe start. */
  latestEndUtcMs: number;
  thresholdDeg: number;
  evaMin: number;
}

/* ------------------------------------------------------------------ comms / line of sight */

export interface Station extends LonLat { id?: string; label?: string; /** antenna mast height above local ground, m */ heightM?: number }

export interface LosResult {
  visible: boolean;
  distM: number;
  /** Ground distance from the observer at which the ray is first blocked, or null. */
  blockedAtM: number | null;
  /** Smallest vertical clearance (m) of the ray over curvature-corrected terrain; negative = blocked. */
  minClearanceM: number | null;
  reason: 'clear' | 'terrain' | 'nodata-endpoint' | 'nodata-ray' | 'out-of-bounds';
}

export interface ShadowStretch {
  startIdx: number; endIdx: number;          // flat timeline indices (inclusive)
  startLeg: number; startVertex: number; endLeg: number; endVertex: number;
  /** Vertex-to-vertex length of the shadowed run (lower bound), m. */
  lengthM: number;
  /** Extent between the neighbouring visible vertices (upper bound), m. */
  maxLengthM: number;
  startMin: number; endMin: number;
  start: LonLat; end: LonLat;
}

export interface CommsResult {
  stationId: string;
  visible: boolean[];                         // per timeline sample
  shadows: ShadowStretch[];
  visibleFraction: number;
  longestShadowM: number;
  /** Vertices where the DEM has no data (LOS could not be verified; counted as not visible). */
  nodataVertices: number;
  stationHeightM: number; suitHeightM: number;
}

export interface ViewshedGrid {
  /** 0 = outside radius / no data, 1 = visible, 2 = hidden. Row 0 = north. Size width×height, centre at (n, n). */
  mask: Uint8Array;
  width: number; height: number;
  stepM: number; radiusM: number;
  station: Station;
  visibleCount: number; hiddenCount: number;
  computeMs: number;
}

/* ------------------------------------------------------------------ go / no-go */

export type GoStatus = 'go' | 'caution' | 'no-go';
export type GoItemId = 'slope' | 'battery' | 'eva-time' | 'daylight' | 'comms' | 'data';

export interface GoNoGoItem {
  id: GoItemId;
  label: string;
  status: GoStatus;
  value: number | null;
  limit: number | null;
  unit: string;
  /** Where the value comes from (module / dataset) — never a guess. */
  source: string;
  provenance: Provenance;
  /** The rule that produced the status, with caution thresholds marked ASSUMPTION. */
  rule: string;
}

export interface GoNoGo { items: GoNoGoItem[]; overall: GoStatus; blockers: GoItemId[]; cautions: GoItemId[] }

/* ------------------------------------------------------------------ cuff checklist */

export interface CuffRow {
  n: number;
  kind: 'start' | 'turn' | 'stop' | 'target' | 'end';
  label: string;
  lat: number; lon: number;
  latStr: string; lonStr: string;
  cumDistM: number;
  elapsedMin: number;
  batteryPct: number;
  headingToNextDeg: number | null;
  /** The leg to the next row crosses a comms shadow. */
  shadowAhead: boolean;
  sunElevationDeg: number | null;
}

export interface CuffCard {
  title: string;
  routeId: string;
  startUtc: string | null;
  rows: CuffRow[];
  warnings: string[];
  turnBack: { tMin: number; label: string; limitedBy: 'battery' | 'eva-time' | 'daylight'; returnWalkMin: number } | null;
  abortRules: string[];
  text: string;
  markdown: string;
  svg: string;
}
