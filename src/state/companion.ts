import { create } from 'zustand';
import type { LonLat } from '@/lib/contracts';
import type { CompanionState, CompanionUtterance, ScoutMood } from '@/lib/globeContracts';

export const TRAIL_MAX = 30;

export interface CompanionStore extends CompanionState {
  /** Live "doing" line shown while busy, e.g. the current TraceStep label. */
  doing: string | null;
  /** Interim speech transcript while push-to-talk is active. */
  interim: string;
  /** Up to four plain verbs under the answer. The orchestrator sets them with each `say`; empty = none. */
  actions: string[];
  /** Show something. Missing fields default; the utterance is also added to the trail and the bubble opens. */
  say: (u: { text: string; id?: string; sources?: CompanionUtterance['sources']; unverified?: string[]; point?: LonLat; at?: number; actions?: string[] }, mood?: ScoutMood) => CompanionUtterance;
  setActions: (actions: string[]) => void;
  setMood: (mood: ScoutMood) => void;
  setMode: (mode: CompanionState['mode']) => void;
  anchorToCursor: () => void;
  anchorToPoint: (p: LonLat) => void;
  openBubble: () => void;
  /** Closing returns Scout to the cursor. */
  closeBubble: () => void;
  pushTrail: (u: CompanionUtterance) => void;
  /** Re-show an older answer from the trail without adding it again. */
  showFromTrail: (id: string) => void;
  setListening: (on: boolean) => void;
  setBusy: (busy: boolean, doing?: string | null) => void;
  setInterim: (t: string) => void;
  reset: () => void;
}

const initial = (): CompanionState & { doing: string | null; interim: string; actions: string[] } => ({
  mode: 'globe', mood: 'idle', anchor: { kind: 'cursor' }, bubbleOpen: false, current: null, trail: [],
  listening: false, busy: false, doing: null, interim: '', actions: [],
});

let seq = 0;

export const useCompanion = create<CompanionStore>((set, get) => ({
  ...initial(),
  say: (u, mood) => {
    const utt: CompanionUtterance = {
      id: u.id ?? `u${Date.now().toString(36)}${(seq++).toString(36)}`,
      text: u.text, sources: u.sources ?? [], unverified: u.unverified ?? [], at: u.at ?? Date.now(), point: u.point,
    };
    set({ current: utt, bubbleOpen: true, busy: false, doing: null, mood: mood ?? 'idle', actions: (u.actions ?? []).slice(0, 4) });
    get().pushTrail(utt);
    return utt;
  },
  setActions: (actions) => set({ actions: actions.slice(0, 4) }),
  setMood: (mood) => set({ mood }),
  setMode: (mode) => set({ mode }),
  anchorToCursor: () => set({ anchor: { kind: 'cursor' } }),
  anchorToPoint: (p) => set({ anchor: { kind: 'point', lon: p.lon, lat: p.lat } }),
  openBubble: () => set({ bubbleOpen: true }),
  closeBubble: () => set({ bubbleOpen: false, anchor: { kind: 'cursor' } }),
  pushTrail: (u) => set((s) => ({ trail: [u, ...s.trail.filter((t) => t.id !== u.id)].slice(0, TRAIL_MAX) })),
  showFromTrail: (id) => {
    const u = get().trail.find((t) => t.id === id);
    if (u) set({ current: u, bubbleOpen: true });
  },
  setListening: (listening) => set({ listening, ...(listening ? {} : { interim: '' }) }),
  setBusy: (busy, doing) => set({ busy, doing: busy ? doing ?? null : null }),
  setInterim: (interim) => set({ interim }),
  reset: () => set(initial()),
}));

/* ---------------------------------------------------------------- event bus */

type AskListener = (text: string) => void;
type PointListener = (p: LonLat) => void;
const askListeners = new Set<AskListener>();
const pointListeners = new Set<PointListener>();

/** The orchestrator subscribes here to run the agent. Returns an unsubscribe function. */
export function onAsk(fn: AskListener): () => void { askListeners.add(fn); return () => { askListeners.delete(fn); }; }
/** Called by the bubble (typed, chip or voice). */
export function emitAsk(text: string): void {
  const t = text.trim();
  if (t) askListeners.forEach((fn) => fn(t));
}
/** The globe / terrain pick subscribes the other way: it emits, the orchestrator listens. */
export function onClickPoint(fn: PointListener): () => void { pointListeners.add(fn); return () => { pointListeners.delete(fn); }; }
export function emitClickPoint(p: LonLat): void { pointListeners.forEach((fn) => fn(p)); }
