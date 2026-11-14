'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { formatMissionTime, usePlayback } from '@/state/playback';
import { SHADOW_GEOMETRY, contactShadowTexture, createAstronaut, poseAstronaut } from './astronaut';
import type { Astronaut } from './astronaut';
import { CHASE_FOV_DEG, angLerp, chasePose, visibleScale } from './chase';
import { PAIR_SEPARATION_M, batteryLeftAt, sampleAtOdometer, sampleAtTime } from './model';
import type { GroundApi, Sample, Timeline } from './model';
import { SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG } from './sceneAdapter';
import { useWalkUi } from './walkStore';
import css from './scenario.module.css';

const STRIDE_M = 1.6;          // one full gait cycle (two steps), cosmetic only
const MAX_CYCLES_PER_S = 1.1;  // cap the gait cadence in wall time so 60x / 600x playback does not strobe
const PUFFS = 48;
const WARN_RED = '#d9423b';

export { visibleScale };

export interface CrewProps {
  timeline: Timeline;
  ground: GroundApi;
  /** 'auto': true size while the chase camera follows, enlarged with distance otherwise. A number fixes it. */
  scale?: 'auto' | number;
  tags?: boolean;
  /** Pair spacing along the path, metres (before the visibility widening). */
  separationM?: number;
  /** Mount the chase camera (default true). It follows while useWalkUi.followCrew is true. */
  chase?: boolean;
}

