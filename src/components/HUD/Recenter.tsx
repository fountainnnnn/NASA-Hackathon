'use client';
/**
 * GPS-style "Recenter" (QA round 3). Appears once the view has left the scenario's framing: the walk's chase camera was
 * broken out of (orbit, pan, zoom), a navigation drag or zoom in Jezero, or a camera move during the landing simulation.
 * Click (or press C) flies back: the walk re-engages the chase camera, the landing calls the simulation's recenterLanding()
 * export when it exists, and Jezero frames the active route (or the base). Hidden in the helmet view.
 */
import { LocateFixed } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as LandingMod from '@/components/Planet/landing';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { recenterJezero } from '@/app/flow';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { useShell } from '@/state/shell';
import s from './shell.module.css';

/** The landing simulation's own recenter, when its engineer exports it (assumed name: recenterLanding). */
const recenterLanding = (LandingMod as unknown as Record<string, unknown>).recenterLanding as (() => void) | undefined;
/** A drag farther than this (px) or any wheel or pinch counts as moving the view away. */
const DRIFT_PX = 24;

export function Recenter() {
  const mode = useGlobeStore((g) => g.mode);
  const walkOn = useHud((h) => h.walkOn);
  const landing = useHud((h) => h.landing);
  const route = useHud((h) => h.activeRouteId);
  const helmet = useWalkUi((w) => w.helmet);
  const follow = useWalkUi((w) => w.followCrew);
  const [drift, setDrift] = useState(false);

  // a new scenario, route or mode starts framed
  useEffect(() => { setDrift(false); }, [mode, walkOn, landing, route]);

  useEffect(() => {
    const onStage = (e: Event) => !!(e.target as Element | null)?.closest?.('[data-stage] canvas');
    let down: { x: number; y: number } | null = null;
    const navigating = () => { const t = useShell.getState().tool; return t !== 'plan' && t !== 'lasso'; };
    const pd = (e: PointerEvent) => { down = onStage(e) && navigating() ? { x: e.clientX, y: e.clientY } : null; };
    const pm = (e: PointerEvent) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRIFT_PX) { setDrift(true); down = null; } };
    const pu = () => { down = null; };
    const wh = (e: WheelEvent) => { if (onStage(e)) setDrift(true); };
    window.addEventListener('pointerdown', pd, true);
    window.addEventListener('pointermove', pm, true);
    window.addEventListener('pointerup', pu, true);
    window.addEventListener('wheel', wh, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', pd, true);
      window.removeEventListener('pointermove', pm, true);
      window.removeEventListener('pointerup', pu, true);
      window.removeEventListener('wheel', wh, { capture: true });
    };
  }, []);

  const walkDrift = walkOn && !helmet && !follow;
  const landingDrift = mode === 'globe' && !!landing && drift && !!recenterLanding;
  const jezeroDrift = mode === 'jezero' && !walkOn && drift;
  const show = !helmet && (walkDrift || landingDrift || jezeroDrift);

  const recenter = () => {
    if (mode === 'jezero' && walkOn) useWalkUi.getState().setFollowCrew(true);
    else if (mode === 'globe' && landing) recenterLanding?.();
    else if (mode === 'jezero') recenterJezero();
    setDrift(false);
  };

  useEffect(() => {
    if (!show) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) { e.preventDefault(); recenter(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (!show) return null;
  return (
    <button type="button" className={s.recenter} onClick={recenter} data-avoid title="Fly back to the framed view (C)" aria-keyshortcuts="C">
      <LocateFixed size={14} strokeWidth={1.75} aria-hidden />Recenter
    </button>
  );
}
