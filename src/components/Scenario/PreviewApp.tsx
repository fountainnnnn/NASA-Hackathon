'use client';
/**
 * Standalone preview of the scenario components on SYNTHETIC data (generated terrain, hand drawn route, fake planner).
 * Nothing on this page is NASA data. Query: ?shot=crew|helmet|base|wide  &tight=1  &rover=0.4
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { usePlayback, usePlaybackClock } from '@/state/playback';
import { BaseCamp, ReachControl, useReach } from './BaseCamp';
import { Crew } from './Crew';
import { HelmetCamera, HelmetHud, HelmetToggle } from './HelmetHud';
import { PlaybackBar } from './PlaybackBar';
import type { PlaybackMarker } from './PlaybackBar';
import { RoverAssist, RoverAssistControl } from './RoverAssist';
import { RulerLine } from './RulerLine';
import { buildTimeline, sampleAtTime } from './model';
import type { GroundApi, Timeline } from './model';
import { SYN_BASE, SYN_CONSTRAINTS, SYN_HALF_M, buildSyntheticRoute, makeSyntheticPlanner, synGround, synHeight, synLonLat } from './synthetic';
import { useWalkUi } from './walkStore';

const BG = '#0b0808';
const TIGHT_WH = 250;
const sunDeg = (dur: number) => (t: number) => 4 + 34 * Math.sin((Math.PI * Math.min(1, Math.max(0, t / dur))) * 0.9 + 0.15);

/* ------------------------------------------------------------------ synthetic terrain */

