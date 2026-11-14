'use client';
import { useEffect, useMemo, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { setAnchor } from '@/state/ui';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { useHud } from '@/state/hud';
import { useWorld } from '@/state/world';
import { groundAt, useScene } from './sceneCtx';
import { HAZE_NEAR_M, HAZE_SPAN_M } from './atmosphere';

export function sceneSpan(g: { nx: number; nz: number; dx: number; dz: number }) {
  return Math.max(Math.abs(g.dx) * (g.nx - 1), Math.abs(g.dz) * (g.nz - 1));
}

/** Farthest the camera may orbit from its target: far enough to take in the whole ~180 x 160 km context region. */
export const MAX_DISTANCE_M = 420_000;
/** Initial camera pitch above the horizon (deg). Low enough that the horizon sits inside the 45 deg field of view. */
export const INITIAL_PITCH_DEG = 17;

/** Initial pose: ~17 km out to the south-east, looking north-west across the crater, low enough to show the horizon. */
export function initialPose(g: { nx: number; nz: number; dx: number; dz: number }) {
  const span = sceneSpan(g);
  const dist = span * 0.58;
  const tilt = (INITIAL_PITCH_DEG * Math.PI) / 180;
  const h = Math.cos(tilt) * dist;
  return { position: [h * Math.SQRT1_2, Math.sin(tilt) * dist, h * Math.SQRT1_2] as [number, number, number], dist, span };
}

interface Tween { t0: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromD: number; toD: number; dir: THREE.Vector3 }

export function CameraRig() {
  const v = useScene();
  const { rt, grid } = v;
  const ctrl = useRef<OrbitControlsImpl>(null);
  const { camera, scene, size } = useThree();
  const walkOn = useHud((h) => h.walkOn);
  const pose = useMemo(() => initialPose(grid), [grid]);
  const tween = useRef<Tween | null>(null);
  const last = useRef({ near: 0 });
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => { // place camera once
    camera.position.set(...pose.position);
    camera.lookAt(0, 0, 0);
  }, [camera, pose]);

  useEffect(() => useWorld.subscribe((s, prev) => {
    const r = s.cameraRequest;
    if (!r || r === prev.cameraRequest || !ctrl.current) return;
    const { x, z } = rt.geo.toLocal(rt.meta, r.lon, r.lat);
    const y = groundAt(v, x, z, s.exaggeration);
    const c = ctrl.current;
    const dir = camera.position.clone().sub(c.target).normalize();
    if (dir.y < 0.25) { dir.y = 0.25; dir.normalize(); }
    tween.current = {
      t0: performance.now(), dur: 550, fromT: c.target.clone(), toT: new THREE.Vector3(x, y, z),
      fromD: camera.position.distanceTo(c.target), toD: Math.min(MAX_DISTANCE_M, Math.max(150, r.distanceM ?? 2500)), dir,
    };
  }), [camera, grid, rt, v]);

  useFrame(() => {
    const c = ctrl.current;
    if (!c) return;
    const tw = tween.current;
    if (tw) {
      const k = Math.min(1, (performance.now() - tw.t0) / tw.dur);
      const e = 1 - Math.pow(1 - k, 3);
      c.target.lerpVectors(tw.fromT, tw.toT, e);
      const d = tw.fromD + (tw.toD - tw.fromD) * e;
      camera.position.copy(c.target).addScaledVector(tw.dir, d);
      if (k >= 1) tween.current = null;
    }
    const exag = useWorld.getState().exaggeration;
    // keep the camera above the ground: 25 m in planning views (where nothing finer than the 6 m imagery is on show);
    // during a walk the chase and helmet cameras run lower, and orbiting the crew may come down to 3 m
    const g0 = groundAt(v, camera.position.x, camera.position.z, exag);
    const walk = useHud.getState().walkOn;
    const floor = g0 + (walk ? 3 * exag : 25);
    if (camera.position.y < floor) camera.position.y = floor;
    // close to the ground the CTX ortho (about 6 m per pixel) is visibly soft: the shell says so beside the legend
    useWalkUi.getState().setCloseRange(camera.position.y - g0 < 600);

    // adaptive clip planes + fog so depth precision holds from 150 m out to the whole region
    const dist = camera.position.distanceTo(c.target);
    const near = Math.max(walk ? 1.5 : 4, dist * 0.015);
    const persp = camera as THREE.PerspectiveCamera;
    if (Math.abs(near - last.current.near) / near > 0.05) {
      persp.near = near; persp.far = dist * 2 + 300_000;
      persp.updateProjectionMatrix();
      last.current.near = near;
    }
    // aerial perspective in absolute metres from the camera: clear to HAZE_NEAR_M beyond the target, fully hazed HAZE_SPAN_M later
    if (scene.fog instanceof THREE.Fog) { scene.fog.near = dist + HAZE_NEAR_M; scene.fog.far = dist + HAZE_NEAR_M + HAZE_SPAN_M; }

    // project the selected pin for the DOM ask bubble
    const sel = useWorld.getState().selected;
    if (sel) {
      tmp.set(sel.x, groundAt(v, sel.x, sel.z, exag) + 8 * exag, sel.z).project(camera);
      setAnchor({
        x: (tmp.x * 0.5 + 0.5) * size.width, y: (-tmp.y * 0.5 + 0.5) * size.height,
        visible: tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1,
      });
    } else setAnchor({ x: 0, y: 0, visible: false });
  });

  return (
    <OrbitControls
      ref={ctrl} makeDefault enableDamping dampingFactor={0.09} screenSpacePanning={false}
      // left-drag is the planner (Ops layer): orbit moves to the right button, pan to the middle one
      mouseButtons={{ LEFT: -1 as unknown as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }}
      // touch: one finger is the planner (drag to plan, like the left mouse button); two fingers orbit and zoom
      touches={{ ONE: -1 as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      minDistance={walkOn ? 12 : 120} maxDistance={MAX_DISTANCE_M} maxPolarAngle={(84 * Math.PI) / 180}
      zoomToCursor target={[0, 0, 0]}
    />
  );
}
