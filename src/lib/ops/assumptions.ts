/**
 * Every ops-science constant that is an ASSUMPTION (not a NASA-published value) lives here, so the
 * UI/agent can list them verbatim as provenance 'assumption'.
 */

/** ASSUMPTION: minimum solar elevation for EVA (deg). 0 = sun at the geometric horizon (no refraction, disc centre). */
export const MIN_SUN_ELEVATION_DEG = 0;
/** ASSUMPTION: caution when the lowest sun elevation during the EVA is within this margin above the minimum (deg). */
export const SUN_CAUTION_MARGIN_DEG = 5;

/** ASSUMPTION: antenna mast height above ground on habitat / rover relay station (m). */
export const STATION_MAST_HEIGHT_M = 2;
/** ASSUMPTION: suit antenna height above ground (m). */
export const SUIT_ANTENNA_HEIGHT_M = 1.8;

/** ASSUMPTION: caution when slope is at or above this fraction of the slope limit. */
export const SLOPE_CAUTION_FRACTION = 0.8;
/** ASSUMPTION: caution when battery remaining at end is within this many percentage points of the reserve. */
export const BATTERY_CAUTION_MARGIN_PCT = 10;
/** ASSUMPTION: caution when EVA time exceeds this fraction of the EVA limit. */
export const EVA_CAUTION_FRACTION = 0.85;
/** ASSUMPTION: comms is no-go when any single shadow stretch is longer than this (m); any shorter shadow is a caution. */
export const COMMS_NOGO_SHADOW_M = 500;

/** ASSUMPTION: heading change (deg) that counts as a "significant turn" on the cuff card. */
export const CUFF_TURN_DEG = 30;
/** ASSUMPTION: Douglas-Peucker tolerance (m) used to ignore grid zig-zag when finding turns (planning cell = 40 m). */
export const CUFF_SIMPLIFY_TOL_M = 40;
/** Cuff card target maximum number of waypoint lines. Start/stops/target/end are never dropped. */
export const CUFF_MAX_ROWS = 12;
