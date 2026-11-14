'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LonLat } from '../../lib/contracts';
import type { GroundApi } from './model';
import { computeReach, contourLevels, contourPolygon, reachAreaKm2 } from './reach';
import type { PlanRoundTrip, ReachResult } from './reach';
import { createRover } from './RoverAssist';
import css from './scenario.module.css';

/* ------------------------------------------------------------------ async reach hook (DOM or canvas side) */

export type ReachStatus = 'idle' | 'running' | 'done' | 'cancelled';
export interface ReachState {
  status: ReachStatus;
  done: number; total: number;
  result: ReachResult | null;
  run(): void;
  cancel(): void;
}

/**
 * Runs the reach computation with progress and cancel. The planner is passed in (the app's terrain client).
 * At most `bearings` (default 24) plans are issued, one per bearing, using whatever objective the planner applies;
 * wrap planRoundTrip to force the shortest objective if you want the fastest answer.
 */
export function useReach(opts: { centre: LonLat; planRoundTrip: PlanRoundTrip; maxRadiusM: number; bearings?: number }): ReachState {
  const { centre, planRoundTrip, maxRadiusM, bearings = 24 } = opts;
  const [state, setState] = useState<Omit<ReachState, 'run' | 'cancel'>>({ status: 'idle', done: 0, total: bearings, result: null });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ status: 'running', done: 0, total: bearings, result: null });
    computeReach({
      center: centre, planRoundTrip, maxRadiusM, bearings, signal: c.signal,
      onProgress: (done, total, partial) => {
        if (c.signal.aborted) return;
        setState({ status: 'running', done, total, result: { center: centre, maxRadiusM, samples: partial, plans: done, cancelled: false, ms: 0 } });
      },
    }).then((r) => {
      if (ctrl.current !== c) return;
      setState({ status: r.cancelled ? 'cancelled' : 'done', done: r.samples.length, total: bearings, result: r });
    }).catch(() => { if (ctrl.current === c) setState((s) => ({ ...s, status: 'cancelled' })); });
  }, [centre, planRoundTrip, maxRadiusM, bearings]);
  const cancel = useCallback(() => { ctrl.current?.abort(); setState((s) => (s.status === 'running' ? { ...s, status: 'cancelled' } : s)); }, []);
  return { ...state, run, cancel };
}

/** DOM control: run, progress, cancel, and a one line finding. Text only. */
export function ReachControl({ reach, className }: { reach: ReachState; className?: string }) {
  const r = reach.result;
  const area = r && reach.status !== 'idle' ? reachAreaKm2(r.samples) : null;
  const far = r && r.samples.length ? Math.max(...r.samples.map((s) => s.radiusM)) : 0;
  const btn: React.CSSProperties = { height: 28, padding: '0 10px', cursor: 'pointer', color: 'var(--text-1, #ece7e1)', background: 'rgba(13,11,11,0.92)', border: '1px solid var(--line-strong, rgba(236,231,225,0.22))', borderRadius: 2, font: '400 12px var(--font-sans, system-ui)' };
  return (
    <div className={className} style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--text-2, #a39c95)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {reach.status === 'running'
          ? <button type="button" style={btn} onClick={reach.cancel}>Cancel</button>
          : <button type="button" style={btn} onClick={reach.run}>{r ? 'Recompute EVA reach' : 'Show EVA reach'}</button>}
        {reach.status === 'running' && <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-1, #ece7e1)' }}>{reach.done} of {reach.total} plans</span>}
        {reach.status === 'cancelled' && <span>Cancelled after {reach.done} of {reach.total} plans</span>}
      </div>
      {area != null && reach.status === 'done' && (
        <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-1, #ece7e1)' }}>
          {area.toFixed(1)} km2 reachable, up to {(far / 1000).toFixed(1)} km out
        </span>
      )}
      <span>Contours show the minutes of reserve left if the crew turns back at that line.</span>
    </div>
  );
}

/* ------------------------------------------------------------------ models */

function createDome(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: '#c9c4bb', roughness: 0.75, metalness: 0.1, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2827', roughness: 0.9, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: '#8c6a4c', roughness: 0.8, flatShading: true });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), shell);
  g.add(dome);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.5, 0.7, 14), trim);
  ring.position.y = 0.35; g.add(ring);
  const lock = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 10), shell);
  lock.rotation.x = Math.PI / 2; lock.position.set(0, 1.4, 5.6); g.add(lock);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.7, 0.1), dark);
  door.position.set(0, 1.0, 6.9); g.add(door);
  return g;
}

function createSolarArray(): THREE.Group {
  const g = new THREE.Group();
  const panel = new THREE.MeshStandardMaterial({ color: '#1c2430', roughness: 0.35, metalness: 0.6, flatShading: true });
  const frame = new THREE.MeshStandardMaterial({ color: '#8b8780', roughness: 0.7, metalness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 2.6), panel);
    p.position.set(i * 4.6 - 6.9, 1.3, 0); p.rotation.x = -0.55; g.add(p);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), frame);
    leg.position.set(i * 4.6 - 6.9, 0.65, 1.0); g.add(leg);
  }
  return g;
}

