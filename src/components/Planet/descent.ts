/**
 * Landing descent model (pure). Times come from the cited NASA/JPL Mars 2020 EDL phases; altitudes are the cited triggers
 * (11 km at parachute deploy, 2.1 km at back shell separation, about 20 m for the sky crane, which starts about 12 s before
 * touchdown and lowers the rover 7.6 m below the stage on nylon cords). ASSUMPTIONS, visual only, marked as such: entry
 * interface altitude, the shape of the altitude curve between triggers, how fast the cords pay out, the stowed gap, and how
 * the discarded hardware falls away. None of these appear as facts on screen.
 */
import type { EdlPhase } from '../../lib/globeContracts';
import { MC_START_S, PULLBACK_S, TOUCHDOWN_HOLD_S as HOLD_S } from '../../lib/scenario/playback';
import { clamp, smoothstep } from './planetMath';

export const ENTRY_ALT_KM = 125;             // assumption: top of the sensible atmosphere
export const SKYCRANE_HOVER_M = 20;          // NASA: sky crane lowers the rover from about 20 m
export const SKYCRANE_WINDOW_S = 12;         // NASA: the sky crane starts about 12 s before touchdown
export const BRIDLE_M = 7.6;                 // NASA: the cords lower the rover 7.6 m (25 ft) below the descent stage
export const ROVER_DECK_M = 1.2;             // rover model: cord attachment height above the wheels' contact points
export const BRIDLE_STOWED_M = 2.6;          // assumption: stage underside to the rover's wheels while stowed under it
export const BRIDLE_PAYOUT_S = 7;            // assumption: time for the cords to pay out to full length
/** Stage underside to the wheels with the cords fully out. */
export const HANG_FULL_M = BRIDLE_M + ROVER_DECK_M;
export const FALL_SPEED_MS = 55;             // assumption: discarded back shell and parachute fall rate
export const DEPART_S = 22;                  // assumption: descent stage flies away this long after touchdown
export const SHELL_FALL_M = 80;              // chute and back shell stop here above the ground (collapse)

export interface Events { chute: number; shieldSep: number; backshellSep: number; touchdown: number; crane: number }

export function events(phases: EdlPhase[]): Events {
  const at = (id: string, f: number) => phases.find((p) => p.id === id)?.tStartS ?? f;
  const touchdown = phases.reduce((m, p) => Math.max(m, p.tEndS), 0) || 420;
  return { chute: at('parachute_deploy', 240), shieldSep: at('heat_shield_separation', 260), backshellSep: at('backshell_separation', 350), touchdown, crane: touchdown - SKYCRANE_WINDOW_S };
}

/** Height above the local ground of the main vehicle (capsule, then descent stage) in metres. */
export function vehicleAltM(t: number, ev: Events): number {
  if (t <= 0) return ENTRY_ALT_KM * 1000;
  if (t < ev.chute) { const u = t / ev.chute; return (11 + (ENTRY_ALT_KM - 11) * Math.pow(1 - u, 1.6)) * 1000; }
  if (t < ev.backshellSep) return (11 - ((t - ev.chute) / (ev.backshellSep - ev.chute)) * (11 - 2.1)) * 1000;
  if (t < ev.crane) return (2.1 - ((t - ev.backshellSep) / (ev.crane - ev.backshellSep)) * (2.1 - SKYCRANE_HOVER_M / 1000)) * 1000;
  // sky crane: the stage keeps descending slowly (NASA: about 0.75 m/s) until the wheels touch with the cords fully out
  if (t <= ev.touchdown) return SKYCRANE_HOVER_M - (SKYCRANE_HOVER_M - HANG_FULL_M) * ((t - ev.crane) / (ev.touchdown - ev.crane));
  return HANG_FULL_M + Math.pow(Math.max(0, t - ev.touchdown), 1.7) * 3;   // cords cut, stage climbs away
}

