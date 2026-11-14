'use client';
/** DOM overlays that belong to the Ops layer: verdict word, drag and lasso readouts, scenario bar, cuff sheet. */
import { useMemo } from 'react';
import { HelmetHud } from '@/components/Scenario/HelmetHud';
import { LandingCaption } from '@/components/Scenario/LandingPlayback';
import { PlaybackBar } from '@/components/Scenario/PlaybackBar';
import type { PlaybackMarker } from '@/components/Scenario/PlaybackBar';
import { useWalkUi } from '@/components/Scenario/walkStore';
import s from '@/components/HUD/hud.module.css';
import { getScenario } from '@/lib/scenario';
import { useHud } from '@/state/hud';
import { useThrottledT } from '@/state/playback';
import { useGlobal } from '@/state/services';
import { useGlobeStore } from '@/state/globe';
import { useWorld } from '@/state/world';
import { downloadCuff, openCuff } from './cuffExport';
import { getOps } from '@/app/flow';
import { ltstAt, sunElevationAt } from './routeOps';
import { useWalkTimeline } from './useWalk';

export function VerdictWord() {
  const v = useHud((h) => h.verdict);
  const start = useHud((h) => h.startUtcMs);
  const route = useWorld((w) => (v ? w.routes[v.routeId] : undefined));
  if (!v) return null;
  return (
    <div className={s.verdict} role="status" aria-live="polite">
      <span className={s.verdictWord} data-tone={v.tone}>{v.word}</span>
      <span className={s.verdictReason}>{v.reason}</span>
      {route && <span className={s.verdictTime}>start {new Date(start).toISOString().slice(11, 16)} UTC, local solar time {ltstAt(start, route.from.lon)}</span>}
    </div>
  );
}

export function DragLabel() {
  const pv = useHud((h) => h.preview);
  if (!pv) return null;
  return <div className={s.dragLabel} style={{ left: pv.at.x + 14, top: pv.at.y + 16 }}>{pv.label}</div>;
}

export function LassoOverlay() {
  const pts = useHud((h) => h.lasso);
  const label = useHud((h) => h.lassoLabel);
  if (!pts || pts.length < 2) return null;
  const last = pts[pts.length - 1];
  return (
    <>
      <svg className={s.lassoSvg} aria-hidden>
        <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(236,231,225,0.05)" stroke="#ece7e1" strokeWidth={1.5} strokeDasharray="6 4" />
      </svg>
      {label && <div className={s.dragLabel} style={{ left: last.x + 14, top: last.y + 16 }}>{label}</div>}
    </>
  );
}

/** Bottom bar and overlays for whichever scenario is running: crew walk (sun arc), helmet HUD, or landing playback. */
export function ScenarioBar() {
  const walkOn = useHud((h) => h.walkOn);
  const landing = useHud((h) => h.landing);
  const mode = useGlobeStore((g) => g.mode);
  if (mode === 'jezero' && walkOn) return <WalkBar />;
  if (mode === 'globe' && landing) return <LandingBar />;
  return null;
}

function WalkBar() {
  const tl = useWalkTimeline();
  const start = useHud((h) => h.startUtcMs);
  const route = useWorld((w) => (tl ? w.routes[tl.routeId] : undefined));
  const helmet = useWalkUi((w) => w.helmet);
  const t = useThrottledT(4);
  const site = route?.from;
  const sun = useMemo(() => (site ? (tS: number) => sunElevationAt(site, start, tS) : undefined), [site, start]);
  const markers = useMemo<PlaybackMarker[]>(() => (tl ? tl.markers.filter((m) => m.kind !== 'start' && m.kind !== 'end').map((m) => ({ tS: m.tS, label: m.label, kind: m.kind === 'turn-back' ? 'warn' as const : 'normal' as const })) : []), [tl]);
  if (!tl || !sun) return null;
  const ops = getOps(tl.routeId);
  let comms: boolean | null = null;
  if (ops?.comms) {
    const n = ops.comms.visible.length;
    const idx = Math.min(n - 1, Math.max(0, Math.round((t / Math.max(1, tl.durationS)) * (n - 1))));
    comms = ops.comms.visible[idx] ?? null;
  }
  return (
    <>
      <HelmetHud timeline={tl} sunElevationDeg={sun} commsVisible={comms} />
      {helmet && <button className={`${s.link} ${s.exitHelmet}`} onClick={() => useWalkUi.getState().setHelmet(false)}>Exit helmet view</button>}
      <PlaybackBar markers={markers} sunElevationDeg={sun} clockLabel="sun arc, local time" />
    </>
  );
}

function LandingBar() {
  const landing = useHud((h) => h.landing)!;
  const gs = useGlobal((g) => g.gs);
  const phases = useMemo(() => gs?.edlPhases() ?? [], [gs]);
  const rec = getScenario(landing.scenarioId);
  const markers = useMemo<PlaybackMarker[]>(() => phases.map((p) => ({ tS: p.tStartS, label: p.label })), [phases]);
  return (
    <>
      <LandingCaption phases={phases} result={rec?.result} maxSlopeDeg={landing.maxSlopeDeg} />
      <PlaybackBar markers={markers} clockLabel="since entry" />
    </>
  );
}

export function CuffSheet() {
  const sheet = useHud((h) => h.sheet);
  const cuff = useHud((h) => h.cuff);
  if (sheet !== 'cuff' || !cuff) return null;
  return (
    <div className={s.cuff} role="region" aria-label="Cuff card">
      <div className={s.cuffBody} dangerouslySetInnerHTML={{ __html: cuff.svg }} />
      <div className={s.cuffBar}>
        <button className={s.link} onClick={() => downloadCuff(cuff)}>Download</button>
        <button className={s.link} onClick={() => openCuff(cuff)}>Open in a tab</button>
        <button className={s.link} onClick={() => useHud.getState().setSheet(null)}>Close</button>
      </div>
    </div>
  );
}

export function ReachProgress() {
  const p = useHud((h) => h.reachProgress);
  return p ? <p className={s.reach} role="status">{p}</p> : null;
}
