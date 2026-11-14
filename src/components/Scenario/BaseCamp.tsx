'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LonLat } from '../../lib/contracts';
import type { GroundApi } from './model';
import { computeReach, contourLevels, contourPolygon, reachAreaKm2 } from './reach';
import type { PlanRoundTrip, ReachResult } from './reach';
import { blockedByHud } from '@/components/HUD/blocks';
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

/**
 * Surface habitat: a horizontal pressurised module on two saddles, a side airlock with its hatch and step, and a comms mast
 * at the assumed height (DEFAULT_MAST_M, the same number the comms check uses). Original design, matte, no insignia.
 * Metres, +y up; the module's long axis is x, the airlock faces +z.
 */
export function createHabitat(mastM = 10): THREE.Group {
  const g = new THREE.Group();
  const m = (color: string, roughness = 0.93) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  const shell = m('#d7d3ca'), band = m('#aeaba4'), frame = m('#8e8c86'), hatch = m('#4a4844'), dark = m('#3b3a36');
  const R = 2.2, L = 8.4, cy = 0.7 + R;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 40, 1, true), shell);
  body.rotation.z = Math.PI / 2; body.position.y = cy; g.add(body);
  for (const sx of [-1, 1]) {                                     // shallow domed end caps
    const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), shell);
    cap.scale.set(1, 0.32, 1); cap.rotation.z = -sx * Math.PI / 2; cap.position.set(sx * L / 2, cy, 0); g.add(cap);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.22, 40, 1, true), band);
    ring.rotation.z = Math.PI / 2; ring.position.set(sx * (L / 2 - 0.4), cy, 0); g.add(ring);
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 3.2), frame);
    saddle.position.set(sx * 2.6, 0.6, 0); g.add(saddle);
  }
  // airlock: short cylinder on the +z side, hatch at its outer end, a step below
  const lockR = 1.15, lockL = 2.3;
  const lock = new THREE.Mesh(new THREE.CylinderGeometry(lockR, lockR, lockL, 32), shell);
  lock.rotation.x = Math.PI / 2; lock.position.set(0.8, cy - 0.5, R - 0.2 + lockL / 2); g.add(lock);
  const lockRing = new THREE.Mesh(new THREE.CylinderGeometry(lockR + 0.04, lockR + 0.04, 0.16, 32, 1, true), band);
  lockRing.rotation.x = Math.PI / 2; lockRing.position.set(0.8, cy - 0.5, R - 0.2 + lockL - 0.12); g.add(lockRing);
  const door = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 28), hatch);
  door.rotation.x = Math.PI / 2; door.scale.set(0.8, 1, 1.25); door.position.set(0.8, cy - 0.55, R - 0.2 + lockL + 0.03); g.add(door);
  const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.8), frame);
  step.position.set(0.8, 0.12, R - 0.2 + lockL + 0.35); g.add(step);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.9, cy - 0.5 - lockR, 0.25), frame);
  legs.position.set(0.8, (cy - 0.5 - lockR) / 2, R - 0.2 + lockL - 0.5); g.add(legs);
  // windows: two small dark ports on the +z side
  for (const wx of [-2.4, 2.6]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 20), dark);
    w.rotation.x = Math.PI / 2; w.position.set(wx, cy + 0.5, Math.sqrt(R * R - 0.25) + 0.01); g.add(w);
  }
  // comms mast beside the module, with a small dish
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, mastM, 10), frame);
  mast.position.set(-L / 2 - 2.5, mastM / 2, -1.5); g.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 8, 0, Math.PI * 2, 0, Math.PI / 4), shell);
  dish.rotation.x = -Math.PI / 2 + 0.5; dish.position.set(-L / 2 - 2.5, mastM - 0.2, -1.2); g.add(dish);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.2), frame);
  foot.position.set(-L / 2 - 2.5, 0.07, -1.5); g.add(foot);
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
  /** Comms mast height on the habitat, m (ASSUMPTION, the shell's mastHeightM). Default 10. */
  mastHeightM?: number;
}

