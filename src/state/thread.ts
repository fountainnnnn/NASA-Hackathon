/**
 * The MarsAgent thread: ONE conversation shown in two places (the compact card on the map and the panel on the right).
 * Every action, typed, spoken, clicked or dragged, becomes a turn. A turn streams narration lines while it works,
 * keeps the steps it took (model, tool, calculation, verdict) with real substituted numbers, and ends with an answer.
 * Imports are relative so this file is unit-testable without a bundler alias.
 */
import { create } from 'zustand';
import type { LonLat } from '../lib/contracts';

export type Origin = 'map' | 'panel' | 'drag' | 'lasso' | 'tool';
export type Tone = 'go' | 'caution' | 'nogo';
export type DotTone = Tone | 'info' | 'none';

export interface Ask { text: string; origin: Origin; at?: LonLat | null }

export interface NarrLine {
  id: string;
  text: string;
  status: 'active' | 'done' | 'error';
  /** When the line was opened (performance.now() clock). */
  startedMs?: number;
  /**
   * This line's OWN measured duration in ms: from the moment the work it describes started to the moment it finished.
   * Undefined for a line that reports something already known (no work of its own), which shows no time.
   */
  tMs?: number;
}

export type StepKind = 'input' | 'model' | 'tool' | 'calculation' | 'verdict';
export interface StepSrc { title: string; url?: string }
export interface WorkStep {
  id: string;
  kind: StepKind;
  title: string;
  /** Right-hand meta: a duration, a clock time or a count. */
  meta?: string;
  /** Measured time of this step's own work, ms (the report prints it, or "under 1 ms"). */
  durMs?: number;
  /** Plain line under the title. */
  text?: string;
  /** Formula block, one string per line, with the real numbers already substituted. */
  code?: string[];
  sources?: StepSrc[];
  /** Arguments and result for the raw JSON view. */
  raw?: unknown;
  tone?: Tone;
}

export interface Row { label: string; value: string; tone?: DotTone; src?: string }
export interface CardAction { label: string; icon: string; verb: string }

/** One Perseverance raw image (NASA/JPL-Caltech), as shown in the "View from the ground" strip. */
export interface GroundPhoto { id: string; url: string; pageUrl?: string; sol: number; earthDate: string; camera: string; cameraFull: string; credit: string }
/** The nearest Perseverance view to a target: the frames, the sol and how far from the target they were taken. */
export interface GroundView { sol: number; distanceM: number; photos: GroundPhoto[] }
/** Science at a target: the mapped geologic unit and the nearest curated science site. */
export interface ScienceNote {
  unit: { symbol: string; name: string } | null;
  site: { name: string; distanceKm: number; url?: string; sourceTitle?: string } | null;
  ground: GroundView | null;
}
export interface MapCard {
  /** GO / HOLD / NO GO, or null for a place card. */
  word?: { text: 'GO' | 'HOLD' | 'NO GO'; tone: Tone } | null;
  title: string;
  sub?: string;
  rows: Row[];
  actions: CardAction[];
  point: LonLat;
  askHint?: string;
  /** Science at the target and the nearest view from the ground (route cards). */
  science?: ScienceNote | null;
}

/** "Why <VERDICT>": the verdict word and 2 to 4 plain lines; a line with `step` links to the working step whose title matches it (regex source). */
export interface Why { word: string; tone: Tone; lines: { text: string; step?: string }[] }

export interface Answer {
  /** 'info' is a neutral lead (no verdict), e.g. "Coarse terrain only." */
  why?: Why | null;
  lead?: { text: string; tone: Tone | 'info' } | null;
  text: string;
  rows?: Row[];
  unverified?: string[];
  science?: ScienceNote | null;
}

export interface Recompute { title: string; code: string[] }

