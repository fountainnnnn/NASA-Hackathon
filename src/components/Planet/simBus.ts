/**
 * Entry point for simulations that put 3D objects on the planet. Light on purpose: no Cesium import, so the app can call it
 * from anywhere; the planet's landing layer subscribes and builds the scene once Cesium is running.
 */
import type { LonLat } from '../../lib/contracts';
import type { EdlPhase } from '../../lib/globeContracts';
import { landingDurationS } from '../Scenario/landing';
import { usePlayback, type PlaybackSpeed } from '../../state/playback';
import { useGlobal } from '../../state/services';

export interface LandingSimResult { points: Float32Array; okFraction?: number }
export interface LandingSimOptions {
  maxSlopeDeg?: number;
  ellipse?: { semiMajorKm: number; semiMinorKm: number; azimuthDeg: number };
  /** Playback speed, default 60. */
  speed?: PlaybackSpeed;
  /** Draw the phase caption inside the planet view (default true; the HUD's own caption is not used on this path). */
  caption?: boolean;
}
export interface LandingSimSpec {
  id: string; site: LonLat; points: Float32Array; maxSlopeDeg: number;
  ellipse?: LandingSimOptions['ellipse']; phases: EdlPhase[]; caption: boolean;
}

let current: LandingSimSpec | null = null;
let seq = 0;
const listeners = new Set<() => void>();
export const currentSim = () => current;
export const onSimChange = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const emit = () => listeners.forEach((l) => l());

/** NASA/JPL Mars 2020 EDL phases (public/data/global/edl_mars2020.json), from the loaded global data or fetched directly. */
export async function loadEdlPhases(): Promise<EdlPhase[]> {
  const fromGs = useGlobal.getState().gs?.edlPhases() ?? [];
  if (fromGs.length) return fromGs;
  const r = await fetch('/data/global/edl_mars2020.json');
  const j = (await r.json()) as { phases: EdlPhase[] };
  return j.phases;
}

/**
 * Run the landing simulation on the planet: a 3D lander descends the EDL arc to `site` on the real Mars Trek terrain,
 * phase captions follow the cited timeline, and the Monte-Carlo touchdowns appear on the ground after touchdown.
 * Drives the shared playback clock (1x, 10x, 60x, 600x).
 */
export async function startLandingSimulation(site: LonLat, result: LandingSimResult, opts: LandingSimOptions = {}): Promise<void> {
  const phases = await loadEdlPhases();
  const id = `sim-${++seq}`;
  current = { id, site, points: result.points, maxSlopeDeg: opts.maxSlopeDeg ?? 15, ellipse: opts.ellipse, phases, caption: opts.caption ?? true };
  usePlayback.getState().load({ scenarioId: `landing-${id}`, kind: 'landing', durationS: landingDurationS(phases), autoplay: true, speed: opts.speed ?? 60 });
  emit();
}

export function stopLandingSimulation(): void {
  if (!current) return;
  current = null; emit();
}
