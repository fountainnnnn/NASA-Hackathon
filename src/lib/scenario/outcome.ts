/**
 * End-of-simulation events for the shell's completion card. Each simulation emits once when its playback reaches the end
 * (and again after a Replay or a seek back past the end): landing (after the Monte-Carlo testing phase), walk, rover
 * assist, and base camp reach (when the 24 plans are done). The latest outcome is also kept in a store.
 */
import { create } from 'zustand';
import type { VerdictTone, VerdictWord } from './verdict';

export type OutcomeKind = 'landing' | 'walk' | 'rover-walk' | 'base-camp';

export interface ScenarioOutcome {
  kind: OutcomeKind;
  /** Playback scenario id (landing: the scenario id "S1"..., walk: the route id, base camp: "reach"). */
  id: string;
  verdict: VerdictWord;
  /** Verdict word plus " (includes estimates)" where that applies. */
  label: string;
  tone: VerdictTone;
  reason: string;
  /** The rule that produced the verdict, when there is one line for it (landing). */
  rule?: string;
  /** Landing only: the numbers behind the verdict. */
  stats?: { samples: number; okPercent: number; nodataPercent: number; slopeP95Deg: number | null; maxSlopeDeg: number; estimated: boolean };
  at: number;
}

const listeners = new Set<(o: ScenarioOutcome) => void>();

export const useScenarioOutcome = create<{ last: ScenarioOutcome | null; clear(): void }>((set) => ({
  last: null,
  clear: () => set({ last: null }),
}));

/** Subscribe to end-of-playback outcomes. Returns the unsubscribe function. */
export function onScenarioEnd(cb: (o: ScenarioOutcome) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function emitScenarioEnd(o: Omit<ScenarioOutcome, 'at' | 'label'> & { label?: string }): ScenarioOutcome {
  const full: ScenarioOutcome = { ...o, label: o.label ?? o.verdict, at: Date.now() };
  useScenarioOutcome.setState({ last: full });
  listeners.forEach((l) => { try { l(full); } catch { /* a listener must not stop the others */ } });
  return full;
}