/** Habitat, airlock, comms mast and the parked rover at the base, plus EVA reach as a filled frontier and reserve contours. */
export function BaseCamp({ centre, ground, reach = null, contourMinutes, scale = 'auto', models = true, mastHeightM = 10 }: BaseCampProps) {
  const local = useMemo(() => ground.toLocal(centre.lon, centre.lat), [ground, centre]);
  const { camera } = useThree();
  const root = useRef<THREE.Group>(null);
  const hab = useMemo(() => createHabitat(mastHeightM), [mastHeightM]);
  const rover = useMemo(createRover, []);
  const s0 = useRef(1);
  const lift = 1.2 * ground.exag;

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    const y = ground.y(local.x, local.z, null);
    const d = camera.position.distanceTo(new THREE.Vector3(local.x, y, local.z));
    // from the default reach camera (10 to 20 km out) the base is enlarged so it reads as a habitat (about 20 px across);
    // true size from close range. Positions and contours are never scaled.
    const target = scale === 'auto' ? Math.min(60, Math.max(1, d / 180)) : scale;
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
    place(rover, 2, 9.5, 1.2);
    place(hab, 0, 0, 0.35);
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

  // contour labels share the screen: the frontier first, then the others, at most one per 90 px, never off screen
  const labelEls = useRef<(HTMLSpanElement | null)[]>([]);
  // every contour is labelled; labels are spread round the ring (east, then a little further round per level) so they do not stack
  const labelAt = (c: { poly: { x: number; z: number }[] }, i: number) => c.poly[Math.floor(c.poly.length * ((0.25 + 0.06 * i) % 1))];
  const labelPos = useMemo(() => contours.map((c, i) => {
    const lab = labelAt(c, i);
    const x = local.x + lab.x, z = local.z + lab.z;
    return new THREE.Vector3(x, ground.y(x, z, null) + lift * 3, z);
  }), [contours, local, ground, lift]);
  const projV = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ size }) => {
    const order = contours.map((c, i) => ({ i, m: c.minutes })).sort((a, b) => (a.m === 0 ? -1 : b.m === 0 ? 1 : b.m - a.m));
    const kept: { x: number; y: number }[] = [];
    for (const { i } of order) {
      const el = labelEls.current[i]; if (!el) continue;
      projV.copy(labelPos[i]).project(camera);
      const sx = (projV.x * 0.5 + 0.5) * size.width, sy = (-projV.y * 0.5 + 0.5) * size.height;
      const ok = projV.z > -1 && projV.z < 1 && sx > 60 && sx < size.width - 60 - (parseFloat(getComputedStyle(document.querySelector('main') ?? document.body).getPropertyValue('--log-w')) || 0) && sy > 60 && sy < size.height - 40 && kept.every((q) => Math.hypot(q.x - sx, q.y - sy) >= 70) && !blockedByHud(el.getBoundingClientRect(), el);
      if (ok) kept.push({ x: sx, y: sy });
      el.style.visibility = ok ? 'visible' : 'hidden';
    }
  });

  const BONE = '#ece7e1', DATA = '#5cc8ff';
  return (
    <>
      <group ref={root}>
        {models && (<>
          <primitive object={hab} /><primitive object={rover} />
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
        const ci = contours.indexOf(c);
        const lab = labelAt(c, ci);
        return (
          <group key={c.minutes}>
            <Line points={pts} color={BONE} lineWidth={frontier ? 1.5 : 1} transparent opacity={frontier ? 0.95 : 0.5} depthWrite={false} renderOrder={13} raycast={() => null} dashed={!frontier} dashSize={30} gapSize={20} />
            <Html position={[local.x + lab.x, ground.y(local.x + lab.x, local.z + lab.z, null) + lift * 3, local.z + lab.z]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
              <span ref={(el) => { labelEls.current[ci] = el; }} className={css.contour} data-avoid style={{ visibility: 'hidden' }}>{frontier ? 'turn back, 0 min reserve' : `${c.minutes} min reserve`}</span>
            </Html>
          </group>
        );
      })}
    </>
  );
}
