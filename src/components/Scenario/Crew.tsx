'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { formatMissionTime, usePlayback } from '@/state/playback';
import { createAstronaut, poseAstronaut } from './astronaut';
import type { Astronaut } from './astronaut';
import { PAIR_SEPARATION_M, batteryLeftAt, sampleAtOdometer, sampleAtTime } from './model';
import type { GroundApi, Sample, Timeline } from './model';
import { useWalkUi } from './walkStore';
import css from './scenario.module.css';

const STRIDE_M = 1.5;          // visual stride length (one full gait cycle), cosmetic only
const MAX_CYCLES_PER_S = 1.7;  // cap the gait cadence in wall time so 60x / 600x playback does not strobe
const PUFFS = 48;
const WARN_RED = '#d9423b';

export interface CrewProps {
  timeline: Timeline;
  ground: GroundApi;
  /** 'auto' scales with camera distance so the crew stays visible; a number fixes it. Honest note shown in the tag tooltip. */
  scale?: 'auto' | number;
  tags?: boolean;
  /** Pair spacing along the path, metres (before the visibility widening). */
  separationM?: number;
}

function angLerp(a: number, b: number, k: number) {
  let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

/** Floating status tag, updated four times a second so React does not re-render per frame. */
function Tag({ timeline, name, scaleRef, reserveHint, side }: { timeline: Timeline; name: string; scaleRef: React.RefObject<number>; reserveHint: boolean; side: number }) {
  const [txt, setTxt] = useState({ t: 'T+00:00:00', bat: 100, s: 1, mode: 'walk' as string });
  // Html content lives in its own React root (no R3F context), so poll with a timer instead of useFrame
  useEffect(() => {
    const tick = () => {
      const t = usePlayback.getState().t;
      const smp = sampleAtTime(timeline, t);
      const bat = Math.round(batteryLeftAt(t, timeline.constraints));
      const s = Math.round(scaleRef.current ?? 1);
      const mt = formatMissionTime(t);
      const mode = smp?.mode ?? 'walk';
      setTxt((p) => (p.t === mt && p.bat === bat && p.s === s && p.mode === mode ? p : { t: mt, bat, s, mode }));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [timeline, scaleRef]);
  if (txt.s > 60 || (txt.s > 12 && !reserveHint)) return null; // far away: fewer, then no, tags so the view stays clean
  const low = txt.bat <= timeline.constraints.batteryReservePct;
  const note = txt.s > 1
    ? `Drawn at ${txt.s} times true size so the crew is visible from here. Positions, times and battery are not scaled.`
    : 'Drawn at true size.';
  return (
    <div className={css.tag} title={note} style={{ transform: `translate(${side * 56}px, -4px)` }}>
      <span className={css.name}>{name}{txt.mode === 'rover' ? ' on rover' : ''}</span>
      <span className={css.row}><span>{txt.t}</span></span>
      <span className={css.row}>
        <span className={low ? css.low : undefined}>{txt.bat}<span className={css.unit}> % suit</span></span>
        {low && reserveHint && <span className={css.low}>reserve</span>}
      </span>
    </div>
  );
}

export function TurnBackMarker({ timeline, ground }: { timeline: Timeline; ground: GroundApi }) {
  const tb = timeline.turnBack;
  const camDist = useRef(1000);
  const ringRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const pos = useMemo(() => (tb ? new THREE.Vector3(tb.v.x, ground.y(tb.v.x, tb.v.z, tb.v.h), tb.v.z) : null), [tb, ground]);
  useFrame(() => {
    if (!pos || !ringRef.current) return;
    camDist.current = camera.position.distanceTo(pos);
    const r = Math.max(6, camDist.current * 0.012);
    ringRef.current.scale.set(r, r, r);
  });
  if (!tb || !pos) return null;
  const tall = 60 * Math.max(1, ground.exag);
  const left = Math.max(0, Math.round(batteryLeftAt(tb.tS, timeline.constraints)));
  return (
    <group position={pos}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5 * ground.exag, 0]} renderOrder={30}>
        <ringGeometry args={[0.85, 1, 48]} />
        <meshBasicMaterial color={WARN_RED} transparent depthWrite={false} depthTest={false} />
      </mesh>
      <Line points={[[0, 0, 0], [0, tall, 0]]} color={WARN_RED} lineWidth={1.5} depthTest={false} renderOrder={30} />
      <Html position={[0, tall, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={css.mark} style={{ transform: 'translate(-58%, -22px)' }}>
          <span>Turn back here</span>
          <span className={css.sub}>{formatMissionTime(tb.tS)}, {left} % suit left, reserve limit {timeline.constraints.batteryReservePct} %</span>
        </div>
      </Html>
    </group>
  );
}

export function Crew({ timeline, ground, scale = 'auto', tags = true, separationM = PAIR_SEPARATION_M }: CrewProps) {
  const A = useMemo<[Astronaut, Astronaut]>(() => [createAstronaut(), createAstronaut()], []);
  const outer = useRef<[THREE.Group | null, THREE.Group | null]>([null, null]);
  const scaleRef = useRef(1);
  const heading = useRef<[number, number]>([0, 0]);
  const phase = useRef<[number, number]>([0, 0]);
  const prevOdo = useRef<[number, number]>([0, 0]);
  const initd = useRef(false);
  const { camera } = useThree();
  const puffs = useRef<THREE.InstancedMesh>(null);
  const puffState = useRef(Array.from({ length: PUFFS }, () => ({ age: 99, x: 0, y: 0, z: 0, size: 1 })));
  const puffHead = useRef(0);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const hidden = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);

  useEffect(() => { initd.current = false; }, [timeline]);

  const spawn = (x: number, y: number, z: number, size: number) => {
    const p = puffState.current[puffHead.current++ % PUFFS];
    p.age = 0; p.x = x; p.y = y; p.z = z; p.size = size;
  };

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.1, dtRaw);
    const t = usePlayback.getState().t;
    const helmet = useWalkUi.getState().helmet;
    const lead = sampleAtTime(timeline, t);
    if (!lead) return;

    // visible scale
    const leadY = ground.y(lead.x, lead.z, lead.h);
    const dist = camera.position.distanceTo(new THREE.Vector3(lead.x, leadY, lead.z));
    const targetS = helmet ? 1 : scale === 'auto' ? Math.min(160, Math.max(1, dist / 70)) : scale;
    scaleRef.current += (targetS - scaleRef.current) * (initd.current ? 1 - Math.exp(-8 * dt) : 1);
    const s = scaleRef.current;

    const riding = lead.mode === 'rover';
    const sepVis = Math.max(separationM, 1.6 * s);
    const buddy: Sample | null = riding ? lead : sampleAtOdometer(timeline, lead.odometerM - sepVis);
    const samples: [Sample, Sample | null] = [lead, buddy];
    const lateral = riding ? 0.55 : 0.7;

    for (let i = 0; i < 2; i++) {
      const smp = samples[i];
      const g = outer.current[i];
      if (!g || !smp) continue;
      const side = i === 0 ? 1 : -1;
      const px = Math.cos(smp.headingRad), pz = Math.sin(smp.headingRad); // perpendicular
      const off = lateral * s * side * (riding ? 1 : 1);
      const back = riding ? -0.7 * s : 0; // crew stand on the rover's rear platform
      const x = smp.x + px * off + Math.sin(smp.headingRad) * back, z = smp.z + pz * off - Math.cos(smp.headingRad) * back;
      const y = ground.y(x, z, smp.h) + (riding ? 1.03 * s : 0);
      g.position.set(x, y, z);
      heading.current[i] = initd.current ? angLerp(heading.current[i], smp.headingRad, 1 - Math.exp(-10 * dt)) : smp.headingRad;
      g.rotation.y = Math.PI - heading.current[i];
      g.scale.setScalar(s);
      g.visible = !(helmet && i === 0);

      // gait phase advances with distance walked, capped in wall time
      const dOdo = Math.abs(smp.odometerM - prevOdo.current[i]);
      prevOdo.current[i] = smp.odometerM;
      const before = phase.current[i];
      if (smp.mode === 'walk' && initd.current) {
        phase.current[i] += Math.min((dOdo / STRIDE_M) * 2 * Math.PI, MAX_CYCLES_PER_S * 2 * Math.PI * dt);
      }
      const moving = smp.mode === 'walk' && smp.speedMps > 0.01;
      const amp = moving ? Math.min(1, 0.45 + smp.speedMps / 1.2) : 0;
      poseAstronaut(A[i], phase.current[i], amp, riding);
      // footfall dust: one puff per half cycle, only at modest playback speeds so it stays subtle
      if (moving && initd.current && Math.floor(phase.current[i] / Math.PI) !== Math.floor(before / Math.PI) && usePlayback.getState().speed <= 60) {
        spawn(x - Math.sin(smp.headingRad) * 0.1 * s, y + 0.05 * s, z + Math.cos(smp.headingRad) * 0.1 * s, 0.22 * s);
      }
    }
    initd.current = true;

    // dust
    const im = puffs.current;
    if (im) {
      for (let k = 0; k < PUFFS; k++) {
        const p = puffState.current[k];
        p.age += dt;
        const life = 1.5;
        if (p.age >= life) { im.setMatrixAt(k, hidden); continue; }
        const u = p.age / life;
        const sc = p.size * (0.5 + 1.6 * u) * Math.sqrt(Math.sin(Math.PI * u));
        tmp.position.set(p.x, p.y + p.size * 1.2 * u, p.z);
        tmp.scale.setScalar(Math.max(1e-4, sc));
        tmp.updateMatrix();
        im.setMatrixAt(k, tmp.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }
  });

  useEffect(() => {
    const im = puffs.current;
    if (!im) return;
    for (let k = 0; k < PUFFS; k++) im.setMatrixAt(k, hidden);
    im.instanceMatrix.needsUpdate = true;
  }, [hidden]);

  return (
    <>
      {A.map((a, i) => (
        <group key={i} ref={(g) => { outer.current[i] = g; }}>
          <primitive object={a.root} />
          {tags && (
            <Html position={[0, a.height + 0.45, 0]} center zIndexRange={[20, 0]}>
              <Tag timeline={timeline} name={i === 0 ? 'Crew 1' : 'Crew 2'} scaleRef={scaleRef} reserveHint={i === 0} side={i === 0 ? 1 : -1} />
            </Html>
          )}
        </group>
      ))}
      <instancedMesh ref={puffs} args={[undefined, undefined, PUFFS]} frustumCulled={false} renderOrder={5}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color="#b49a84" transparent opacity={0.12} depthWrite={false} />
      </instancedMesh>
      <TurnBackMarker timeline={timeline} ground={ground} />
    </>
  );
}