/** Floating status tag, updated four times a second so React does not re-render per frame. Flips side near the stage edge. */
function Tag({ timeline, name, scaleRef, reserveHint, side }: { timeline: Timeline; name: string; scaleRef: React.RefObject<number>; reserveHint: boolean; side: number }) {
  const [txt, setTxt] = useState({ bat: 100, s: 1, mode: 'walk' as string });
  const el = useRef<HTMLDivElement>(null);
  const flip = useRef(side);
  // Html content lives in its own React root (no R3F context), so poll with a timer instead of useFrame
  useEffect(() => {
    const tick = () => {
      const t = usePlayback.getState().t;
      const smp = sampleAtTime(timeline, t);
      const bat = Math.round(batteryLeftAt(t, timeline.constraints));
      const s = Math.round(scaleRef.current ?? 1);
      const mode = smp?.mode ?? 'walk';
      setTxt((p) => (p.bat === bat && p.s === s && p.mode === mode ? p : { bat, s, mode }));
      // keep the tag inside the stage: put it on the other side of the figure when it would cross an edge
      const n = el.current; const st = document.querySelector('[data-stage]')?.getBoundingClientRect();
      if (n && st) {
        const r = n.getBoundingClientRect(), w = r.width;
        const anchor = r.left + w / 2 - flip.current * 56; // figure x
        const want = anchor + side * 56 + w / 2 > st.right - 6 ? -1 : anchor + side * 56 - w / 2 < st.left + 6 ? 1 : side;
        if (want !== flip.current) { flip.current = want; n.style.transform = `translate(${want * 56}px, -4px)`; }
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [timeline, scaleRef, side]);
  if (txt.s > 60 || (txt.s > 12 && !reserveHint)) return null; // far away: fewer, then no, tags so the view stays clean
  const low = txt.bat <= timeline.constraints.batteryReservePct;
  const note = txt.s > 1
    ? `Drawn at ${txt.s} times true size so the crew is visible from here. Positions, times and battery are not scaled.`
    : 'Drawn at true size.';
  return (
    <div ref={el} className={css.tag} title={note} style={{ transform: `translate(${flip.current * 56}px, -4px)` }}>
      {/* name and suit charge only: mission time is the same for both and lives on the top bar and the timeline */}
      <span className={css.name}>{name}{txt.mode === 'rover' ? ' on rover' : ''}</span>
      <span className={css.row}>
        <span className={low ? css.low : undefined}>{txt.bat}<span className={css.unit}> % suit</span></span>
        {low && reserveHint && <span className={css.low}>reserve</span>}
      </span>
    </div>
  );
}

export function TurnBackMarker({ timeline, ground }: { timeline: Timeline; ground: GroundApi }) {
  const helmetOn = useWalkUi((w) => w.helmet);
  const tb = timeline.turnBack;
  const camDist = useRef(1000);
  const ringRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const pos = useMemo(() => (tb ? new THREE.Vector3(tb.v.x, ground.y(tb.v.x, tb.v.z, tb.v.h), tb.v.z) : null), [tb, ground]);
  useFrame(() => {
    if (!pos || !ringRef.current) return;
    camDist.current = camera.position.distanceTo(pos);
    const r = Math.max(2, camDist.current * 0.012);
    ringRef.current.scale.set(r, r, r);
  });
  if (!tb || !pos || helmetOn) return null; // the helmet HUD carries the turn-back point; nothing stands in the field of view
  const tall = Math.min(60, Math.max(6, camDist.current * 0.04)) * Math.max(1, ground.exag);
  const left = Math.max(0, Math.round(batteryLeftAt(tb.tS, timeline.constraints)));
  return (
    <group position={pos}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5 * ground.exag, 0]} renderOrder={30}>
        <ringGeometry args={[0.9, 1, 48]} />
        <meshBasicMaterial color={WARN_RED} transparent depthWrite={false} depthTest={false} />
      </mesh>
      <Line points={[[0, 0, 0], [0, tall, 0]]} color={WARN_RED} lineWidth={1} depthTest={false} renderOrder={30} />
      <Html position={[0, tall, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className={css.mark} style={{ transform: 'translate(-58%, -22px)' }}>
          <span>Turn back here</span>
          <span className={css.sub}>{formatMissionTime(tb.tS)}, {left} % suit left, reserve limit {timeline.constraints.batteryReservePct} %</span>
        </div>
      </Html>
    </group>
  );
}

/* ------------------------------------------------------------------ chase camera */

interface Ctl { enabled: boolean; target: THREE.Vector3; update(): void }

/** Pair centre on the ground and the walking heading at mission time t. */
function pairCentre(tl: Timeline, t: number, ground: GroundApi): { x: number; y: number; z: number; heading: number } | null {
  const lead = sampleAtTime(tl, t);
  if (!lead) return null;
  const buddy = lead.mode === 'rover' ? lead : sampleAtOdometer(tl, lead.odometerM - PAIR_SEPARATION_M) ?? lead;
  const x = (lead.x + buddy.x) / 2, z = (lead.z + buddy.z) / 2;
  return { x, z, y: ground.y(x, z, (lead.h + buddy.h) / 2), heading: lead.headingRad };
}

/** Wide view of the whole route: from the south-east, 35 degrees down, far enough to take in every vertex. */
export function wideRoutePose(tl: Timeline, ground: GroundApi): { cam: THREE.Vector3; look: THREE.Vector3 } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of tl.segs) for (const v of [s.a, s.b]) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const span = Math.max(300, maxX - minX, maxZ - minZ);
  const dist = span * 1.25 + 300, tilt = (35 * Math.PI) / 180;
  const look = new THREE.Vector3(cx, ground.y(cx, cz, null), cz);
  const h = Math.cos(tilt) * dist;
  return { look, cam: new THREE.Vector3(cx + h * Math.SQRT1_2, look.y + Math.sin(tilt) * dist, cz + h * Math.SQRT1_2) };
}

/**
 * Chase camera: about 27 m behind and 6 m above the pair, 16 degrees off the walking axis, 28 degree lens, so each
 * astronaut is about 100 px tall at true scale. Follows smoothly (only the heading is low-passed, so the distance holds
 * at 600x). A right or middle drag, a two-finger touch or the wheel breaks out into orbit around the crew; the
 * "Follow crew" toggle re-engages; turning follow off with the toggle shows the wide view of the whole route.
 */
export function ChaseCamera({ timeline, ground }: { timeline: Timeline; ground: GroundApi }) {
  const follow = useWalkUi((s) => s.followCrew);
  const { camera, controls, gl } = useThree();
  const ctrl = controls as unknown as Ctl | null;
  const heading = useRef<number | null>(null);
  const centreY = useRef<number | null>(null);
  const blend = useRef(0);
  const from = useRef<{ pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null>(null);
  const brokeOut = useRef(false);
  const last = useRef(new THREE.Vector3());
  const look = useMemo(() => new THREE.Vector3(), []);
  const baseFov = useRef((camera as THREE.PerspectiveCamera).fov);
  const tlRef = useRef(timeline); tlRef.current = timeline;
  const groundRef = useRef(ground); groundRef.current = ground;

  // a new walk always starts on the chase camera
  useEffect(() => { useWalkUi.getState().setFollowCrew(true); }, [timeline]);

  // engage / disengage
  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    if (!follow) return;
    brokeOut.current = false;
    blend.current = 0;
    heading.current = null; centreY.current = null;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    from.current = { pos: camera.position.clone(), look: ctrl?.target.clone() ?? camera.position.clone().add(fwd.multiplyScalar(100)), fov: persp.fov };
    if (persp.fov !== CHASE_FOV_DEG) baseFov.current = persp.fov;
    return () => {
      persp.fov = baseFov.current; persp.updateProjectionMatrix();
      if (!ctrl) return;
      if (brokeOut.current) { ctrl.enabled = true; return; } // orbit from where the user took it
      // toggled off, or the walk ended: the wide view of the whole route
      const w = wideRoutePose(tlRef.current, groundRef.current);
      camera.position.copy(w.cam); camera.lookAt(w.look);
      ctrl.target.copy(w.look); ctrl.enabled = true; ctrl.update();
    };
  }, [follow, camera, ctrl]);

  // break out on the user's own camera input; capture phase so the orbit controls see the same event already enabled
  useEffect(() => {
    const el = gl.domElement;
    const touches = new Set<number>();
    const take = () => {
      const s = useWalkUi.getState();
      if (!s.followCrew || s.helmet) return;
      brokeOut.current = true;
      if (ctrl) { ctrl.target.copy(last.current); ctrl.enabled = true; }
      s.setFollowCrew(false);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') { touches.add(e.pointerId); if (touches.size >= 2) take(); return; }
      if (e.button === 1 || e.button === 2) take();
    };
    const up = (e: PointerEvent) => { touches.delete(e.pointerId); };
    const wheel = () => take();
    el.addEventListener('pointerdown', down, { capture: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => {
      el.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel, { capture: true });
    };
  }, [gl, ctrl]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.1, dtRaw);
    const c = pairCentre(timeline, usePlayback.getState().t, ground);
    if (!c) return;
    // smoothed centre height and heading (the path is a 20 m polyline: raw headings jump at every vertex)
    centreY.current = centreY.current == null ? c.y : centreY.current + (c.y - centreY.current) * (1 - Math.exp(-4 * dt));
    heading.current = heading.current == null ? c.heading : angLerp(heading.current, c.heading, 1 - Math.exp(-1.6 * dt));
    last.current.set(c.x, centreY.current + ground.exag, c.z);
    const s = useWalkUi.getState();
    if (!s.followCrew || s.helmet) return;
    const p = chasePose({ x: c.x, y: centreY.current, z: c.z }, heading.current, (x, z) => ground.y(x, z, null), ground.exag);
    const persp = camera as THREE.PerspectiveCamera;
    blend.current = Math.min(1, blend.current + dt / 1.2);
    const k = blend.current * blend.current * (3 - 2 * blend.current);
    const f = from.current;
    look.set(p.look.x, p.look.y, p.look.z);
    if (f && k < 1) {
      camera.position.set(p.cam.x, p.cam.y, p.cam.z).lerp(f.pos, 1 - k);
      look.lerp(f.look, 1 - k);
      persp.fov = f.fov + (CHASE_FOV_DEG - f.fov) * k;
    } else {
      camera.position.set(p.cam.x, p.cam.y, p.cam.z);
      persp.fov = CHASE_FOV_DEG;
    }
    persp.updateProjectionMatrix();
    camera.lookAt(look);
    if (ctrl) { ctrl.enabled = false; ctrl.target.copy(look); }
  });
  return null;
}

