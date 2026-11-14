'use client';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useRuntime } from '@/state/services';
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

const STEPS = ['Click the ground.', 'Ask.', 'Change a limit and it replans.'];
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

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

export function Intro() {
  const open = useIntro((st) => st.open);
  const startRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { pct, done, error } = useLoadFraction();

  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }
    useIntro.setState({ open: !seen });
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    startRef.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); useIntro.getState().hide(); return; }
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) {
        e.preventDefault(); useIntro.getState().hide(); return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open]);

  if (!open) return null;
  const sources = () => { useIntro.getState().hide(); useWorld.getState().patch({ sourcesOpen: true }); };
  return (
    <div className={s.introBack}>
      <div ref={dialogRef} className={`${s.panel} ${s.intro}`} role="dialog" aria-modal="true" aria-labelledby="intro-title" aria-describedby="intro-lede">
        <h2 id="intro-title" className={s.introTitle}>
          <img src="/art/wordmark.svg" alt="MarsWalk Copilot" width={520} height={96} />
        </h2>
        <div className={s.introLedeRow}>
          <p id="intro-lede" className={s.introLede}>Point at Jezero Crater, ask a question, and an AI copilot plans your Marswalk on real NASA terrain.</p>
          <img className={s.introScout} src="/art/scout-idle.svg" alt="" width={72} height={72} />
        </div>
        <ol className={s.introSteps}>
          {STEPS.map((t) => <li key={t}>{t}</li>)}
        </ol>
        <div className={s.introActions}>
          <button ref={startRef} className={`${s.btn} ${s.btnPrimary} ${s.introStart}`} onClick={() => useIntro.getState().hide()}>Start exploring</button>
          <button className={s.introLink} onClick={sources} aria-haspopup="dialog">Data sources</button>
        </div>
        <div className={s.introLoad} role="status" aria-live="polite">
          <div className={s.bar} data-status={error ? 'error' : undefined} role="progressbar" aria-label="Loading terrain" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className={s.introLoadText}>{error ? 'Loading failed. Close this to see details.' : done ? 'Terrain ready' : `Loading terrain, ${pct}%`}</span>
        </div>
        <div className={s.introCredit}>
          <p>Made by Ng Yu Hang, team Ecliptical</p>
          <p>NASA Space Apps Challenge 2026, Singapore</p>
          <p>Challenge: Interplanetary Survival Guide: Martian Map</p>
        </div>
        <p className={s.introFoot}>Data: NASA MRO CTX, Mars Odyssey THEMIS, USGS SIM 3464, Perseverance. Not affiliated with or endorsed by NASA.</p>
      </div>
    </div>
  );
}
