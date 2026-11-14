'use client';
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePlayback } from '@/state/playback';
import { ROVER_SPEED_KMH, sampleAtTime } from './model';
import type { GroundApi, Timeline } from './model';
import { useWalkUi } from './walkStore';

/** Original low-poly six-wheel rover. Metres, +z forward, +y up, no insignia. */
export function createRover(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: '#b9b3a8', roughness: 0.8, metalness: 0.15, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2827', roughness: 0.9, metalness: 0.1, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: '#8c6a4c', roughness: 0.8, metalness: 0.05, flatShading: true });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o;
  };
  add(new THREE.BoxGeometry(1.7, 0.45, 3.2), hull, 0, 0.78, 0);              // chassis deck
  add(new THREE.BoxGeometry(1.3, 0.5, 1.0), hull, 0, 1.2, 0.95);             // forward module
  add(new THREE.BoxGeometry(1.4, 0.06, 1.3), trim, 0, 1.03, -0.7);           // rear platform for the crew
  add(new THREE.BoxGeometry(0.06, 0.55, 0.06), dark, 0.55, 1.1, -1.3);       // rail posts
  add(new THREE.BoxGeometry(0.06, 0.55, 0.06), dark, -0.55, 1.1, -1.3);
  const mast = add(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), dark, 0.5, 1.9, 1.1);
  mast.rotation.z = 0;
  const wheel = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12);
  for (const side of [-1, 1]) for (const z of [-1.3, 0, 1.3]) {
    const w = add(wheel, dark, side * 1.0, 0.4, z);
    w.rotation.z = Math.PI / 2;
    const hub = add(new THREE.CylinderGeometry(0.16, 0.16, 0.32, 8), trim, side * 1.0, 0.4, z);
    hub.rotation.z = Math.PI / 2;
  }
  return g;
}

export interface RoverAssistProps {
  timeline: Timeline;
  ground: GroundApi;
  scale?: 'auto' | number;
}

/**
 * Rover that carries the crew over the first part of the outbound leg (timeline.roverEndS), then waits at the drop off.
 * Mount with the same timeline the Crew uses; build that timeline with roverFraction > 0.
 */
export function RoverAssist({ timeline, ground, scale = 'auto' }: RoverAssistProps) {
  const rover = useMemo(createRover, []);
  const grp = useRef<THREE.Group>(null);
  const heading = useRef(0);
  const { camera } = useThree();
  const start = timeline.segs[0];
  useFrame((_, dt) => {
    const g = grp.current;
    if (!g || !start || timeline.roverEndS <= 0) { if (g) g.visible = false; return; }
    const t = Math.min(usePlayback.getState().t, timeline.roverEndS);
    const smp = sampleAtTime(timeline, t);
    if (!smp) return;
    const y = ground.y(smp.x, smp.z, smp.h);
    const dist = camera.position.distanceTo(new THREE.Vector3(smp.x, y, smp.z));
    const s = useWalkUi.getState().helmet ? 1 : scale === 'auto' ? Math.min(160, Math.max(1, dist / 70)) : scale;
    g.visible = true;
    g.position.set(smp.x, y, smp.z);
    heading.current += (smp.headingRad - heading.current) * Math.min(1, dt * 10);
    if (t <= 0) heading.current = smp.headingRad;
    g.rotation.y = Math.PI - heading.current;
    g.scale.setScalar(s);
  });
  return <group ref={grp} visible={false}><primitive object={rover} /></group>;
}

/** DOM control: how much of the outbound leg the rover carries. Label states the speed is an assumption. */
export function RoverAssistControl({ className }: { className?: string }) {
  const f = useWalkUi((s) => s.roverFraction);
  const set = useWalkUi((s) => s.setRoverFraction);
  return (
    <label className={className} style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text-2, #a39c95)' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span>Rover carries the first part of the way out</span>
        <span title={`Assumption: the rover drives at ${ROVER_SPEED_KMH} km/h. Not a measured vehicle figure.`} style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-1, #ece7e1)' }}>
          {Math.round(f * 100)} %, assumed {ROVER_SPEED_KMH} km/h
        </span>
      </span>
      <input type="range" min={0} max={100} step={5} value={Math.round(f * 100)} onChange={(e) => set(Number(e.target.value) / 100)} aria-label="Share of the outbound leg on the rover" style={{ accentColor: '#e0884a' }} />
    </label>
  );
}
