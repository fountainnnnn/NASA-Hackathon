'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { rulerTicks } from './ruler';
import type { RulerTick } from './ruler';
import type { GroundApi, Timeline } from './model';
import css from './scenario.module.css';
import { useWalkUi } from './walkStore';
import { useHud } from '@/state/hud';
import { fadeBasicMaterial } from './sceneAdapter';

const LABEL_GAP_PX = 80;
/** Clearance (px) between a route time label and a crew or rover tag. */
const CREW_TAG_GAP_PX = 40;
/** Ticks closer than this to the camera are not drawn (walk chase view: no bar across the crew's feet, QA round 3, P1-6). */
const TICK_HIDE_NEAR_M = 30;
/** Smallest tick half-length in metres (0.6 m across): a near tick never grows into a bar. */
const TICK_MIN_HALF_M = 0.3;

export interface RulerLineProps {
  timeline: Timeline;
  ground: GroundApi;
  color?: string;
  /** Also draw the 1.5 px route line itself (the Jezero Scene already draws its own, so default false). */
  showLine?: boolean;
  /** Time tick labels such as "T+01:00" (mission elapsed). */
  labels?: boolean;
  everyM?: number;
  everyMin?: number;
}

/** Route ruler: short tick every 100 m, long tick every 10 min of moving time. Ticks keep a constant screen length. */
export function RulerLine({ timeline, ground, color = '#e0884a', showLine = false, labels = true, everyM = 100, everyMin = 10 }: RulerLineProps) {
  const ticks = useMemo(() => rulerTicks(timeline, { everyM, everyMin }), [timeline, everyM, everyMin]);
  // helmet view: ticks lie on the ground under the boots (and fade near the eye), never at eye height
  const helmet = useWalkUi((w) => w.helmet);
  const walkOn = useHud((h) => h.walkOn);
  const lift = (helmet || walkOn ? 0.3 : 1.2) * ground.exag;
  const lineGeo = useRef<THREE.BufferGeometry>(null);
  const tickMat = useMemo(() => { const m = new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false }); fadeBasicMaterial(m); return m; }, [color]);
  useEffect(() => () => tickMat.dispose(), [tickMat]);
  const { camera } = useThree();
  const lastCam = useRef(new THREE.Vector3(Infinity, 0, 0));
  const filledHelmet = useRef(helmet);
  const ys = useMemo(() => ticks.map((k) => ground.y(k.x, k.z, k.h) + lift), [ticks, ground, lift]);
  const pathPts = useMemo(() => {
    if (!showLine) return null;
    const pts: [number, number, number][] = [];
    for (const s of timeline.segs) {
      if (s.reversed || s.kind === 'dwell') continue;
      if (!pts.length) pts.push([s.a.x, ground.y(s.a.x, s.a.z, s.a.h) + lift, s.a.z]);
      pts.push([s.b.x, ground.y(s.b.x, s.b.z, s.b.h) + lift, s.b.z]);
    }
    return pts;
  }, [timeline, ground, lift, showLine]);

  const buf = useMemo(() => new Float32Array(ticks.length * 6), [ticks.length]);
  const attr = useMemo(() => new THREE.BufferAttribute(buf, 3), [buf]);
  const tv = useMemo(() => new THREE.Vector3(), []);
  /** Tick half-lengths are screen-constant (about 4 px, 9 px for the 10 min ticks) from each tick's own distance; none within 30 m. */
  const fill = (heightPx: number) => {
    const g = lineGeo.current;
    if (!g) return;
    if (g.getAttribute('position') !== attr) g.setAttribute('position', attr);
    const cam = camera as THREE.PerspectiveCamera;
    const k2 = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, heightPx);
    ticks.forEach((k: RulerTick, i) => {
      const d = camera.position.distanceTo(tv.set(k.x, ys[i], k.z));
      const half = d < TICK_HIDE_NEAR_M ? 0 : Math.max(TICK_MIN_HALF_M, (k.kind === 'time' ? 9 : 4) * k2 * d);
      buf[i * 6] = k.x - k.nx * half; buf[i * 6 + 1] = ys[i]; buf[i * 6 + 2] = k.z - k.nz * half;
      buf[i * 6 + 3] = k.x + k.nx * half; buf[i * 6 + 4] = ys[i]; buf[i * 6 + 5] = k.z + k.nz * half;
    });
    attr.needsUpdate = true;
    g.computeBoundingSphere();
  };
  const labelEls = useRef<(HTMLSpanElement | null)[]>([]);
  const proj = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ size }) => {
    // screen-space declutter: at most one minute label per LABEL_GAP_PX on screen, nearest the start wins
    let kept: { x: number; y: number }[] = [];
    const blocks = Array.from(document.querySelectorAll('[data-avoid], [data-companion]')).filter((n) => !(n as HTMLElement).className.toString().includes('tick') && getComputedStyle(n).visibility !== 'hidden').map((n) => n.getBoundingClientRect());
    // crew and rover tags (drei Html, no data-avoid): a time label never sits within 40 px of one
    const crewTags = Array.from(document.querySelectorAll('[data-stage] [class*="_tag__"], [data-stage] [class*="__tag"]')).filter((n) => !(n as HTMLElement).className.toString().includes('tick')).map((n) => n.getBoundingClientRect());
    ticks.forEach((k, i) => {
      const el = labelEls.current[i];
      if (!el) return;
      proj.set(k.x + k.nx, ys[i], k.z + k.nz).project(camera);
      const sx = (proj.x * 0.5 + 0.5) * size.width, sy = (-proj.y * 0.5 + 0.5) * size.height;
      const inside = proj.z < 1 && proj.z > -1 && sx > 24 && sx < size.width - 90 && sy > 56 && sy < size.height - 24;
      // where the label really sits on the page (laid out even while hidden), measured rather than predicted: a prediction
      // from the canvas size drifts from the Base tag and the other labels while the canvas is being resized
      const r = el.getBoundingClientRect();
      const box = { l: r.left, r: r.right, t: r.top, b: r.bottom };
      const free = !blocks.some((b) => box.l < b.right + 3 && box.r > b.left - 3 && box.t < b.bottom + 3 && box.b > b.top - 3)
        && !crewTags.some((b) => box.l < b.right + CREW_TAG_GAP_PX && box.r > b.left - CREW_TAG_GAP_PX && box.t < b.bottom + CREW_TAG_GAP_PX && box.b > b.top - CREW_TAG_GAP_PX);
      const clear = inside && free && kept.every((q) => Math.hypot(q.x - sx, q.y - sy) >= LABEL_GAP_PX);
      if (clear) kept = [...kept, { x: sx, y: sy }];
      el.style.visibility = clear ? 'visible' : 'hidden';
    });
    // refill when the camera has moved a little (cheap: one pass over the ticks, buffer updated in place)
    if (camera.position.distanceToSquared(lastCam.current) > 0.25 || filledHelmet.current !== helmet) { lastCam.current.copy(camera.position); filledHelmet.current = helmet; fill(size.height); }
  });

  // helmet view: the ground ribbon carries the path (chevrons every 10 m); screen-space ticks would read as a glitch at eye height
  if (helmet) return null;
  return (
    <>
      {pathPts && pathPts.length > 1 && <Line points={pathPts} color={color} lineWidth={1.5} transparent depthWrite={false} renderOrder={11} raycast={() => null} />}
      <lineSegments frustumCulled={false} renderOrder={12} raycast={() => null}>
        <bufferGeometry ref={lineGeo} />
        <primitive object={tickMat} attach="material" />
      </lineSegments>
      {labels && !helmet && ticks.map((k, i) => k.label && (
        <Html key={i} position={[k.x + k.nx * 1, ys[i], k.z + k.nz * 1]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <span ref={(el) => { labelEls.current[i] = el; }} className={css.tick} data-avoid style={{ display: 'inline-block', transform: 'translate(18px, -8px)', visibility: 'hidden' }}>{k.label}</span>
        </Html>
      ))}
    </>
  );
}