export interface Turn {
  id: string;
  seq: number;
  ask: Ask;
  startedAt: number;
  endedAt?: number;
  status: 'working' | 'done' | 'error';
  /** 'deterministic' (fixed code, no model) or the model id. */
  engine: string;
  narration: NarrLine[];
  steps: WorkStep[];
  answer?: Answer;
  recompute?: Recompute;
  card?: MapCard;
  /** Show the report card at the end of this turn. */
  report: boolean;
  /** Point the map card is anchored to (the click, the drag target, the lasso centre). */
  point?: LonLat | null;
}

interface ThreadState {
  turns: Turn[];
  /** The turn whose card is on the map (null = card closed). */
  cardTurnId: string | null;
  /** Presentation pace for revealing narration lines, ms per line. The real elapsed times are shown regardless. */
  paceMs: number;
  /** Ask the panel to scroll to a turn and flash its border (from "in panel" on the map card). */
  focusTurnId: string | null;
  focusSeq: number;
  begin(ask: Ask, o?: { engine?: string; point?: LonLat | null; showCard?: boolean }): string;
  patch(id: string, p: Partial<Turn>): void;
  line(id: string, text: string, status?: NarrLine['status']): string;
  lineDone(id: string, lineId: string, text?: string, status?: 'done' | 'error'): void;
  /** Change an active line's text (progress such as "7 of 24 plans"). */
  lineText(id: string, lineId: string, text: string): void;
  /** Restart an active line's clock (its work starts now). */
  lineStart(id: string, lineId: string): void;
  step(id: string, s: Omit<WorkStep, 'id'>): string;
  finish(id: string, p: { answer?: Answer; card?: MapCard; recompute?: Recompute; report?: boolean; status?: 'done' | 'error' }): void;
  closeCard(): void;
  openCard(id: string): void;
  setPace(ms: number): void;
  focus(id: string): void;
  reset(): void;
}

let seq = 0, lineSeq = 0, stepSeq = 0;
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const MAX_TURNS = 60;

const mapTurn = (turns: Turn[], id: string, f: (t: Turn) => Turn) => turns.map((t) => (t.id === id ? f(t) : t));

export const useThread = create<ThreadState>((set) => ({
  turns: [],
  cardTurnId: null,
  paceMs: 160,
  focusTurnId: null,
  focusSeq: 0,
  begin: (ask, o = {}) => {
    const id = `T${++seq}`;
    const turn: Turn = {
      id, seq, ask, startedAt: Date.now(), status: 'working', engine: o.engine ?? 'deterministic',
      narration: [], steps: [], report: false, point: o.point ?? ask.at ?? null,
    };
    set((s) => ({ turns: [...s.turns, turn].slice(-MAX_TURNS), cardTurnId: o.showCard === false ? s.cardTurnId : id }));
    return id;
  },
  patch: (id, p) => set((s) => ({ turns: mapTurn(s.turns, id, (t) => ({ ...t, ...p })) })),
  line: (id, text, status = 'active') => {
    const lid = `L${++lineSeq}`;
    set((s) => ({ turns: mapTurn(s.turns, id, (t) => ({ ...t, narration: [...t.narration, { id: lid, text, status, startedMs: nowMs() }] })) }));
    return lid;
  },
  lineDone: (id, lineId, text, status = 'done') => set((s) => ({
    turns: mapTurn(s.turns, id, (t) => ({
      ...t,
      narration: t.narration.map((l) => (l.id === lineId && l.status === 'active' ? { ...l, text: text ?? l.text, status, tMs: nowMs() - (l.startedMs ?? nowMs()) } : l)),
    })),
  })),
  lineText: (id, lineId, text) => set((s) => ({
    turns: mapTurn(s.turns, id, (t) => ({ ...t, narration: t.narration.map((l) => (l.id === lineId ? { ...l, text } : l)) })),
  })),
  lineStart: (id, lineId) => set((s) => ({
    turns: mapTurn(s.turns, id, (t) => ({ ...t, narration: t.narration.map((l) => (l.id === lineId ? { ...l, startedMs: nowMs() } : l)) })),
  })),
  step: (id, st) => {
    const sid = `S${++stepSeq}`;
    set((s) => ({ turns: mapTurn(s.turns, id, (t) => ({ ...t, steps: [...t.steps, { ...st, id: sid }] })) }));
    return sid;
  },
  finish: (id, p) => set((s) => ({
    turns: mapTurn(s.turns, id, (t) => ({
      ...t, status: p.status ?? 'done', endedAt: Date.now(),
      narration: t.narration.map((l) => (l.status === 'active' ? { ...l, status: 'done', tMs: nowMs() - (l.startedMs ?? nowMs()) } : l)),
      ...(p.answer ? { answer: p.answer } : {}), ...(p.card ? { card: p.card } : {}), ...(p.recompute ? { recompute: p.recompute } : {}),
      report: p.report ?? t.report,
    })),
  })),
  closeCard: () => set({ cardTurnId: null }),
  openCard: (id) => set({ cardTurnId: id }),
  setPace: (paceMs) => set({ paceMs: Math.max(0, paceMs) }),
  focus: (id) => set((s) => ({ focusTurnId: id, focusSeq: s.focusSeq + 1 })),
  reset: () => set({ turns: [], cardTurnId: null, focusTurnId: null }),
}));