export interface BaseCampProps {
  centre: LonLat;
  ground: GroundApi;
  reach?: ReachResult | null;
  /** Reserve contours in minutes left at turn-back. Default: 0 (the frontier) plus round steps chosen from the data. */
  contourMinutes?: number[];
  scale?: 'auto' | number;
  models?: boolean;
}

/** Habitat dome, rover and solar array at the base, plus EVA reach as a filled frontier and reserve contours. */
export function BaseCamp({ centre, ground, reach = null, contourMinutes, scale = 'auto', models = true }: BaseCampProps) {
  const local = useMemo(() => ground.toLocal(centre.lon, centre.lat), [ground, centre]);
  const { camera } = useThree();
  const root = useRef<THREE.Group>(null);
  const dome = useMemo(createDome, []);
  const rover = useMemo(createRover, []);
  const solar = useMemo(createSolarArray, []);
  const s0 = useRef(1);
  const lift = 1.2 * ground.exag;

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const y = ground.y(local.x, local.z, null);
    const d = camera.position.distanceTo(new THREE.Vector3(local.x, y, local.z));
    const target = scale === 'auto' ? Math.min(60, Math.max(1, d / 220)) : scale;
    s0.current += (target - s0.current) * (1 - Math.exp(-8 * Math.min(0.1, dt)));
    const s = s0.current;
    g.position.set(local.x, y, local.z);
    g.scale.setScalar(s);
    // each model stands on the real ground at its own offset
    const place = (o: THREE.Object3D, ox: number, oz: number, ry = 0) => {
      const wx = local.x + ox * s, wz = local.z + oz * s;
      o.position.set(ox, (ground.y(wx, wz, null) - y) / s, oz);
      o.rotation.y = ry;
    };
    place(rover, 13, 3, 0.5);
    place(solar, -4, -17, 0.15);
    place(dome, 0, 0);
  });

  const contours = useMemo(() => {
    if (!reach || !reach.samples.length) return [];
    return (contourMinutes ?? contourLevels(reach.samples)).map((m) => ({ minutes: m, poly: contourPolygon(reach.samples, m, reach.maxRadiusM, 120) }))
      .filter((c) => c.poly.length && c.poly.some((p) => p.radiusM > 1));
  }, [reach, contourMinutes]);

  const fill = useMemo(() => {
    if (!reach || !reach.samples.length) return null;
    const poly = contourPolygon(reach.samples, 0, reach.maxRadiusM, 96);
    if (!poly.length) return null;
    const R = 12, A = poly.length;
    const pos = new Float32Array((R + 1) * A * 3);
    for (let r = 0; r <= R; r++) for (let a = 0; a < A; a++) {
      const k = r / R, p = poly[a];
      const x = local.x + p.x * k, z = local.z + p.z * k;
      const i = (r * A + a) * 3;
      pos[i] = x; pos[i + 1] = ground.y(x, z, null) + lift * 0.6; pos[i + 2] = z;
    }
    const idx: number[] = [];
    for (let r = 0; r < R; r++) for (let a = 0; a < A; a++) {
      const a1 = (a + 1) % A, i0 = r * A + a, i1 = r * A + a1, i2 = (r + 1) * A + a, i3 = (r + 1) * A + a1;
      idx.push(i0, i2, i1, i1, i2, i3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }, [reach, ground, local, lift]);

  useEffect(() => () => fill?.dispose(), [fill]);

  const BONE = '#ece7e1', DATA = '#5cc8ff';
  return (
    <>
      <group ref={root}>
        {models && (<>
          <primitive object={dome} /><primitive object={rover} /><primitive object={solar} />
        </>)}
      </group>
      {fill && (
        <mesh geometry={fill} renderOrder={3} raycast={() => null}>
          <meshBasicMaterial color={DATA} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      )}
      {contours.map((c) => {
        const pts = [...c.poly, c.poly[0]].map((p) => {
          const x = local.x + p.x, z = local.z + p.z;
          return [x, ground.y(x, z, null) + lift, z] as [number, number, number];
        });
        const frontier = c.minutes === 0;
        const lab = c.poly[Math.floor(c.poly.length * 0.25)]; // bearing 90 degrees, east
        return (
          <group key={c.minutes}>
            <Line points={pts} color={BONE} lineWidth={frontier ? 1.5 : 1} transparent opacity={frontier ? 0.95 : 0.5} depthWrite={false} renderOrder={13} raycast={() => null} dashed={!frontier} dashSize={30} gapSize={20} />
            <Html position={[local.x + lab.x, ground.y(local.x + lab.x, local.z + lab.z, null) + lift * 3, local.z + lab.z]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <span className={css.contour}>{frontier ? 'turn back, 0 min' : `${c.minutes} min`}</span>
            </Html>
          </group>
        );
      })}
    </>
  );
}
