'use client';
import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWalkTimeline } from '@/components/Ops/useWalk';
import { sunElevationAt } from '@/components/Ops/routeOps';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { SPEEDS, formatMissionTime, usePlayback, useThrottledT } from '@/state/playback';
import { useGlobal, useRuntime } from '@/state/services';
import { useWorld } from '@/state/world';
import s from './shell.module.css';

interface Marker { tS: number; label: string; warn?: boolean }
const W = 600, H = 40, BASE = 34, TOP = 6;

/** True while a simulation (walk, landing) is loaded: the timeline replaces the status line. */
export function useSimLoaded(): boolean {
  const dur = usePlayback((p) => p.durationS);
  const walkOn = useHud((h) => h.walkOn);
  const landing = useHud((h) => h.landing);
  const mode = useGlobeStore((g) => g.mode);
  return dur > 0 && ((walkOn && mode === 'jezero') || !!landing);
}

/** Bottom timeline (46 px): play, the sun arc scrubber with phase ticks, mission time and speed 1x / 10x / 60x / 600x. */
export function Timeline() {
  const durationS = usePlayback((p) => p.durationS);
  const playing = usePlayback((p) => p.playing);
  const speed = usePlayback((p) => p.speed);
  const kind = usePlayback((p) => p.kind);
  const t = useThrottledT(30);
  const tl = useWalkTimeline();
  const start = useHud((h) => h.startUtcMs);
  const route = useWorld((w) => (tl ? w.routes[tl.routeId] : undefined));
  const gs = useGlobal((g) => g.gs);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const landing = kind === 'landing';

  const markers = useMemo<Marker[]>(() => {
    if (landing) return (gs?.edlPhases() ?? []).map((p) => ({ tS: p.tStartS, label: p.label }));
    return tl ? tl.markers.filter((m) => m.kind !== 'start' && m.kind !== 'end').map((m) => ({ tS: m.tS, label: m.label, warn: m.kind === 'turn-back' })) : [];
  }, [landing, gs, tl]);

  const sunAt = useMemo(() => (!landing && route ? (tS: number) => sunElevationAt(route.from, start, tS) : null), [landing, route, start]);
  const curve = useMemo(() => {
    if (!sunAt || durationS <= 0) return null;
    const N = 80, el: number[] = [];
    for (let i = 0; i <= N; i++) el.push(sunAt((i / N) * durationS));
    const max = Math.max(10, ...el), min = Math.min(0, ...el);
    const y = (e: number) => BASE - ((e - min) / (max - min)) * (BASE - TOP);
    return { y, d: el.map((e, i) => `${i ? 'L' : 'M'}${((i / N) * W).toFixed(1)} ${y(e).toFixed(1)}`).join(' '), horizon: y(0) };
  }, [sunAt, durationS]);

  const x = (tS: number) => (durationS > 0 ? Math.min(1, Math.max(0, tS / durationS)) * W : 0);
  const seekTo = useCallback((clientX: number) => {
    const r = track.current?.getBoundingClientRect(); if (!r || r.width === 0) return;
    usePlayback.getState().seek(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * usePlayback.getState().durationS);
  }, []);
  useEffect(() => () => { drag.current = false; }, []);

  const hx = x(t);
  const hy = curve && sunAt ? curve.y(sunAt(t)) : 14;
  const onKey = (e: React.KeyboardEvent) => {
    const p = usePlayback.getState();
    const step = Math.max(1, p.durationS / 100) * (e.shiftKey ? 5 : 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); p.seek(p.t + step); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); p.seek(p.t - step); }
    else if (e.key === 'Home') { e.preventDefault(); p.seek(0); }
    else if (e.key === 'End') { e.preventDefault(); p.seek(p.durationS); }
  };

  return (
    <footer className={s.time} role="group" aria-label="Timeline" data-avoid>
      <button type="button" className={s.play} onClick={() => usePlayback.getState().toggle()} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={14} strokeWidth={1.5} aria-hidden /> : <Play size={14} strokeWidth={1.5} aria-hidden />}
      </button>
      <div
        ref={track} className={s.track} tabIndex={0} role="slider" aria-label={landing ? 'Time since atmospheric entry' : 'EVA time, drag the sun'}
        aria-valuemin={0} aria-valuemax={Math.round(durationS)} aria-valuenow={Math.round(t)} aria-valuetext={formatMissionTime(t)} onKeyDown={onKey}
        onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); seekTo(e.clientX); }}
        onPointerMove={(e) => { if (drag.current) seekTo(e.clientX); }}
        onPointerUp={(e) => { drag.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          {curve ? (
            <>
              <line x1={0} x2={W} y1={curve.horizon} y2={curve.horizon} stroke="rgba(236,231,225,.18)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
              <path d={curve.d} fill="none" stroke="rgba(236,231,225,.3)" vectorEffect="non-scaling-stroke" />
            </>
          ) : <path d={`M0 ${BASE} Q ${W / 2} ${-6} ${W} ${BASE}`} fill="none" stroke="rgba(236,231,225,.22)" vectorEffect="non-scaling-stroke" />}
          <line x1={0} x2={W} y1={BASE + 2} y2={BASE + 2} stroke="rgba(236,231,225,.15)" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={hx} y1={BASE + 2} y2={BASE + 2} stroke="#ece7e1" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {markers.map((m, i) => <line key={i} x1={x(m.tS)} x2={x(m.tS)} y1={BASE - 2} y2={H} stroke={m.warn ? '#ee6a63' : '#ece7e1'} strokeOpacity={m.warn ? 1 : 0.7} strokeWidth={m.warn ? 1.5 : 1} vectorEffect="non-scaling-stroke" />)}
          <line x1={hx} x2={hx} y1={hy} y2={BASE + 4} stroke="#e0884a" vectorEffect="non-scaling-stroke" />
        </svg>
        {/* the handle (the sun) is a DOM dot so it stays round however wide the track is */}
        <span aria-hidden style={{ position: 'absolute', left: `calc(${(hx / W) * 100}% - 4.5px)`, top: `${(hy / H) * 100}%`, marginTop: -4.5, width: 9, height: 9, borderRadius: '50%', border: '1.5px solid #e0884a', background: '#0d0b0b' }} />
        {markers.map((m, i) => <span key={i} title={`${formatMissionTime(m.tS)}  ${m.label}`} aria-hidden style={{ position: 'absolute', left: `calc(${(x(m.tS) / W) * 100}% - 4px)`, bottom: 0, width: 8, height: 10 }} />)}
      </div>
      <span className={s.tclock}>{formatMissionTime(t)}</span>
      <span className={s.tlabel}>{landing ? 'since entry' : 'sun arc, local time'}</span>
      <div className={s.speed} role="group" aria-label="Playback speed">
        {SPEEDS.map((v) => <button key={v} type="button" aria-pressed={speed === v} aria-label={`${v} times speed`} onClick={() => usePlayback.getState().setSpeed(v)}>{v}×</button>)}
      </div>
    </footer>
  );
}

