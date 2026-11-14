'use client';
/**
 * Screen projection for Scout. Each canvas mounts its projector as a child; the active one is picked by the shell.
 * Both read the live camera, so Scout's ring and leader stay on the ground while the camera moves.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { LonLat } from '@/lib/contracts';
import { reliefRadius } from '@/components/Globe/dem';
import { lonLatToXYZ } from '@/components/Globe/geo';
import { groundAt, useScene } from '@/components/Scene/sceneCtx';
import { useGlobeStore } from '@/state/globe';
import { useWorld } from '@/state/world';

export interface Screen { x: number; y: number; visible: boolean }
type Proj = (p: LonLat) => Screen;
const OFF: Screen = { x: 0, y: 0, visible: false };

let globeProj: Proj | null = null;
let sceneProj: Proj | null = null;
let sceneDepth: ((p: LonLat) => number) | null = null;
export const projectGlobe: Proj = (p) => (globeProj ? globeProj(p) : OFF);
export const projectJezero: Proj = (p) => (sceneProj ? sceneProj(p) : OFF);
/** Distance (m, scene units) from the Jezero camera to a point on the ground, or null when the scene is not mounted. */
export const jezeroDepth = (p: LonLat): number | null => (sceneDepth ? sceneDepth(p) : null);

export function GlobeProjector() {
  const { camera, gl } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    globeProj = (p) => {
      const exag = useGlobeStore.getState().exaggeration;
      const [x, y, z] = lonLatToXYZ(p.lon, p.lat, reliefRadius(p.lon, p.lat, exag));
      v.set(x, y, z);
      const facing = camera.position.dot(v) > v.lengthSq();
      v.project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, visible: facing && v.z < 1 };
    };
    return () => { globeProj = null; };
  }, [camera, gl, v]);
  return null;
}

export function SceneProjector() {
  const scene = useScene();
  const { camera, gl, scene: threeScene } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    sceneProj = (p) => {
      const { x, z } = scene.rt.geo.toLocal(scene.rt.meta, p.lon, p.lat);
      const exag = useWorld.getState().exaggeration;
      v.set(x, groundAt(scene, x, z, exag), z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 && v.z > -1 };
    };
    sceneDepth = (p) => {
      const { x, z } = scene.rt.geo.toLocal(scene.rt.meta, p.lon, p.lat);
      const exag = useWorld.getState().exaggeration;
      return camera.position.distanceTo(new THREE.Vector3(x, groundAt(scene, x, z, exag), z));
    };
    return () => { sceneProj = null; sceneDepth = null; };
  }, [scene, camera, gl, v]);
  useEffect(() => {
    const w = (window as unknown as { __mw?: Record<string, unknown> }).__mw;
    if (w) w.three = { scene: threeScene, camera };
  }, [threeScene, camera]);
  // keep the camera matrices fresh even when nothing else renders this frame
  useFrame(() => { camera.updateMatrixWorld(); });
  return null;
}
