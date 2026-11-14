'use client';
/**
 * Narration reveal. A line for work that is still running is on screen at once (present tense, loader icon), so slow
 * work (A*, reach, Monte Carlo) is visible while it runs. Lines that finished faster than the eye can follow are
 * revealed one by one at the thread's pace, each with its true state and its own measured duration; nothing is shown
 * as running that has already finished. One ticker drives both surfaces, the map card and the panel. Reduced motion
 * shows every line at once. Optional speech reads each line.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useShell } from '@/state/shell';
import { useThread, type NarrLine, type Turn } from '@/state/thread';

export const useReveal = create<{ shown: Record<string, number> }>(() => ({ shown: {} }));

export function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text.replace(/°/g, ' degrees').replace(/%/g, ' percent').replace(/\bkm\b/g, 'kilometres').replace(/\bA\*/g, 'A star'));
    u.rate = 1.05; u.lang = 'en-GB';
    synth.speak(u);
  } catch { /* speech synthesis unavailable */ }
}

/** Mount once (AppShell). The first line of a turn shows at once; each next finished line follows one pace later. */
export function useRevealTicker() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const last: Record<string, number> = {};
    const id = window.setInterval(() => {
      const { turns, paceMs } = useThread.getState();
      const shown = useReveal.getState().shown;
      const now = performance.now();
      let next: Record<string, number> | null = null;
      for (const t of turns) {
        const had = shown[t.id] ?? 0;
        const active = t.narration.findIndex((l) => l.status === 'active');
        const n = Math.max(had, active + 1); // a running line (and everything before it) is already on screen
        let to = n;
        if (n < t.narration.length && (n === 0 || reduced.matches || paceMs === 0 || now - (last[t.id] ?? 0) >= paceMs)) {
          to = reduced.matches || paceMs === 0 ? t.narration.length : n + 1;
          last[t.id] = now;
        }
        if (to === had) continue;
        last[t.id] = now; // the next finished line waits one pace after anything new appeared
        next ??= { ...shown };
        next[t.id] = to;
        if (useShell.getState().narrateAloud) for (let i = had; i < to; i++) speak(t.narration[i].text);
      }
      if (next) useReveal.setState({ shown: next });
    }, 50);
    return () => window.clearInterval(id);
  }, []);
}

export type LineState = 'done' | 'now' | 'error';
export interface Revealed { lines: (NarrLine & { state: LineState })[]; complete: boolean; current: (NarrLine & { state: LineState }) | null }

/**
 * Lines visible for a turn and the true state of each ("now" only while its work runs), and whether the answer may show.
 * A running line is always visible, with every line before it, whatever the pace.
 */
export function revealed(t: Turn, n: number): Revealed {
  const active = t.narration.findIndex((l) => l.status === 'active');
  const k = Math.min(t.narration.length, Math.max(n, active + 1));
  const lines = t.narration.slice(0, k).map((l) => {
    const state: LineState = l.status === 'error' ? 'error' : l.status === 'active' ? 'now' : 'done';
    return { ...l, state };
  });
  const complete = t.status !== 'working' && k >= t.narration.length;
  return { lines, complete, current: lines.at(-1) ?? null };
}

export function useRevealed(t: Turn | null): Revealed | null {
  const n = useReveal((r) => (t ? r.shown[t.id] ?? 0 : 0));
  return t ? revealed(t, n) : null;
}

/**
 * Resolves once a turn is complete on screen (finished, every line revealed). Map marks that carry a verdict wait for
 * this, so the map never shows the answer before the narration has reached it. Gives up after `timeoutMs`.
 */
export function whenRevealed(turnId: string, timeoutMs = 30_000): Promise<boolean> {
  const done = () => {
    const t = useThread.getState().turns.find((x) => x.id === turnId);
    return !t || revealed(t, useReveal.getState().shown[turnId] ?? 0).complete;
  };
  if (done()) return Promise.resolve(true);
  return new Promise((res) => {
    const stop = () => { offA(); offB(); clearTimeout(timer); };
    const check = () => { if (done()) { stop(); res(true); } };
    const offA = useReveal.subscribe(check);
    const offB = useThread.subscribe(check);
    const timer = setTimeout(() => { stop(); res(false); }, timeoutMs);
  });
}
