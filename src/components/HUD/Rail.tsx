'use client';
import { ClipboardList, Database, Footprints, Lasso, Layers, PlaneLanding, Radar, Route, ScanEye, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { V } from '@/app/verbs';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { emitAsk } from '@/state/companion';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { usePlayback } from '@/state/playback';
import { useShell } from '@/state/shell';
import { GlobeLayers, JezeroLayers, Limits } from './Chrome';
import s from './shell.module.css';

interface Tool { id: string; label: string; Icon: LucideIcon; tip: string; active: boolean; run(): void; pop?: 'layers' | 'limits' }

function Popover({ id, title, onClose, children }: { id: string; title: string; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, button:not([data-close])')?.focus({ preventScroll: true }); }, []);
  return (
    <div ref={ref} id={id} className={s.pop} role="dialog" aria-label={title} data-avoid>
      <div className={s.popHead}><h3>{title}</h3><button type="button" data-close className={s.popClose} aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={14} strokeWidth={1.5} aria-hidden /></button></div>
      {children}
    </div>
  );
}

/** Left rail: Lucide icon plus an 8.5 px label for each tool, a tooltip with one line of what it does, the active tool highlighted. */
export function Rail() {
  const tool = useShell((x) => x.tool);
  const mode = useGlobeStore((g) => g.mode);
  const popover = useHud((h) => h.popover);
  const sheet = useHud((h) => h.sheet);
  const walkOn = useHud((h) => h.walkOn);
  const reachOn = useHud((h) => h.reachOn);
  const landing = useHud((h) => h.landing);
  const helmet = useWalkUi((w) => w.helmet);
  const rover = useWalkUi((w) => w.roverFraction);
  const ask = (verb: string) => emitAsk(verb, { origin: 'tool' });
  const stopWalk = () => { useWalkUi.getState().setHelmet(false); useHud.getState().patch({ walkOn: false }); usePlayback.getState().pause(); };

  const tools: Tool[] = [
    { id: 'plan', label: 'Plan', Icon: Route, tip: 'Drag from the base to plan a round trip', active: tool === 'plan', run: () => (tool === 'plan' ? useShell.getState().setTool(null) : ask(V.plan)) },
    { id: 'lasso', label: 'Lasso', Icon: Lasso, tip: 'Draw a loop to read slope, geology and stops inside', active: tool === 'lasso', run: () => (tool === 'lasso' ? useShell.getState().setTool(null) : ask(V.lasso)) },
    { id: 'landing', label: 'Landing', Icon: PlaneLanding, tip: 'Check the clicked point against landing criteria', active: !!landing, run: () => ask(V.land) },
    { id: 'walk', label: 'Walk', Icon: Footprints, tip: 'Play two astronauts walking the planned route', active: walkOn && !helmet && rover === 0, run: () => (walkOn && !helmet && rover === 0 ? stopWalk() : ask(V.walk)) },
    { id: 'helmet', label: 'Helmet', Icon: ScanEye, tip: "See the walk from the lead astronaut's helmet", active: helmet, run: () => (helmet ? useWalkUi.getState().setHelmet(false) : ask(V.helmet)) },
    { id: 'reach', label: 'Reach', Icon: Radar, tip: 'Where the crew can go from base and still get home', active: reachOn, run: () => (reachOn ? useHud.getState().patch({ reachOn: false }) : ask(V.reach)) },
  ];
  const panels: Tool[] = [
    { id: 'layers', label: 'Layers', Icon: Layers, tip: mode === 'globe' ? 'Orbital layers on the planet' : 'Imagery, geology and slope on the 20 m terrain', active: popover === 'layers', run: () => useHud.getState().togglePopover('layers'), pop: 'layers' },
    { id: 'limits', label: 'Limits', Icon: SlidersHorizontal, tip: 'Mission limits and suit assumptions', active: popover === 'limits', run: () => useHud.getState().togglePopover('limits'), pop: 'limits' },
    { id: 'sources', label: 'Sources', Icon: Database, tip: 'Where every number comes from', active: sheet === 'sources', run: () => useHud.getState().setSheet(sheet === 'sources' ? null : 'sources') },
    { id: 'cuff', label: 'Cuff card', Icon: ClipboardList, tip: 'Wrist checklist for the planned route', active: sheet === 'cuff', run: () => (sheet === 'cuff' ? useHud.getState().setSheet(null) : ask(V.cuff)) },
  ];

  // Escape closes an open popover and returns focus to its button
  useEffect(() => {
    if (!popover) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const p = useHud.getState().popover;
      useHud.getState().setPopover(null);
      document.getElementById(`rail-${p}`)?.focus();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [popover]);

  const item = (t: Tool) => (
    <div key={t.id} className={s.railItem}>
      <button
        id={`rail-${t.id}`} type="button" className={s.tool} onClick={t.run} aria-describedby={`tip-${t.id}`}
        {...(t.pop ? { 'aria-expanded': t.active, 'aria-controls': `pop-${t.id}` } : { 'aria-pressed': t.active })}
      >
        <t.Icon size={16} strokeWidth={1.5} aria-hidden /><span>{t.label}</span>
      </button>
      <span id={`tip-${t.id}`} role="tooltip" className={s.tip}><b>{t.label}</b><span>{t.tip}</span></span>
      {t.pop === 'layers' && popover === 'layers' && <Popover id="pop-layers" title="Layers" onClose={() => useHud.getState().setPopover(null)}>{mode === 'globe' ? <GlobeLayers /> : <JezeroLayers />}</Popover>}
      {t.pop === 'limits' && popover === 'limits' && <Popover id="pop-limits" title="Mission limits" onClose={() => useHud.getState().setPopover(null)}><Limits /></Popover>}
    </div>
  );

  return (
    <nav className={s.rail} aria-label="Tools" data-avoid data-open-pop={!!popover}>
      {tools.map(item)}
      <hr className={s.railRule} />
      {panels.map(item)}
    </nav>
  );
}