function SyntheticTerrain({ ground }: { ground: GroundApi }) {
  const N = 481;
  const geo = useMemo(() => {
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), idx: number[] = [];
    const dark = new THREE.Color('#3a2620'), mid = new THREE.Color('#7a4c34'), light = new THREE.Color('#b0794f'), tmp = new THREE.Color();
    const step = (SYN_HALF_M * 2) / (N - 1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -SYN_HALF_M + i * step, z = -SYN_HALF_M + j * step, h = synHeight(x, z);
      const k = (j * N + i) * 3;
      pos[k] = x; pos[k + 1] = h * ground.exag + 0.12 * Math.sin(x * 0.61 + z * 0.23) * Math.sin(z * 0.53 - x * 0.31); pos[k + 2] = z;
      const gx = synHeight(x + 6, z) - synHeight(x - 6, z), gz = synHeight(x, z + 6) - synHeight(x, z - 6);
      const slope = Math.min(1, Math.hypot(gx, gz) / 12 / 0.6);
      const n = 0.5 + 0.5 * Math.sin(x * 0.13 + Math.sin(z * 0.07) * 3) * Math.cos(z * 0.11 + x * 0.02);
      const u = Math.min(1, Math.max(0, (h + 30) / 130));
      const fine = Math.sin(x * 0.61 + z * 0.23) * Math.sin(z * 0.53 - x * 0.31) * 0.5 + Math.sin(x * 1.7) * Math.sin(z * 1.3) * 0.25;
      tmp.copy(mid).lerp(light, u * 0.6 + n * 0.25 + fine * 0.18).lerp(dark, slope * 0.55 + Math.max(0, -fine) * 0.12);
      col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
    }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [ground.exag]);

  const rocks = useRef<THREE.InstancedMesh>(null);
  const COUNT = 900;
  useEffect(() => {
    const im = rocks.current;
    if (!im) return;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const o = new THREE.Object3D();
    for (let i = 0; i < COUNT; i++) {
      const x = (rnd() * 2 - 1) * SYN_HALF_M * 0.97, z = (rnd() * 2 - 1) * SYN_HALF_M * 0.97;
      const s = 0.25 + Math.pow(rnd(), 3) * 2.2;
      o.position.set(x, ground.y(x, z, null) + s * 0.2, z);
      o.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      o.scale.set(s * (0.8 + rnd() * 0.6), s * 0.6, s);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  }, [ground]);

  return (
    <>
      <mesh geometry={geo}>
        <meshStandardMaterial vertexColors roughness={1} metalness={0} />
      </mesh>
      <instancedMesh ref={rocks} args={[undefined, undefined, COUNT]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#4a3228" roughness={1} flatShading />
      </instancedMesh>
    </>
  );
}

/* ------------------------------------------------------------------ camera shots */

function ShotRig({ shot, timeline, ground }: { shot: string; timeline: Timeline; ground: GroundApi }) {
  const { camera, controls } = useThree();
  const done = useRef(false);
  useFrame(() => {
    if (done.current || !controls) return;
    const c = controls as unknown as { target: THREE.Vector3; update(): void };
    const dur = timeline.durationS;
    const at = (f: number) => sampleAtTime(timeline, f * dur)!;
    const P = (x: number, z: number, up = 0) => new THREE.Vector3(x, ground.y(x, z, null) + up, z);
    if (shot === 'crew' || shot === 'helmet') {
      const f = Number(new URLSearchParams(window.location.search).get('t')) || (shot === 'crew' ? 0.2 : 0.14);
      const s = at(f);
      usePlayback.getState().seek(f * dur);
      if (shot === 'crew') {
        const fx = Math.sin(s.headingRad), fz = -Math.cos(s.headingRad), rx = Math.cos(s.headingRad), rz = Math.sin(s.headingRad);
        camera.position.copy(P(s.x + fx * 9 + rx * 8, s.z + fz * 9 + rz * 8, 1.7));
        c.target.copy(P(s.x - fx * 1.5 + rx * 0.5, s.z - fz * 1.5 + rz * 0.5, 1.3));
      } else useWalkUi.getState().setHelmet(true);
    } else if (shot === 'base') {
      const b = ground.toLocal(synLonLat(SYN_BASE.x, SYN_BASE.z).lon, synLonLat(SYN_BASE.x, SYN_BASE.z).lat);
      camera.position.copy(P(b.x + 2300, b.z + 3900, 3000));
      c.target.copy(P(b.x + 200, b.z - 250));
    } else {
      camera.position.copy(P(900, 1700, 650));
      c.target.copy(P(-480, 120));
    }
    c.update();
    done.current = true;
    document.body.dataset.shotReady = '1';
  });
  return null;
}

function Lights() {
  // low sun from the west south west, same idea as the Jezero scene
  return (
    <>
      <directionalLight position={[-3000, 1500, 1200]} intensity={2.6} color="#ffe2c6" />
      <hemisphereLight args={['#b8a79f', '#2a1c17', 1.1]} />
    </>
  );
}

function FogRig() {
  const { camera, scene, controls } = useThree();
  useFrame(() => {
    if (scene.fog instanceof THREE.Fog) {
      const t = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
      const d = t ? camera.position.distanceTo(t) : 500;
      scene.fog.near = d + 250;
      scene.fog.far = d + 3400;
    }
  });
  return null;
}

/* ------------------------------------------------------------------ page */

export default function PreviewApp() {
  const [params] = useState(() => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)));
  const shot = params.get('shot') ?? 'wide';
  const [tight, setTight] = useState(params.get('tight') === '1');
  const roverFraction = useWalkUi((s) => s.roverFraction);
  const helmetOn = useWalkUi((s) => s.helmet);
  usePlaybackClock();

  const ground = useMemo(() => synGround(), []);
  const constraints = useMemo(() => ({ ...SYN_CONSTRAINTS, batteryWh: tight ? TIGHT_WH : SYN_CONSTRAINTS.batteryWh }), [tight]);
  const route = useMemo(() => buildSyntheticRoute(constraints), [constraints]);
  const timeline = useMemo(() => buildTimeline(route, ground, { roverFraction }), [route, ground, roverFraction]);

  useEffect(() => {
    const r = Number(params.get('rover'));
    if (r > 0) useWalkUi.getState().setRoverFraction(r);
    if (shot === 'helmet') useWalkUi.getState().setHelmet(true);
  }, [params, shot]);

  useEffect(() => {
    const autoplay = !params.get('shot');
    usePlayback.getState().load({ scenarioId: 'synthetic-preview', kind: roverFraction > 0 ? 'rover-walk' : 'walk', durationS: timeline.durationS, autoplay, speed: 60 });
    if (params.get('shot')) usePlayback.getState().seek((Number(params.get('t')) || (shot === 'crew' ? 0.2 : shot === 'helmet' ? 0.14 : 0.3)) * timeline.durationS);
  }, [timeline, roverFraction, params, shot]);

  const markers = useMemo<PlaybackMarker[]>(() => timeline.markers.filter((m) => m.kind !== 'start' && m.kind !== 'end').map((m) => ({ tS: m.tS, label: m.label, kind: m.kind === 'turn-back' ? 'warn' : 'normal' })), [timeline]);
  const sun = useMemo(() => sunDeg(timeline.durationS), [timeline.durationS]);

  const planner = useMemo(() => makeSyntheticPlanner(SYN_CONSTRAINTS, 60), []);
  const centre = useMemo(() => synLonLat(SYN_BASE.x, SYN_BASE.z), []);
  const reach = useReach({ centre, planRoundTrip: planner, maxRadiusM: 2600 });
  useEffect(() => { if (shot === 'base') reach.run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reach.status === 'done') document.body.dataset.reachDone = '1'; }, [reach.status]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: BG, color: 'var(--text-1, #ece7e1)', fontFamily: 'var(--font-sans, system-ui)' }}>
      <Canvas
        flat dpr={[1, 2]} camera={{ fov: 45, near: 0.5, far: 40000, position: [900, 700, 1700] }}
        gl={{ antialias: true, preserveDrawingBuffer: true }} style={{ position: 'absolute', inset: 0 }} aria-label="Synthetic terrain with two astronauts walking a route"
      >
        <color attach="background" args={[BG]} />
        <fog attach="fog" args={[BG, 1500, 9000]} />
        <Lights />
        <FogRig />
        <SyntheticTerrain ground={ground} />
        <RulerLine timeline={timeline} ground={ground} showLine />
        <BaseCamp centre={centre} ground={ground} reach={reach.result} />
        <RoverAssist timeline={timeline} ground={ground} />
        <Crew timeline={timeline} ground={ground} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.09} minDistance={8} maxDistance={9000} maxPolarAngle={(86 * Math.PI) / 180} target={[-400, 20, 100]} />
        <HelmetCamera timeline={timeline} ground={ground} />
        <ShotRig shot={shot} timeline={timeline} ground={ground} />
      </Canvas>

      <HelmetHud timeline={timeline} sunElevationDeg={sun} />

      <div style={{ position: 'absolute', top: 16, left: 16, width: 300, display: 'grid', gap: 14, justifyItems: 'start', pointerEvents: 'none' }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Preview with synthetic data</span>
          <span style={{ fontSize: 12, color: 'var(--text-2, #a39c95)' }}>
            The terrain, route, planner and sun curve on this page are generated for testing. Nothing here is NASA data.
          </span>
        </div>
        <div style={{ display: 'grid', gap: 12, justifyItems: 'start', width: '100%', pointerEvents: 'auto', visibility: helmetOn ? 'hidden' : 'visible' }}>
          <RoverAssistControl />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-2, #a39c95)', cursor: 'pointer' }}>
            <input type="checkbox" checked={tight} onChange={(e) => setTight(e.target.checked)} style={{ accentColor: '#e0884a' }} />
            Battery {TIGHT_WH} Wh instead of {SYN_CONSTRAINTS.batteryWh} Wh, to see the turn back
          </label>
          <ReachControl reach={reach} />
          <Summary timeline={timeline} />
        </div>
      </div>
      <div style={{ position: 'absolute', top: helmetOn ? 'auto' : 16, bottom: helmetOn ? 200 : 'auto', right: 16 }}><HelmetToggle /></div>

      <PlaybackBar markers={markers} sunElevationDeg={sun} />
    </div>
  );
}

function Summary({ timeline }: { timeline: Timeline }) {
  const s = timeline.summary;
  const row = (k: string, v: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: 'var(--text-2, #a39c95)' }}>{k}</span>
      <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{v}</span>
    </div>
  );
  const hm = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;
  return (
    <div style={{ display: 'grid', gap: 3, fontSize: 12, width: '100%' }}>
      {timeline.turnBack ? row('Result', 'Reserve reached') : row('Result', 'Feasible')}
      {row('Walk and ride', hm(s.walkMin + s.roverMin))}
      {row('EVA total', hm(s.evaMin))}
      {row('Battery used', `${s.batteryUsedPct.toFixed(0)} %`)}
      {s.roverMin > 0 && row('Without the rover', `${hm(s.walkOnlyEvaMin)}, ${s.walkOnlyBatteryPct.toFixed(0)} %`)}
    </div>
  );
}
