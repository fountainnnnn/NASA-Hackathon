'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { formatMissionTime, usePlayback } from '@/state/playback';
import { ROVER_SPEED_KMH, sampleAtTime } from './model';
import type { GroundApi, Timeline } from './model';
import { useWalkUi } from './walkStore';
import { angLerp, visibleScale } from './chase';
import { SHADOW_GEOMETRY, contactShadowTexture } from './astronaut';
import { SUN_AZIMUTH_DEG } from './sceneAdapter';
import css from './scenario.module.css';

/**
 * Original six-wheel crew rover, unpressurised. Metres, +z forward, +y up, no insignia. Matte. The rear deck (top at
 * 1.06 m, centred 0.7 m behind the middle axle) is where the crew stand while carried; Crew.tsx places them there.
 */
export function createRover(): THREE.Group {
  const g = new THREE.Group();
  const m = (color: string, roughness = 0.92, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const hull = m('#cfcbc2'), dark = m('#34332f'), trim = m('#8d8c88'), tyre = m('#2c2b28', 0.98), deck = m('#9c9a94');
  const add = (geo: THREE.BufferGeometry, mt: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(geo, mt); o.position.set(x, y, z); g.add(o); return o;
  };
  add(new THREE.BoxGeometry(1.8, 0.32, 3.4), hull, 0, 0.82, 0);              // chassis
  add(new THREE.BoxGeometry(1.5, 0.42, 1.0), hull, 0, 1.19, 1.05);           // forward instrument and battery module
  add(new THREE.BoxGeometry(1.1, 0.28, 0.08), dark, 0, 1.28, 1.56);          // front sensor bar
  add(new THREE.BoxGeometry(1.44, 0.06, 1.3), deck, 0, 1.03, -0.7);          // rear deck for the crew
  for (const sx of [-0.62, 0.62]) {                                           // hand rail
    add(new THREE.BoxGeometry(0.05, 0.85, 0.05), trim, sx, 1.48, -1.32);
    add(new THREE.BoxGeometry(0.05, 0.05, 1.25), trim, sx, 1.9, -0.72);
    add(new THREE.BoxGeometry(0.05, 0.85, 0.05), trim, sx, 1.48, -0.12);
  }
  add(new THREE.BoxGeometry(1.29, 0.05, 0.05), trim, 0, 1.9, -1.32);
  add(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), trim, 0.55, 2.0, 1.2); // comms mast
  const dish = add(new THREE.CylinderGeometry(0.28, 0.06, 0.08, 16), hull, 0.55, 2.7, 1.2);
  dish.rotation.x = -0.6;
  const wheel = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 20);
  const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.34, 10);
  const fender = new THREE.BoxGeometry(0.4, 0.04, 0.95);
  for (const side of [-1, 1]) for (const z of [-1.3, 0, 1.3]) {
    const w = add(wheel, tyre, side * 1.05, 0.42, z); w.rotation.z = Math.PI / 2;
    const h = add(hub, trim, side * 1.05, 0.42, z); h.rotation.z = Math.PI / 2;
    add(fender, hull, side * 1.05, 0.9, z);
    add(new THREE.BoxGeometry(0.22, 0.12, 0.12), dark, side * 0.86, 0.66, z); // suspension arm
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
  const shadow = useRef<THREE.Mesh>(null);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), []);
  useFrame((_, dt) => {
    const g = grp.current;
    if (!g || !start || timeline.roverEndS <= 0) { if (g) g.visible = false; return; }
    const t = Math.min(usePlayback.getState().t, timeline.roverEndS);
    const smp = sampleAtTime(timeline, t);
    if (!smp) return;
    const y = ground.y(smp.x, smp.z, smp.h);
    const dist = camera.position.distanceTo(new THREE.Vector3(smp.x, y, smp.z));
    const ui = useWalkUi.getState();
    const s = scale === 'auto' ? visibleScale(dist, ui.followCrew, ui.helmet) : scale;
    g.visible = true;
    g.position.set(smp.x, y, smp.z);
    heading.current = t <= 0 ? smp.headingRad : angLerp(heading.current, smp.headingRad, 1 - Math.exp(-10 * Math.min(0.1, dt)));
    g.rotation.y = Math.PI - heading.current;
    g.scale.setScalar(s);
    // soft contact shadow under the chassis, pushed a little away from the sun
    const sh = shadow.current;
    if (sh) {
      const az = (SUN_AZIMUTH_DEG * Math.PI) / 180, off = 1.0 * s;
      const sx = smp.x - Math.sin(az) * off, sz = smp.z + Math.cos(az) * off;
      sh.position.set(sx, ground.y(sx, sz) + 0.04 * s, sz);
      sh.rotation.set(-Math.PI / 2, 0, -heading.current); // plane length (local y) along the rover axis
      sh.scale.set(3.0 * s, 4.6 * s, 1);
    }
  });
  return (
    <>
      <group ref={grp} visible={false}>
        <primitive object={rover} />
        <ParkedTag timeline={timeline} />
      </group>
      {timeline.roverEndS > 0 && <mesh ref={shadow} geometry={SHADOW_GEOMETRY} material={shadowMat} renderOrder={4} raycast={() => null} />}
    </>
  );
}

/** "Rover parked" tag once the crew has stepped off at the hand-off point. Polled (Html has its own React root). */
function ParkedTag({ timeline }: { timeline: Timeline }) {
  const [parked, setParked] = useState(false);
  const helmet = useWalkUi((s) => s.helmet);
  useEffect(() => {
    const id = setInterval(() => setParked(timeline.roverEndS > 0 && usePlayback.getState().t > timeline.roverEndS + 1), 250);
    return () => clearInterval(id);
  }, [timeline]);
  if (!parked || helmet) return null;
  return (
    <Html position={[0, 3.1, 0]} center zIndexRange={[19, 0]} style={{ pointerEvents: 'none' }}>
      <div className={css.parked} style={{ transform: 'translateY(-8px)' }}>
        <span>Rover parked</span>
        <span className={css.sub}>crew stepped off at {formatMissionTime(timeline.roverEndS)}</span>
      </div>
    </Html>
  );
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
