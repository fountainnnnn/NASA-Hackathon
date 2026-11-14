'use client';
import { BookOpen, Info } from 'lucide-react';
import { useWorld } from '@/state/world';
import { useIntro } from './Intro';
import s from './hud.module.css';

export function TopBar() {
  return (
    <header className={`${s.panel} ${s.topbar}`}>
      <div className={s.brand}>
        <div className={s.brandRow}>
          <h1>MarsWalk <span>Copilot</span></h1>
          <span className={s.byline}>by Ng Yu Hang, team Ecliptical</span>
        </div>
        <span className={s.region}>Jezero Crater, Mars</span>
      </div>
      <p className={s.dataLine}>MRO CTX DEM 20 m, Mars 2000, areoid heights</p>
      <button className={s.btn} onClick={() => useIntro.getState().show()} aria-haspopup="dialog">
        <Info size={16} aria-hidden /> About
      </button>
      <button className={s.btn} onClick={() => useWorld.getState().patch({ sourcesOpen: true })} aria-haspopup="dialog">
        <BookOpen size={16} aria-hidden /> Sources
      </button>
    </header>
  );
}