/** DOM button for the shell: re-engages the chase camera, or shows the wide route view. */
export function FollowCrewToggle({ className }: { className?: string }) {
  const on = useWalkUi((s) => s.followCrew);
  return (
    <button type="button" className={className ?? css.toggle} aria-pressed={on} onClick={() => useWalkUi.getState().setFollowCrew(!on)}>
      {on ? 'Wide view' : 'Follow crew'}
    </button>
  );
}

/* ------------------------------------------------------------------ crew */

export function Crew({ timeline, ground, scale = 'auto', tags = true, separationM = PAIR_SEPARATION_M, chase = true }: CrewProps) {
  const A = useMemo<[Astronaut, Astronaut]>(() => [createAstronaut(true), createAstronaut(false)], []);
  const outer = useRef<[THREE.Group | null, THREE.Group | null]>([null, null]);
  const shadows = useRef<[THREE.Mesh | null, THREE.Mesh | null]>([null, null]);
  const scaleRef = useRef(1);
  const heading = useRef<[number, number]>([0, 0]);
  const phase = useRef<[number, number]>([0, 0]);
  const prevOdo = useRef<[number, number]>([0, 0]);
  const initd = useRef(false);
  const { camera } = useThree();
  const helmetOn = useWalkUi((w) => w.helmet);
  const puffs = useRef<THREE.InstancedMesh>(null);
  const puffState = useRef(Array.from({ length: PUFFS }, () => ({ age: 99, x: 0, y: 0, z: 0, size: 1 })));
  const puffHead = useRef(0);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const hidden = useMemo(() => new THREE.Matrix4().makeScale(0, 0, 0), []);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: contactShadowTexture(), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }), []);
  // shadow direction on the ground: away from the sun (scene x east, z south)
  const sun = useMemo(() => {
    const az = (SUN_AZIMUTH_DEG * Math.PI) / 180, el = (SUN_ELEVATION_DEG * Math.PI) / 180;
    return { dx: -Math.sin(az), dz: Math.cos(az), len: 1 / Math.tan(el) };
  }, []);
  const nrm = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => { initd.current = false; }, [timeline]);

  const spawn = (x: number, y: number, z: number, size: number) => {
    const p = puffState.current[puffHead.current++ % PUFFS];
    p.age = 0; p.x = x; p.y = y; p.z = z; p.size = size;
  };

  useFrame((_, dtRaw) => {
    const dt = Math.min(0.1, dtRaw);
    const t = usePlayback.getState().t;
    const ui = useWalkUi.getState();
    const helmet = ui.helmet;
    const lead = sampleAtTime(timeline, t);
    if (!lead) return;

    // visible scale: true size under the chase camera and in the helmet
    const leadY = ground.y(lead.x, lead.z, lead.h);
    const dist = camera.position.distanceTo(new THREE.Vector3(lead.x, leadY, lead.z));
    const trueSize = helmet || (chase && ui.followCrew);
    const targetS = scale === 'auto' ? visibleScale(dist, trueSize) : scale;
    scaleRef.current += (targetS - scaleRef.current) * (initd.current && !trueSize ? 1 - Math.exp(-8 * dt) : 1);
    const s = scaleRef.current;

    const riding = lead.mode === 'rover';
    // helmet view: the partner walks well behind and to the side, so nothing ever fills the near field of the camera
    const sepVis = helmet ? Math.max(separationM, 9) : Math.max(separationM, 1.6 * s);
    // in helmet view the partner is placed from the lead's own heading (never from the path ahead, which on the way home
    // can be the outbound leg): 9 m behind and 3 m to the side, outside the camera's field of view
    const fx = Math.sin(lead.headingRad), fz = -Math.cos(lead.headingRad);
    const buddy: Sample | null = helmet ? { ...lead, x: lead.x - fx * sepVis, z: lead.z - fz * sepVis, mode: 'walk', speedMps: lead.speedMps }
      : riding ? lead : sampleAtOdometer(timeline, lead.odometerM - sepVis);
    const samples: [Sample, Sample | null] = [lead, buddy];
    const lateral = helmet ? 3 : riding ? 0.32 : 0.7;

    for (let i = 0; i < 2; i++) {
      const smp = samples[i];
      const g = outer.current[i];
      const sh = shadows.current[i];
      if (!g || !smp) continue;
      const side = i === 0 ? 1 : -1;
      const px = Math.cos(smp.headingRad), pz = Math.sin(smp.headingRad); // perpendicular
      const off = lateral * s * side;
      const back = riding ? -0.75 * s : 0; // crew stand on the rover's rear deck (see createRover)
      const x = smp.x + px * off + Math.sin(smp.headingRad) * back, z = smp.z + pz * off - Math.cos(smp.headingRad) * back;
      const gy = ground.y(x, z, smp.h);
      const y = gy + (riding ? 1.06 * s : 0);
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
      const amp = moving ? Math.min(1, 0.55 + smp.speedMps / 1.6) : 0;
      poseAstronaut(A[i], phase.current[i], amp, riding);

      // soft contact shadow cast away from the sun, laid on the local ground plane (rover deck while riding)
      if (sh) {
        sh.visible = g.visible;
        const len = (riding ? 0.8 : 1.99 * sun.len) * s, wid = 0.62 * s;
        const cx = x + sun.dx * len * 0.42, cz = z + sun.dz * len * 0.42;
        const e = 0.8 * s;
        const hx = ground.y(cx + e, cz, null) - ground.y(cx - e, cz, null), hz = ground.y(cx, cz + e, null) - ground.y(cx, cz - e, null);
        nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
        const sy = riding ? y + 0.01 * s : Math.max(gy, ground.y(cx, cz, null)) + 0.03 * s;
        // plane in xz, long axis along the shadow, then tilted onto the ground normal
        m4.makeRotationX(-Math.PI / 2);
        sh.quaternion.setFromRotationMatrix(m4);
        sh.rotateOnWorldAxis(up, Math.atan2(-sun.dz, sun.dx));
        q.setFromUnitVectors(up, nrm);
        sh.quaternion.premultiply(q);
        sh.position.set(cx, sy, cz);
        sh.scale.set(len * 1.15, wid, 1);
      }

      // footfall dust: one puff per half cycle, only at modest playback speeds so it stays subtle
      if (moving && initd.current && Math.floor(phase.current[i] / Math.PI) !== Math.floor(before / Math.PI) && usePlayback.getState().speed <= 60) {
        spawn(x - Math.sin(smp.headingRad) * 0.1 * s, gy + 0.03 * s, z + Math.cos(smp.headingRad) * 0.1 * s, 0.16 * s);
      }
    }
    initd.current = true;

    // dust
    const im = puffs.current;
    if (im) {
      for (let k = 0; k < PUFFS; k++) {
        const p = puffState.current[k];
        p.age += dt;
        const life = 1.4;
        if (p.age >= life) { im.setMatrixAt(k, hidden); continue; }
        const u = p.age / life;
        const sc = p.size * (0.5 + 1.4 * u) * Math.sqrt(Math.sin(Math.PI * u));
        tmp.position.set(p.x, p.y + p.size * 0.6 * u, p.z);
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
      {chase && <ChaseCamera timeline={timeline} ground={ground} />}
      {A.map((a, i) => (
        <group key={i} ref={(g) => { outer.current[i] = g; }}>
          <primitive object={a.root} />
          {tags && !helmetOn && (
            <Html position={[0, a.height + 0.4, 0]} center zIndexRange={[20, 0]}>
              <Tag timeline={timeline} name={i === 0 ? 'Crew 1' : 'Crew 2'} scaleRef={scaleRef} reserveHint={i === 0} side={i === 0 ? 1 : -1} />
            </Html>
          )}
        </group>
      ))}
      {[0, 1].map((i) => (
        <mesh key={`sh${i}`} ref={(m) => { shadows.current[i] = m; }} geometry={SHADOW_GEOMETRY} material={shadowMat} renderOrder={4} raycast={() => null} />
      ))}
      <instancedMesh ref={puffs} args={[undefined, undefined, PUFFS]} frustumCulled={false} renderOrder={5} raycast={() => null}>
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial color="#b49a84" transparent opacity={0.1} depthWrite={false} />
      </instancedMesh>
      <TurnBackMarker timeline={timeline} ground={ground} />
    </>
  );
}