/** Distance from the stage underside down to the rover's wheels: stowed, then the cords pay out to 7.6 m, then the wheels touch at touchdown. */
export function hangM(t: number, ev: Events): number {
  if (t <= ev.crane) return BRIDLE_STOWED_M;
  if (t >= ev.touchdown) return HANG_FULL_M;
  return BRIDLE_STOWED_M + (HANG_FULL_M - BRIDLE_STOWED_M) * smoothstep(ev.crane, ev.crane + BRIDLE_PAYOUT_S, t);
}

/** Back shell and parachute after separation: height above ground (falls, then lies there). */
export function shellAltM(t: number, ev: Events): number {
  const a0 = vehicleAltM(ev.backshellSep, ev);
  return Math.max(SHELL_FALL_M * 0.0, a0 - Math.max(0, t - ev.backshellSep) * FALL_SPEED_MS);
}

export type Phase = 'entry' | 'chute' | 'descent' | 'crane' | 'landed';
export function stageOf(t: number, ev: Events): Phase {
  if (t < ev.chute) return 'entry';
  if (t < ev.backshellSep) return 'chute';
  if (t < ev.crane) return 'descent';
  if (t < ev.touchdown) return 'crane';
  return 'landed';
}

/** Dust bloom under the descent engines: radius (m) and opacity, rising as the stage drops under ~120 m, then fading after touchdown. */
export function dust(t: number, ev: Events): { radius: number; alpha: number } {
  if (t < ev.crane - 6) return { radius: 0, alpha: 0 };
  if (t <= ev.touchdown) { const k = smoothstep(ev.crane - 6, ev.touchdown, t); return { radius: 6 + 22 * k, alpha: 0.25 + 0.5 * k }; }
  const f = clamp((t - ev.touchdown) / 16, 0, 1);
  return { radius: 28 + 18 * f, alpha: 0.75 * (1 - f) };
}

/** Camera: chase distance from the followed object during entry. Closes in as the vehicle drops, so the object stays readable. */
export const chaseRangeM = (altM: number) => clamp(altM * 0.25 + 70, 70, 14000);
export const CHASE_PITCH_DEG = -22;
/** Camera distance (true scale, nothing enlarged) while the parachute is out: the 21.5 m canopy fills about a fifth of the view. */
export const CHUTE_RANGE_M = 190;
/** Camera distance for the sky crane: the stage, the bridles and the rover in one frame with the ground around them. */
export const CRANE_RANGE_M = 95;

/**
 * Chase camera by time: a high, looking-down follow during entry; it closes to CHUTE_RANGE_M within 6 s of the parachute
 * opening and levels out so the canopy hangs against the horizon haze; it then eases to CRANE_RANGE_M, nearly level, for
 * the sky crane, so most of the frame is ground at a distance where the imagery is sharp.
 */
export function chaseCamera(t: number, ev: Events): { rangeM: number; pitchDeg: number } {
  const alt = vehicleAltM(Math.min(t, ev.touchdown), ev);
  const logLerp = (a: number, b: number, k: number) => Math.exp(Math.log(a) * (1 - k) + Math.log(b) * k);
  if (t < ev.chute) return { rangeM: chaseRangeM(alt), pitchDeg: CHASE_PITCH_DEG };
  if (t < ev.backshellSep) {
    const k = smoothstep(ev.chute, ev.chute + 6, t);
    return { rangeM: logLerp(chaseRangeM(alt), CHUTE_RANGE_M, k), pitchDeg: CHASE_PITCH_DEG + 8 * k };
  }
  const k = smoothstep(ev.backshellSep, ev.crane, t);
  return { rangeM: logLerp(CHUTE_RANGE_M, CRANE_RANGE_M, k), pitchDeg: -14 + 5 * k };
}

/** Seconds the camera holds on the rover after touchdown before pulling back (lib/scenario/playback.ts owns the post-touchdown timing). */
export const TOUCHDOWN_HOLD_S = HOLD_S;
/** The Monte-Carlo testing phase (touchdowns dropping onto the ellipse) starts this long after touchdown, as the pull-back settles. */
export const REVEAL_DELAY_S = MC_START_S;
/** Blend of the post-touchdown pull-back to the wide view of the ellipse: 0 until TOUCHDOWN_HOLD_S after touchdown, 1 PULLBACK_S later. */
export const pullBack = (t: number, ev: Events) => smoothstep(ev.touchdown + TOUCHDOWN_HOLD_S, ev.touchdown + TOUCHDOWN_HOLD_S + PULLBACK_S, t);

