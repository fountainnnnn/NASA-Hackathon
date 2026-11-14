/**
 * Pure maths for the walk camera and the astronaut gait (no three.js, unit-tested in tests/scenario/chase.test.ts).
 *
 * Chase camera: behind, a little above and to the side of the pair at true scale, looking along the walk so the horizon
 * and the real terrain ahead fill the top of the frame. The stage is about 724 px tall at a 1440 x 810
 * window (40 px top bar, 46 px timeline); an astronaut is 1.99 m to the top of the helmet. With a 28 degree vertical field
 * of view from about 28 m the figure is about 100 px tall: px = h / d * stagePx / fovRad.
 */

export const CHASE_BACK_M = 27;        // horizontal distance behind the pair's centre
export const CHASE_UP_M = 3.5;         // camera height above the pair's ground: low, so the horizon and the real terrain fill the top of the frame
export const CHASE_SIDE_DEG = 16;      // swing off the walking axis so the two figures do not overlap
export const CHASE_FOV_DEG = 28;       // narrow lens: the crew reads at true scale and the near ground stays a small share of the frame
export const CHASE_MIN_CLEAR_M = 2.5;  // never closer than this above the ground under the camera
export const CHASE_LOOK_UP_M = 1.4;    // aim height of the look point
export const CHASE_LOOK_AHEAD_M = 30;  // look point this far ahead of the pair, so the camera looks along the walk, nearly level

/** On-screen height (px) of an object `heightM` tall at `distM`, for a vertical field of view and stage height. */
export function screenHeightPx(heightM: number, distM: number, fovDeg: number, stagePx: number): number {
  return (heightM / Math.max(distM, 1e-6)) * (stagePx / ((fovDeg * Math.PI) / 180));
}

/** Compass heading (0 = north = -z, pi/2 = east = +x) to a unit forward vector in the scene's x/z plane. */
export const forwardOf = (headingRad: number) => ({ x: Math.sin(headingRad), z: -Math.cos(headingRad) });

/** Shortest-way angle interpolation. */
export function angLerp(a: number, b: number, k: number): number {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

export interface ChasePose { cam: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } }

/**
 * Camera pose behind the pair. `centre` is the pair's centre on the ground (scene y), `headingRad` the smoothed walking
 * heading, `groundY(x, z)` the scene ground height. Exaggeration scales the heights the way the terrain is scaled.
 */
export function chasePose(centre: { x: number; y: number; z: number }, headingRad: number, groundY: (x: number, z: number) => number, exag = 1): ChasePose {
  const back = headingRad + Math.PI + (CHASE_SIDE_DEG * Math.PI) / 180;
  const f = forwardOf(back);
  const x = centre.x + f.x * CHASE_BACK_M, z = centre.z + f.z * CHASE_BACK_M;
  // heights next to the crew are true metres (the figures are not exaggerated); terrain clearance follows the scaled ground
  const y = Math.max(centre.y + CHASE_UP_M, groundY(x, z) + CHASE_MIN_CLEAR_M * exag);
  const ahead = forwardOf(headingRad);
  const lx = centre.x + ahead.x * CHASE_LOOK_AHEAD_M, lz = centre.z + ahead.z * CHASE_LOOK_AHEAD_M;
  return { cam: { x, y, z }, look: { x: lx, y: Math.max(centre.y, groundY(lx, lz)) + CHASE_LOOK_UP_M, z: lz } };
}

/**
 * Visible scale of the crew and rover. True size whenever the chase camera follows (or in the helmet); from a far orbit
 * camera they are enlarged so they stay visible, and the tag says so. Positions, times and battery are never scaled.
 */
export function visibleScale(distM: number, trueSize: boolean): number {
  return trueSize ? 1 : Math.min(160, Math.max(1, distM / 70));
}

/* ------------------------------------------------------------------ gait */

/** Leg segment lengths (m): hip joint to knee, knee to ankle, ankle to sole. They add up to the hip height. */
export const THIGH_M = 0.45, SHIN_M = 0.4, FOOT_M = 0.08;
export const HIP_Y = THIGH_M + SHIN_M + FOOT_M;

export interface LegAngles { hip: number; knee: number; ankle: number }

/**
 * One leg at gait phase `phase` (radians, one full stride per 2 pi) and amplitude 0..1. Hip angle positive = thigh forward;
 * knee angle positive = shin folded back. The knee folds in the swing half (hip moving forward), the stance leg stays
 * nearly straight, and the ankle keeps the sole level so the planted boot does not tip.
 */
export function legAngles(phase: number, amp: number): LegAngles {
  const hip = 0.42 * amp * Math.sin(phase);
  const swing = Math.max(0, Math.cos(phase));               // hip moving forward
  const knee = amp * (0.08 + 0.75 * Math.pow(swing, 1.6));
  return { hip, knee, ankle: -(hip - knee) };
}

/** Vertical reach of a leg from the hip joint to the sole (m). */
export function legReach(a: LegAngles): number {
  return THIGH_M * Math.cos(a.hip) + SHIN_M * Math.cos(a.hip - a.knee) + FOOT_M;
}

/** Pelvis drop (m, <= 0) that keeps the lower foot exactly on the ground. */
export function pelvisDrop(l: LegAngles, r: LegAngles): number {
  return Math.max(legReach(l), legReach(r)) - HIP_Y;
}