export const turnById = (id: string | null) => (id ? useThread.getState().turns.find((t) => t.id === id) ?? null : null);
export const latestTurn = () => useThread.getState().turns.at(-1) ?? null;

/** Elapsed time label: "4 ms", "1.24 s", "12 s". */
export function fmtElapsed(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 100) return `${Math.max(1, Math.round(ms))} ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(2)} s` : `${Math.round(s)} s`;
}

/** A narration line's own duration as shown beside it; nothing under 5 ms (instant work is not worth a number). */
export function lineTime(ms: number | undefined): string {
  return ms == null || !Number.isFinite(ms) || ms < 5 ? '' : fmtElapsed(ms);
}

/** A step's measured time for the report: "under 1 ms", "4 ms", "1.24 s". */
export function stepTime(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  return ms < 1 ? 'under 1 ms' : fmtElapsed(ms);
}

/**
 * Narrator handle for one turn. `say` opens a line for work that is about to run: present tense ("Checking ..."), the
 * static loader icon, and on `done(past)` the past tense with a check and the line's OWN measured duration. `note` adds
 * a line that reports something already known (past tense, no time). `run` wraps a piece of work in a line and yields
 * a frame first, so the active line is on screen while slow work (A*, reach, Monte Carlo) runs.
 */
export interface Narrator {
  id: string;
  say(text: string): { id: string; done(text?: string): void; fail(text?: string): void; text(t: string): void };
  note(text: string): void;
  run<T>(text: string, work: () => Promise<T> | T, after?: (r: T) => string | undefined): Promise<T>;
  step(s: Omit<WorkStep, 'id'>): string;
  finish(p: Parameters<ThreadState['finish']>[1]): void;
}

/** Resolves after the next paint (rAF then a task), or after 50 ms when frames are not running (background tab, tests). */
function paint(): Promise<void> {
  return new Promise((res) => {
    let done = false;
    const go = () => { if (!done) { done = true; res(); } };
    setTimeout(go, 50);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  });
}

export function narrator(id: string): Narrator {
  const T = () => useThread.getState();
  const say = (text: string) => {
    const lid = T().line(id, text);
    return { id: lid, done: (t?: string) => T().lineDone(id, lid, t), fail: (t?: string) => T().lineDone(id, lid, t, 'error'), text: (t: string) => T().lineText(id, lid, t) };
  };
  return {
    id,
    say,
    note: (text) => { T().line(id, text, 'done'); },
    async run(text, work, after) {
      const l = say(text);
      // yield until the active line has painted, so it is on screen while synchronous work blocks the thread
      await paint();
      T().lineStart(id, l.id); // the line's time is the work's time, not the paint wait
      try {
        const r = await work();
        l.done(after?.(r));
        return r;
      } catch (e) { l.fail(`${text}: ${e instanceof Error ? e.message : 'failed'}`); throw e; }
    },
    step: (s) => T().step(id, s),
    finish: (p) => T().finish(id, p),
  };
}
