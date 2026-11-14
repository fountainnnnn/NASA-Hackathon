'use client';
import { useMemo, useRef } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { rulerTicks } from './ruler';
import type { RulerTick } from './ruler';
import type { GroundApi, Timeline } from './model';
import css from './scenario.module.css';

export interface RulerLineProps {
  timeline: Timeline;
  ground: GroundApi;
  color?: string;
  /** Also draw the 1.5 px route line itself (the Jezero Scene already draws its own, so default false). */
  showLine?: boolean;
  /** Time tick labels such as "10 min". */
  labels?: boolean;
  everyM?: number;
  everyMin?: number;
}

/** Route ruler: short tick every 100 m, long tick every 10 min of moving time. Tick length follows camera distance. */
export function RulerLine({ timeline, ground, color = '#e0884a', showLine = false, labels = true, everyM = 100, everyMin = 10 }: RulerLineProps) {
  const ticks = useMemo(() => rulerTicks(timeline, { everyM, everyMin }), [timeline, everyM, everyMin]);
  const lift = 1.2 * ground.exag;
  const lineGeo = useRef<THREE.BufferGeometry>(null);
  const { camera } = useThree();
  const lastDist = useRef(0);
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
  const fill = (dist: number) => {
    const g = lineGeo.current;
    if (!g) return;
    const base = Math.max(3, dist * 0.004);
    ticks.forEach((k: RulerTick, i) => {
      const half = (k.kind === 'time' ? 2.4 : 1) * base;
      buf[i * 6] = k.x - k.nx * half; buf[i * 6 + 1] = ys[i]; buf[i * 6 + 2] = k.z - k.nz * half;
      buf[i * 6 + 3] = k.x + k.nx * half; buf[i * 6 + 4] = ys[i]; buf[i * 6 + 5] = k.z + k.nz * half;
    });
    g.setAttribute('position', new THREE.BufferAttribute(buf, 3));
    g.computeBoundingSphere();
  };
  useFrame(() => {
    const first = ticks[0];
    if (!first) return;
    const d = camera.position.distanceTo(new THREE.Vector3(first.x, ys[0], first.z));
    if (Math.abs(d - lastDist.current) / Math.max(1, d) > 0.1 || lastDist.current === 0) { lastDist.current = d; fill(d); }
  });

  return (
    <>
      {pathPts && pathPts.length > 1 && <Line points={pathPts} color={color} lineWidth={1.5} transparent depthWrite={false} renderOrder={11} raycast={() => null} />}
      <lineSegments frustumCulled={false} renderOrder={12} raycast={() => null}>
        <bufferGeometry ref={lineGeo} />
        <lineBasicMaterial color={color} transparent depthWrite={false} />
      </lineSegments>
      {labels && ticks.map((k, i) => k.label && (
        <Html key={i} position={[k.x + k.nx * 1, ys[i], k.z + k.nz * 1]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <span className={css.tick} style={{ display: 'inline-block', transform: 'translate(18px, -8px)' }}>{k.label}</span>
        </Html>
      ))}
    </>
  );
}
