/**
 * Playback store: ONE timeline for the active scenario (walk, landing, rover-walk).
 * `t` and `durationS` are SIMULATED seconds. The wall-clock to simulated-time ratio is `speed`.
 * Pure helpers are exported so the clock math is unit-testable without React.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';

export type ScenarioKind = 'walk' | 'landing' | 'rover-walk';
export const SPEEDS = [1, 10, 60, 600] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];

export interface PlaybackState {
  scenarioId: string | null;
  kind: ScenarioKind;
  durationS: number;
  t: number;
  playing: boolean;
  speed: PlaybackSpeed;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  setSpeed(s: PlaybackSpeed): void;
  /** Replace the active scenario. Rewinds to 0; pass autoplay to start immediately. */
  load(s: { scenarioId: string; kind: ScenarioKind; durationS: number; autoplay?: boolean; speed?: PlaybackSpeed }): void;
  /** Clock tick: advance by wall-clock dt (seconds) times the current speed. Returns nothing; stops at the end. */
  tick(dtWallS: number): void;
}

export function clampT(t: number, durationS: number): number {
  if (!(t > 0)) return 0;
  return t > durationS ? durationS : t;
}

/** Next simulated time after dtWallS of wall clock at `speed`; `ended` when the end was reached. */
export function advance(t: number, dtWallS: number, speed: number, durationS: number): { t: number; ended: boolean } {
  const next = t + Math.max(0, dtWallS) * speed;
  if (next >= durationS) return { t: durationS, ended: true };
  return { t: next, ended: false };
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  scenarioId: null,
  kind: 'walk',
  durationS: 0,
  t: 0,
  playing: false,
  speed: 60,
  play: () => {
    const s = get();
    if (s.durationS <= 0) return;
    // pressing play at the end restarts from the beginning
    set({ playing: true, t: s.t >= s.durationS ? 0 : s.t });
  },
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
  seek: (t) => set((s) => ({ t: clampT(t, s.durationS) })),
  setSpeed: (speed) => set({ speed }),
  load: ({ scenarioId, kind, durationS, autoplay = false, speed }) =>
    set((s) => ({ scenarioId, kind, durationS: Math.max(0, durationS), t: 0, playing: autoplay && durationS > 0, speed: speed ?? s.speed })),
  tick: (dtWallS) => {
    const s = get();
    if (!s.playing) return;
    const r = advance(s.t, dtWallS, s.speed, s.durationS);
    set(r.ended ? { t: r.t, playing: false } : { t: r.t });
  },
}));

/**
 * rAF-driven clock. Mount ONCE per page (the preview mounts it in the page; the orchestrator mounts it in the
 * app shell). dt is capped at 100 ms so a backgrounded tab does not jump the simulation.
 */
export function usePlaybackClock(): void {
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      if (last) usePlayback.getState().tick(Math.min(0.1, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** "T+01:23:45" mission time. */
export function formatMissionTime(tS: number): string {
  const s = Math.max(0, Math.floor(tS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `T+${p(h)}:${p(m)}:${p(sec)}`;
}

/** Throttled read of `t` for DOM overlays (default 15 Hz) so SVG/DOM does not re-render at 60 Hz. */
export function useThrottledT(hz = 15): number {
  const [t, setT] = useState(() => usePlayback.getState().t);
  useEffect(() => {
    const id = setInterval(() => setT((p) => { const n = usePlayback.getState().t; return n === p ? p : n; }), 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return t;
}