/**
 * Drawn height (m) of a point `altM` above the ground when the vehicle is drawn `k` times true size (lib/scenario/drawScale).
 * Below the sky crane hover height the whole scene is a k-times replica (stage, cords, rover and their heights above the
 * ground), so the rover still touches down exactly when the cords are fully out; above it the drawn height is the true
 * height plus a constant (k - 1) × 20 m, negligible at the kilometre altitudes of the parachute and powered descent.
 * The captions always report the true altitude.
 */
export const drawAltM = (altM: number, k = 1) => altM + (k - 1) * Math.min(Math.max(altM, 0), SKYCRANE_HOVER_M);

/** True for phases NASA defines by an altitude window rather than a clock time (edl_mars2020.json "trigger": "altitude"). */
export const isAltitudePhase = (p: EdlPhase) => (p as EdlPhase & { trigger?: string }).trigger === 'altitude';

/** Altitude-triggered phase window in metres (low, high), with a 0.5 m tolerance on the top for the hover height. */
function altitudeWindowM(p: EdlPhase): [number, number] | null {
  if (p.altitudeKmStart == null || p.altitudeKmEnd == null) return null;
  return [Math.min(p.altitudeKmStart, p.altitudeKmEnd) * 1000, Math.max(p.altitudeKmStart, p.altitudeKmEnd) * 1000 + 0.5];
}

/**
 * Caption for the current phase and what it is based on. Clock-timed phases follow mission time; altitude-triggered
 * phases take over only while the vehicle is inside their altitude window:
 *  - Terrain-Relative Navigation, 4.2 to 2.2 km, within its time bounds;
 *  - Sky crane, 20 m and below until touchdown. NASA gives it an altitude trigger and no duration (tStartS = tEndS =
 *    touchdown bound), so a zero-length phase is bounded by its end time only (strictly before it: at touchdown the clock
 *    phase "Touchdown" owns the caption).
 */
export function phaseCaption(t: number, phases: EdlPhase[], altM: number): { label: string; altitude: string } {
  let cur: EdlPhase | null = null;
  for (const p of [...phases].sort((a, b) => a.tStartS - b.tStartS)) if (p.tStartS <= t && !isAltitudePhase(p)) cur = p;
  for (const p of phases) {
    const w = isAltitudePhase(p) ? altitudeWindowM(p) : null;
    if (!w) continue;
    const inTime = p.tEndS > p.tStartS ? t >= p.tStartS && t <= p.tEndS : t < p.tEndS;
    if (inTime && altM <= w[1] && altM >= w[0]) cur = p;
  }
  const label = cur?.label ?? 'Cruise';
  const km = altM >= 1000 ? `${(altM / 1000).toFixed(1)} km` : `${Math.round(altM)} m`;
  return { label, altitude: `${km} above the surface` };
}

/* ------------------------------------------------------------------ ground tracking camera */

/**
 * Below this vehicle altitude the chase camera would put imagery texels over 4 screen pixels (CTX global mosaic, about
 * 5 m per pixel, at a 60 degree lens on a ~1000 px stage: 5 m / 1250 m = 4 mrad = 4 px). From here the view cuts to a
 * tracking camera on the ground that looks up at the vehicle, so the frame is sky, horizon and the vehicle at true scale,
 * never the near ground.
 */
