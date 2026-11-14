'use client';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import { SPEEDS, formatMissionTime, usePlayback, useThrottledT } from '@/state/playback';
import css from './playbackBar.module.css';

export interface PlaybackMarker { tS: number; label: string; kind?: 'normal' | 'warn' }

export interface PlaybackBarProps {
  /** Phase markers on the arc: stops, rover drop off, turn back, EDL phase starts. */
  markers?: PlaybackMarker[];
  /**
   * Sun elevation above the horizon in degrees at scenario time tS (from the ops layer, Mars24). When given, the arc
   * is the sun's elevation curve over the scenario and the handle is the sun. Without it the arc is a plain timeline.
   */
  sunElevationDeg?: (tS: number) => number;
  /** Suffix after the clock. Default "mission time". */
  clockLabel?: string;
}

const W = 640, H = 66, BASE = 52, TOP = 8, PAD = 2;

function isTypingTarget(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  const tag = n.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || n.isContentEditable;
}

export function PlaybackBar({ markers = [], sunElevationDeg, clockLabel = 'mission time' }: PlaybackBarProps) {
  const durationS = usePlayback((s) => s.durationS);
  const playing = usePlayback((s) => s.playing);
  const speed = usePlayback((s) => s.speed);
  const t = useThrottledT(30);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const xOf = useCallback((tS: number) => PAD + (durationS > 0 ? Math.min(1, tS / durationS) : 0) * (W - 2 * PAD), [durationS]);

  const curve = useMemo(() => {
    if (!sunElevationDeg || durationS <= 0) return null;
    const N = 96;
    const el: number[] = [];
    for (let i = 0; i <= N; i++) el.push(sunElevationDeg((i / N) * durationS));
    const max = Math.max(10, ...el), min = Math.min(0, ...el);
    const y = (e: number) => BASE - ((e - min) / (max - min)) * (BASE - TOP);
    return { y, d: el.map((e, i) => `${i ? 'L' : 'M'}${(PAD + (i / N) * (W - 2 * PAD)).toFixed(1)} ${y(e).toFixed(1)}`).join(' '), horizonY: y(0) };
  }, [sunElevationDeg, durationS]);

  const seekFromEvent = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const f = Math.min(1, Math.max(0, (((clientX - r.left) / r.width) * W - PAD) / (W - 2 * PAD)));
    usePlayback.getState().seek(f * usePlayback.getState().durationS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = usePlayback.getState();
      if (e.code === 'Space') { e.preventDefault(); s.toggle(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = Math.max(1, s.durationS / 200) * (e.shiftKey ? 5 : 1);
        s.seek(s.t + (e.key === 'ArrowRight' ? step : -step));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hx = xOf(t);
  const sunY = curve && durationS > 0 ? curve.y(sunElevationDeg!(t)) : BASE;
  const hy = curve ? sunY : BASE;

  return (
    <div className={css.bar} role="group" aria-label="Playback" data-avoid>
      <svg
        ref={svg} className={css.arc} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" tabIndex={0} role="slider"
        aria-label="Scenario time" aria-valuemin={0} aria-valuemax={Math.round(durationS)} aria-valuenow={Math.round(t)} aria-valuetext={formatMissionTime(t)}
        onPointerDown={(e) => { dragging.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); seekFromEvent(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) seekFromEvent(e.clientX); }}
        onPointerUp={(e) => { dragging.current = false; (e.currentTarget as Element).releasePointerCapture(e.pointerId); }}
      >
        {curve ? (
          <>
            <line x1={PAD} x2={W - PAD} y1={curve.horizonY} y2={curve.horizonY} stroke="currentColor" strokeOpacity={0.22} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
            <path d={curve.d} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <line x1={PAD} x2={W - PAD} y1={BASE} y2={BASE} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {/* elapsed portion on the baseline */}
        <line x1={PAD} x2={hx} y1={BASE + 6} y2={BASE + 6} stroke="var(--text-1, #ece7e1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={PAD} x2={W - PAD} y1={BASE + 6} y2={BASE + 6} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {markers.map((m, i) => {
          const x = xOf(m.tS);
          const warn = m.kind === 'warn';
          return (
            <g key={i}>
              <title>{`${formatMissionTime(m.tS)}  ${m.label}`}</title>
              <line x1={x} x2={x} y1={BASE + 1} y2={BASE + (warn ? 14 : 11)} stroke={warn ? 'var(--nogo, #d9423b)' : 'currentColor'} strokeOpacity={warn ? 1 : 0.7} strokeWidth={warn ? 1.5 : 1} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        <line x1={hx} x2={hx} y1={hy} y2={BASE + 6} stroke="var(--accent, #e0884a)" strokeWidth={1} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
        <ellipse cx={hx} cy={hy} rx={curve ? 4.2 : 3} ry={curve ? 4.2 : 3} fill="var(--bg-0, #060505)" stroke="var(--accent, #e0884a)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={css.row}>
        <div className={css.left}>
          <button type="button" className={css.play} onClick={() => usePlayback.getState().toggle()} aria-label={playing ? 'Pause' : 'Play'} disabled={durationS <= 0}>
            {playing ? <Pause size={14} strokeWidth={1.5} /> : <Play size={14} strokeWidth={1.5} />}
          </button>
          <span className={css.clock} aria-live="off">{formatMissionTime(t)}</span>
          <span className={css.sub}>{clockLabel}</span>
        </div>
        <div className={css.speeds} role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={css.speed} aria-pressed={speed === s} onClick={() => usePlayback.getState().setSpeed(s)} aria-label={`${s} times speed`}>
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
