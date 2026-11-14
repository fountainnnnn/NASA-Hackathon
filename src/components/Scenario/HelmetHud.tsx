'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Eye } from 'lucide-react';
import * as THREE from 'three';
import { formatMissionTime, usePlayback, useThrottledT } from '@/state/playback';
import { batteryLeftAt, nextStop, sampleAtOdometer, sampleAtTime, slopeAhead } from './model';
import type { GroundApi, Timeline } from './model';
import { useWalkUi } from './walkStore';
import css from './helmet.module.css';

const EYE_M = 1.7;       // eye height above the ground, metres (true scale)
const LOOK_AHEAD_M = 25; // the camera looks at the path this far ahead
const HELMET_FOV = 70;

/**
 * In-canvas camera takeover. Mount inside the Canvas next to the orbit controls (drei OrbitControls with makeDefault).
 * While the helmet view is on the orbit controls are disabled; leaving restores the exact orbit camera.
 */
export function HelmetCamera({ timeline, ground }: { timeline: Timeline; ground: GroundApi }) {
  const on = useWalkUi((s) => s.helmet);
  const { camera, controls } = useThree();
  const saved = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; target: THREE.Vector3; fov: number; near: number; far: number } | null>(null);
  const look = useRef(new THREE.Vector3());
  const fresh = useRef(true);
  const ctrl = controls as unknown as { enabled: boolean; target: THREE.Vector3; update(): void } | null;

  useEffect(() => {
    if (!on) return;
    const persp = camera as THREE.PerspectiveCamera;
    saved.current = {
      pos: camera.position.clone(), quat: camera.quaternion.clone(), target: ctrl?.target.clone() ?? new THREE.Vector3(),
      fov: persp.fov, near: persp.near, far: persp.far,
    };
    fresh.current = true;
    if (ctrl) ctrl.enabled = false;
    return () => {
      const s = saved.current;
      if (!s) return;
      camera.position.copy(s.pos); camera.quaternion.copy(s.quat);
      persp.fov = s.fov; persp.near = s.near; persp.far = s.far; persp.updateProjectionMatrix();
      if (ctrl) { ctrl.target.copy(s.target); ctrl.enabled = true; ctrl.update(); }
      saved.current = null;
    };
  }, [on, camera, ctrl]);

  useFrame((_, dtRaw) => {
    if (!on) return;
    const dt = Math.min(0.1, dtRaw);
    const t = usePlayback.getState().t;
    const lead = sampleAtTime(timeline, t);
    if (!lead) return;
    const eyeUp = EYE_M * ground.exag;
    const eye = new THREE.Vector3(lead.x, ground.y(lead.x, lead.z, lead.h) + eyeUp, lead.z);
    const ahead = sampleAtOdometer(timeline, lead.odometerM + LOOK_AHEAD_M);
    let tgt: THREE.Vector3;
    if (ahead && Math.hypot(ahead.x - lead.x, ahead.z - lead.z) > 1) {
      tgt = new THREE.Vector3(ahead.x, ground.y(ahead.x, ahead.z, ahead.h) + eyeUp, ahead.z);
    } else {
      const hx = Math.sin(lead.headingRad), hz = -Math.cos(lead.headingRad);
      tgt = new THREE.Vector3(eye.x + hx * LOOK_AHEAD_M, eye.y, eye.z + hz * LOOK_AHEAD_M);
    }
    if (fresh.current) { look.current.copy(tgt); fresh.current = false; } else look.current.lerp(tgt, 1 - Math.exp(-6 * dt));
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.fov !== HELMET_FOV || persp.near !== 0.3) { persp.fov = HELMET_FOV; persp.near = 0.3; persp.far = Math.max(persp.far, 400000); persp.updateProjectionMatrix(); }
    camera.position.copy(eye);
    camera.lookAt(look.current);
    if (ctrl) ctrl.target.copy(look.current);
  });
  return null;
}