/** The slim line under the map when no simulation is loaded: one hint or message, and the data credit. */
export function StatusLine() {
  const mode = useGlobeStore((g) => g.mode);
  const rt = useRuntime((r) => r.rt);
  const toasts = useWorld((w) => w.toasts);
  const progress = useHud((h) => h.reachProgress);
  const gs = useGlobal((g) => g.gs);
  const gErr = useGlobal((g) => g.error);
  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => useWorld.getState().dismissToast(toasts[0].id), 6000);
    return () => clearTimeout(id);
  }, [toasts]);
  let kind = 'hint', text: string;
  if (toasts.length) { kind = 'toast'; text = toasts[toasts.length - 1].text; }
  else if (progress) { kind = 'progress'; text = `Base camp reach: ${progress}`; }
  else if (mode === 'jezero' && !rt) { kind = 'loading'; text = 'Loading the 20 m terrain'; }
  else if (mode === 'globe' && !gs && !gErr) { kind = 'loading'; text = 'Loading the global datasets'; }
  else text = mode === 'jezero' ? 'Drag from the base to plan. Shift-drag to lasso. Right-drag to orbit.' : 'Click the planet to ask about a place. Drag to turn it, scroll to zoom.';
  const short = kind === 'hint' ? (mode === 'jezero' ? 'Drag from the base to plan.' : 'Click the planet to ask.') : text;
  return (
    <footer className={s.status} data-avoid>
      <span className={`${s.hint} ${s.long}`} data-kind={kind} role={kind === 'hint' ? undefined : 'status'}>{text}</span>
      <span className={`${s.hint} ${s.short}`} data-kind={kind} aria-hidden>{short}</span>
      <span className={s.credit}>Data: NASA, USGS{mode === 'jezero' ? ', Perseverance' : ''}. Not affiliated with NASA.</span>
    </footer>
  );
}
