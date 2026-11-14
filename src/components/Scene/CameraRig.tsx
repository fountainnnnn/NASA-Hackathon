'use client';
import { useEffect, useMemo, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { meshHeightAt } from '@/lib/scene/terrainGrid';
import { setAnchor } from '@/state/ui';
import { useWorld } from '@/state/world';
import { useScene } from './sceneCtx';

export function sceneSpan(g: { nx: number; nz: number; dx: number; dz: number }) {
  return Math.max(Math.abs(g.dx) * (g.nx - 1), Math.abs(g.dz) * (g.nz - 1));
}

/** Initial pose: from the south-east at ~40° tilt, framing the whole tile. */
export function initialPose(g: { nx: number; nz: number; dx: number; dz: number }) {
  const span = sceneSpan(g);
  const dist = span * 0.95;
  const tilt = (40 * Math.PI) / 180;
  const h = Math.cos(tilt) * dist;
  return { position: [h * Math.SQRT1_2, Math.sin(tilt) * dist, h * Math.SQRT1_2] as [number, number, number], dist, span };
}

interface Tween { t0: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromD: number; toD: number; dir: THREE.Vector3 }

export function CameraRig() {
  const { rt, grid } = useScene();
  const ctrl = useRef<OrbitControlsImpl>(null);
  const { camera, scene, size } = useThree();
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
    const y = meshHeightAt(grid, x, z, s.exaggeration);
    const c = ctrl.current;
    const dir = camera.position.clone().sub(c.target).normalize();
    if (dir.y < 0.25) { dir.y = 0.25; dir.normalize(); }
    tween.current = {
      t0: performance.now(), dur: 550, fromT: c.target.clone(), toT: new THREE.Vector3(x, y, z),
      fromD: camera.position.distanceTo(c.target), toD: Math.min(pose.span * 2, Math.max(150, r.distanceM ?? 2500)), dir,
    };
  }), [camera, grid, pose.span, rt]);

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
    // keep the camera above the ground
    const floor = meshHeightAt(grid, camera.position.x, camera.position.z, exag) + 25;
    if (camera.position.y < floor) camera.position.y = floor;

    // adaptive clip planes + fog so depth precision holds from 150 m to 90 km
    const dist = camera.position.distanceTo(c.target);
    const near = Math.max(4, dist * 0.015);
    const persp = camera as THREE.PerspectiveCamera;
    if (Math.abs(near - last.current.near) / near > 0.05) {
      persp.near = near; persp.far = Math.max(dist * 30, pose.span * 4);
      persp.updateProjectionMatrix();
      last.current.near = near;
    }
    if (scene.fog instanceof THREE.Fog) { scene.fog.near = dist + pose.span * 0.15; scene.fog.far = dist + pose.span * 1.8; }

    // project the selected pin for the DOM ask bubble
    const sel = useWorld.getState().selected;
    if (sel) {
      tmp.set(sel.x, meshHeightAt(grid, sel.x, sel.z, exag) + 8 * exag, sel.z).project(camera);
      setAnchor({
        x: (tmp.x * 0.5 + 0.5) * size.width, y: (-tmp.y * 0.5 + 0.5) * size.height,
        visible: tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1,
      });
    } else setAnchor({ x: 0, y: 0, visible: false });
  });

  return (
    <OrbitControls
      ref={ctrl} makeDefault enableDamping dampingFactor={0.09} screenSpacePanning={false}
      minDistance={120} maxDistance={pose.span * 2} maxPolarAngle={(84 * Math.PI) / 180}
      zoomToCursor target={[0, 0, 0]}
    />
  );
}