/** Text button that toggles the helmet view. Place it anywhere in the DOM. */
export function HelmetToggle({ className }: { className?: string }) {
  const on = useWalkUi((s) => s.helmet);
  const set = useWalkUi((s) => s.setHelmet);
  return (
    <button type="button" className={className ?? css.toggle} aria-pressed={on} onClick={() => set(!on)}>
      <Eye size={14} strokeWidth={1.5} aria-hidden />
      Helmet view
    </button>
  );
}

/* ------------------------------------------------------------------ overlay */

const TAPE_W = 560, TAPE_H = 40, DEG_PX = 5; // 5 px per degree: 112 degrees visible
const CARD: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

function HeadingTape({ headingDeg }: { headingDeg: number }) {
  const ticks: React.ReactNode[] = [];
  const first = Math.floor(headingDeg - TAPE_W / 2 / DEG_PX), last = Math.ceil(headingDeg + TAPE_W / 2 / DEG_PX);
  for (let d = first; d <= last; d++) {
    if (d % 5) continue;
    const x = TAPE_W / 2 + (d - headingDeg) * DEG_PX;
    const norm = ((d % 360) + 360) % 360;
    const major = norm % 15 === 0;
    ticks.push(<line key={d} x1={x} x2={x} y1={major ? 16 : 22} y2={30} stroke="currentColor" strokeOpacity={major ? 0.7 : 0.35} strokeWidth={1} />);
    if (major) ticks.push(<text key={`t${d}`} x={x} y={12} textAnchor="middle" fontSize={norm % 45 === 0 ? 12 : 10} fill="currentColor" fillOpacity={norm % 45 === 0 ? 1 : 0.6}>{CARD[norm] ?? String(norm).padStart(3, '0')}</text>);
  }
  return (
    <svg className={css.tape} data-avoid viewBox={`0 0 ${TAPE_W} ${TAPE_H}`} role="img" aria-label={`Heading ${Math.round(headingDeg)} degrees`}>
      <line x1={0} x2={TAPE_W} y1={30} y2={30} stroke="currentColor" strokeOpacity={0.25} />
      {ticks}
      <path d={`M${TAPE_W / 2 - 5} 38 L${TAPE_W / 2} 31 L${TAPE_W / 2 + 5} 38`} fill="none" stroke="var(--accent, #e0884a)" strokeWidth={1.5} />
    </svg>
  );
}

