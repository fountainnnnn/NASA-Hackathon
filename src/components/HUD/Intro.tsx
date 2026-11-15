'use client';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useRuntime } from '@/state/services';
import { useHud } from '@/state/hud';
import { useWorld } from '@/state/world';
import s from './hud.module.css';

const KEY = 'marswalk-intro-seen';

/** open: null until the first client effect has checked localStorage (avoids a flash on return visits). */
export const useIntro = create<{ open: boolean | null; show(): void; hide(): void }>((set) => ({
  open: null,
  show: () => set({ open: true }),
  hide: () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
    set({ open: false });
  },
}));

function useLoadFraction() {
  const steps = useRuntime((st) => st.steps);
  const error = useRuntime((st) => st.error);
  const rt = useRuntime((st) => st.rt);
  const ready = useWorld((st) => st.ready);
  const done = !!rt && ready;
  const total = steps.length || 1;
  const sum = steps.reduce((a, t) => a + (t.status === 'done' ? 1 : t.progress ?? 0), 0);
  return { pct: done ? 100 : Math.min(99, Math.round((sum / total) * 100)), done, error };
}

/** Start card: a near-black cover that fades to the globe, not a modal over the map. Reopened by the About icon. */
export function Intro() {
  const open = useIntro((st) => st.open);
  const startRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { pct, done, error } = useLoadFraction();

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }
    useIntro.setState({ open: !seen });
  }, []);

  // modal: while the card is up, nothing behind it can take focus
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const others = root ? [...(root.parentElement?.children ?? [])].filter((c) => c !== root && c.tagName !== 'STYLE') : [];
    others.forEach((o) => o.setAttribute('inert', ''));
    return () => others.forEach((o) => o.removeAttribute('inert'));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    startRef.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && e.target === document.body)) { e.preventDefault(); useIntro.getState().hide(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);

  if (open === null) return <div className={s.intro} aria-hidden />;
  const sources = () => { useIntro.getState().hide(); useHud.getState().setSheet('sources'); };
  return (
    <div ref={rootRef} className={s.intro} data-out={!open} data-modal role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-hidden={!open} inert={!open}>
      <div className={s.introBox}>
        <h1 id="intro-title" className={s.introTitle}>HEYMARS</h1>
        <p className={s.introLede}>Click anywhere on Mars and MarsAgent reads the data there. In Jezero Crater, drag to look around, pick Plan on the left and drag from the base to plan a walk, then see every calculation behind the verdict.</p>
        <div className={s.introActions}>
          <button ref={startRef} className={s.primary} onClick={() => useIntro.getState().hide()}>Start</button>
          <button className={s.link} onClick={sources}>Sources</button>
        </div>
        <div className={s.introLoad} role="status" aria-live="polite">
          <div className={s.introBar} role="progressbar" aria-label="Loading terrain" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
          <span className={s.introLoadText}>{error ? 'Terrain failed to load. Reload to try again.' : done ? 'Terrain ready' : `Loading terrain ${pct}%`}</span>
        </div>
        <div className={s.introCredit}>
          <span>Made by Ng Yu Hang, team Ecliptical.</span>
          <span>NASA Space Apps Challenge 2026, Singapore.</span>
          <span>Challenge: Interplanetary Survival Guide: Martian Map.</span>
        </div>
        <p className={s.introFoot}>Not affiliated with or endorsed by NASA.</p>
      </div>
    </div>
  );
}