export const GROUND_CAM_BELOW_M = 1300;
/** Tracking camera position at the sky crane: this far south of the touchdown point (looking north, the sun low in the west-southwest behind-left). */
export const GROUND_CAM_DIST_M = 40;
/** While the vehicle is higher the camera stands farther out (metres per metre of altitude above the hover height), so it never looks straight up. */
export const GROUND_CAM_DOLLY = 0.5;
/** Distance (m) of the tracking camera south of the touchdown point for a vehicle altitude: dollies in as the vehicle comes down. */
export const groundCamDistM = (altM: number) => GROUND_CAM_DIST_M + GROUND_CAM_DOLLY * Math.max(0, altM - SKYCRANE_HOVER_M);
/** Tracking camera eye height above the ground. */
export const GROUND_CAM_EYE_M = 2;
/** The near ground stays out of frame: the bottom edge is no lower than this many degrees below level (more only to keep the rover's wheels in). */
export const GROUND_CAM_FLOOR_DEG = -1;
/** Share of the vertical field of view the vehicle should fill (sky crane: stage, bridles and rover, at least ~250 px). */
export const GROUND_CAM_FILL = 0.5;
export const GROUND_CAM_VFOV_MIN_DEG = 3;   // longest lens (vehicle high above, sky behind)
export const GROUND_CAM_VFOV_MAX_DEG = 46;  // widest lens

const R2D = 180 / Math.PI;
/** Elevation (deg) and azimuth (deg, clockwise from north) of a point given east/north/up offsets (m) from the eye. */
export function elevAz(e: number, n: number, u: number): { elev: number; az: number } {
  return { elev: Math.atan2(u, Math.hypot(e, n)) * R2D, az: ((Math.atan2(e, n) * R2D) + 360) % 360 };
}

/**
 * Framing for the ground tracking camera: heading (deg, clockwise from north), pitch (deg, positive up) and vertical field of
 * view (deg). `top` and `bottom` are the highest and lowest points of what is framed (east, north, up from the eye, metres).
 * The lens narrows so the vehicle fills GROUND_CAM_FILL of the frame, but the bottom edge never drops more than
 * GROUND_CAM_FLOOR_DEG below level unless the lowest point needs it (then 1.5 degrees under it), so nothing close to the
 * camera on the ground is in view. `minVfovDeg` holds a wider lens (touchdown: hold the wide shot rather than zoom onto
 * coarse imagery).
 */