function MiniMap({ timeline, t }: { timeline: Timeline; t: number }) {
  const geom = useMemo(() => {
    const fwd = timeline.segs.filter((s) => s.kind !== 'dwell' && !s.reversed);
    const xs = fwd.flatMap((s) => [s.a.x, s.b.x]), zs = fwd.flatMap((s) => [s.a.z, s.b.z]);
    if (!xs.length) return null;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const pad = 14, W = 150 - 2 * pad;
    const k = W / Math.max(1, maxX - minX, maxZ - minZ);
    const ox = pad + (W - (maxX - minX) * k) / 2, oz = pad + (W - (maxZ - minZ) * k) / 2;
    const P = (x: number, z: number): [number, number] => [ox + (x - minX) * k, oz + (z - minZ) * k];
    const pts = [P(fwd[0].a.x, fwd[0].a.z), ...fwd.map((s) => P(s.b.x, s.b.z))];
    return { P, d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') };
  }, [timeline]);
  const lead = sampleAtTime(timeline, t);
  if (!geom || !lead) return null;
  const me = geom.P(lead.x, lead.z);
  const tb = timeline.turnBack ? geom.P(timeline.turnBack.v.x, timeline.turnBack.v.z) : null;
  return (
    <svg className={css.map} viewBox="0 0 150 150" role="img" data-avoid aria-label="Route overview with current position">
      <path d={geom.d} fill="none" stroke="var(--accent, #e0884a)" strokeWidth={1.5} />
      {tb && <g stroke="var(--nogo, #d9423b)" strokeWidth={1.5}><line x1={tb[0] - 4} x2={tb[0] + 4} y1={tb[1] - 4} y2={tb[1] + 4} /><line x1={tb[0] - 4} x2={tb[0] + 4} y1={tb[1] + 4} y2={tb[1] - 4} /></g>}
      <circle cx={me[0]} cy={me[1]} r={3.5} fill="var(--text-1, #ece7e1)" />
      <line x1={me[0]} y1={me[1]} x2={me[0] + Math.sin(lead.headingRad) * 11} y2={me[1] - Math.cos(lead.headingRad) * 11} stroke="var(--text-1, #ece7e1)" strokeWidth={1.5} />
      <text x={8} y={142} fontSize={10} fill="var(--text-2, #a39c95)">north up</text>
    </svg>
  );
}

export interface HelmetHudProps {
  timeline: Timeline;
  /** Hook for the ops layer (Mars24): sun elevation above the horizon in degrees. Shown when provided. */
  sunElevationDeg?: number | ((tS: number) => number) | null;
  /** Hook for the ops layer: true when the crew has comms line of sight. Shown when provided. */
  commsVisible?: boolean | null;
  /** Render even when the helmet view is off (preview and tests). */
  forceVisible?: boolean;
}

/** Helmet overlay: heading tape on top, three numbers lower left, mini map lower right, empty centre. */
export function HelmetHud({ timeline, sunElevationDeg = null, commsVisible = null, forceVisible = false }: HelmetHudProps) {
  const on = useWalkUi((s) => s.helmet);
  const t = useThrottledT(15);
  if (!on && !forceVisible) return null;
  const lead = sampleAtTime(timeline, t);
  if (!lead) return null;
  const sunDeg = typeof sunElevationDeg === 'function' ? sunElevationDeg(t) : sunElevationDeg;
  const c = timeline.constraints;
  const left = batteryLeftAt(t, c);
  const low = left <= c.batteryReservePct;
  const headingDeg = (((lead.headingRad * 180) / Math.PI) % 360 + 360) % 360;
  const slope = slopeAhead(timeline, lead.odometerM, 100);
  const stop = nextStop(timeline, t);
  const remaining = Math.max(0, timeline.durationS - t);
  return (
    <div className={css.hud} aria-label="Helmet display">
      <HeadingTape headingDeg={headingDeg} />
      <div className={css.times} data-avoid>
        <div><span className={css.k}>Elapsed</span>{formatMissionTime(t)}</div>
        <div><span className={css.k}>Remaining</span>{formatMissionTime(remaining).replace('T+', '')}</div>
        {sunDeg != null && <div><span className={css.k}>Sun</span>{sunDeg.toFixed(0)}°</div>}
        {commsVisible != null && <div className={commsVisible ? undefined : css.low}><span className={css.k}>Comms</span>{commsVisible ? 'line of sight' : 'in shadow'}</div>}
      </div>
      <div className={css.numbers} data-avoid>
        <div className={css.n}>
          <span className={css.k}>{stop ? `To ${stop.marker.label.toLowerCase()}` : 'To next stop'}</span>
          <span className={css.v}>{stop ? Math.round(stop.distM) : 0}<span className={css.u}>m</span></span>
        </div>
        <div className={css.n}>
          <span className={css.k}>Slope, next 100 m</span>
          <span className={`${css.v} ${slope.meanDeg > c.maxSlopeDeg ? css.low : ''}`}>{slope.meanDeg.toFixed(1)}<span className={css.deg}>°</span></span>
        </div>
        <div className={css.n}>
          <span className={css.k}>{low ? 'Reserve, below limit' : 'Reserve'}</span>
          <span className={`${css.v} ${low ? css.low : ''}`}>{Math.round(left)}<span className={css.u}>%</span></span>
          <div className={css.bar}>
            <i style={{ width: `${Math.max(0, left)}%`, background: low ? 'var(--nogo, #d9423b)' : undefined }} />
            <b style={{ left: `${c.batteryReservePct}%` }} />
            <span style={{ left: `${c.batteryReservePct}%` }}>{c.batteryReservePct} % limit</span>
          </div>
        </div>
      </div>
      <MiniMap timeline={timeline} t={t} />
    </div>
  );
}