export function groundFraming(top: [number, number, number], bottom: [number, number, number], minVfovDeg = GROUND_CAM_VFOV_MIN_DEG): { headingDeg: number; pitchDeg: number; vfovDeg: number } {
  const a = elevAz(...top), b = elevAz(...bottom);
  const hi = Math.max(a.elev, b.elev), lo = Math.min(a.elev, b.elev);
  const span = Math.max(hi - lo, 0.05);
  let vfov = clamp(span / GROUND_CAM_FILL, Math.max(GROUND_CAM_VFOV_MIN_DEG, minVfovDeg), GROUND_CAM_VFOV_MAX_DEG);
  let pitch = (hi + lo) / 2;
  const floor = Math.min(GROUND_CAM_FLOOR_DEG, lo - 1.5);
  if (pitch - vfov / 2 < floor) pitch = floor + vfov / 2;
  if (hi > pitch + vfov / 2 - 1) { vfov = clamp(hi - floor + 2, vfov, GROUND_CAM_VFOV_MAX_DEG); pitch = floor + vfov / 2; }
  // a vehicle high above a close eye: look further up rather than lose the top of it (the bottom edge only rises)
  if (hi > pitch + vfov / 2 - 1) pitch = Math.min(hi - vfov / 2 + 1, lo + vfov / 2);
  // heading: towards the middle of what is framed (horizontal mean of the two points)
  const az = elevAz((top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2, 0).az;
  return { headingDeg: az, pitchDeg: Math.min(pitch, 85), vfovDeg: vfov };
}

/** True while the ground tracking camera owns the view (from GROUND_CAM_BELOW_M until the pull-back has begun). */
export const groundCamActive = (t: number, ev: Events) => t >= ev.backshellSep && vehicleAltM(Math.min(t, ev.touchdown), ev) <= GROUND_CAM_BELOW_M;

/** Vehicle altitude (m) under which the faint approach arc is hidden: near the ground it would drop through the frame as a line. */
export const ARC_HIDE_BELOW_M = 2000;

/* ------------------------------------------------------------------ sky crane and touchdown framing (QA round 3, P0-2 and P0-3) */

/** Stage top above the stage origin (what the tracking camera frames as the top of the vehicle). */
export const STAGE_TOP_M = 1.6;
/** Sky crane: the horizon sits this far down the frame, so the ground fills the lower part behind the hanging rover. */
export const CRANE_HORIZON_FRAC = 0.35;
/** Blend from the low, looking-up tracking camera (vehicle above 120 m) to the sky crane framing (30 m and under). */
export const craneBlend = (altM: number) => 1 - smoothstep(30, 120, altM);
/**
 * Tracking camera eye height above the ground for a stage `altM` up with the rover `hangM` below it (true metres; `k` the
 * drawing scale of the vehicle): 2 m while the vehicle
 * is high, rising for the sky crane to a tenth of the vehicle's height under the stage top, so the stage sits on the horizon
 * and the bridles and the rover hang against real ground, clear of the bottom edge.
 */
export const groundCamEyeM = (altM: number, hangM: number, k = 1) => {
  // k: the vehicle is drawn k times true size (drawAltM); altM and hangM are the true values
  const top = drawAltM(altM, k) + k * STAGE_TOP_M, span = k * (STAGE_TOP_M + hangM);
  return GROUND_CAM_EYE_M + craneBlend(altM) * Math.max(0, top - 0.1 * span - GROUND_CAM_EYE_M);
};

/**
 * Sky crane framing from a raised eye: the lens fills GROUND_CAM_FILL of the frame with the vehicle (at least 250 px on a
 * 725 px stage), the camera pitches down so the horizon sits at CRANE_HORIZON_FRAC of the height, and everything framed stays
 * inside the frame. `k` blends from groundFraming (0) to this framing (1); both contain the vehicle, so every blend does.
 * The imagery here is CTX (about 5 m per pixel), so the ground behind the vehicle reads as soft relief at any range.
 */
export function craneFraming(top: [number, number, number], bottom: [number, number, number], k: number): { headingDeg: number; pitchDeg: number; vfovDeg: number } {
  const g = groundFraming(top, bottom);
  if (k <= 0) return g;
  const hi = Math.max(elevAz(...top).elev, elevAz(...bottom).elev), lo = Math.min(elevAz(...top).elev, elevAz(...bottom).elev);
  const vfov = clamp(Math.max(hi - lo, 0.05) / GROUND_CAM_FILL, GROUND_CAM_VFOV_MIN_DEG, GROUND_CAM_VFOV_MAX_DEG);
  const margin = Math.min(1, vfov * 0.04);
  let pitch = -(0.5 - CRANE_HORIZON_FRAC) * vfov;
  if (hi > pitch + vfov / 2 - margin) pitch = hi - vfov / 2 + margin;
  if (lo < pitch - vfov / 2 + margin) pitch = lo + vfov / 2 - margin;
  return { headingDeg: g.headingDeg, pitchDeg: g.pitchDeg + (pitch - g.pitchDeg) * k, vfovDeg: g.vfovDeg + (vfov - g.vfovDeg) * k };
}

/** Lens held after touchdown (wide: no zoom onto coarse imagery). */
export const TOUCHDOWN_VFOV_DEG = 28;
/** After touchdown the middle of the rover sits this far down the frame: clear of the attribution strip, ground below and around it. */
export const TOUCHDOWN_AT_FRAC = 0.6;
/** Touchdown hold from the 2 m eye: the camera aims above the rover so the rover sits at TOUCHDOWN_AT_FRAC of the height. */
export function touchdownFraming(top: [number, number, number], bottom: [number, number, number]): { headingDeg: number; pitchDeg: number; vfovDeg: number } {
  const g = groundFraming(top, bottom, TOUCHDOWN_VFOV_DEG);
  const mid = (elevAz(...top).elev + elevAz(...bottom).elev) / 2;
  return { headingDeg: g.headingDeg, pitchDeg: mid + (TOUCHDOWN_AT_FRAC - 0.5) * g.vfovDeg, vfovDeg: g.vfovDeg };
}
