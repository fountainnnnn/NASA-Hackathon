'use client';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildTerrainGrid } from '@/lib/scene/terrainGrid';
import { Apron } from './Apron';
import { buildContextScene } from './contextGrid';
import { CoverageOutline } from './CoverageOutline';
import { HAZE, Sky } from './Sky';
import { useRuntime } from '@/state/services';
import { CameraRig, initialPose } from './CameraRig';
import { LineLayers } from './LineLayers';
import { Pins } from './Pins';
import { Routes } from './Routes';
import { SceneCtx } from './sceneCtx';
import { Terrain } from './Terrain';

// sun from the west-south-west (azimuth 247.5° from north), 35° above the horizon; +x east, -z north
const AZ = (247.5 * Math.PI) / 180, EL = (35 * Math.PI) / 180;
const SUN: [number, number, number] = [
  Math.cos(EL) * Math.sin(AZ) * 60000, Math.sin(EL) * 60000, -Math.cos(EL) * Math.cos(AZ) * 60000,
];

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function WebGLFallback() {
  const demo = process.env.NEXT_PUBLIC_DEMO_URL; // link slot for the 30-second demo
  return (
    <div role="alert" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center', background: '#120d0e' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/fallback.jpg" alt="Screenshot of the 3D Jezero Crater view" style={{ maxWidth: 'min(720px, 100%)', maxHeight: '50dvh', borderRadius: 12 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <p style={{ fontSize: 16, maxWidth: 480 }}>
        This browser could not start 3D.{' '}
        {demo ? <a href={demo} target="_blank" rel="noopener noreferrer">Watch the 30-second demo</a> : <span>Watch the 30-second demo</span>} instead.
      </p>
    </div>
  );
}

export default function SceneCanvas() {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(hasWebGL()), []);
  const rt = useRuntime((s) => s.rt);
  const meshRef = useRef<THREE.Mesh>(null);
  const grid = useMemo(() => (rt ? buildTerrainGrid(rt.dem, rt.geo, 768) : null), [rt?.dem]); // eslint-disable-line react-hooks/exhaustive-deps
  const pose = useMemo(() => (grid ? initialPose(grid) : null), [grid]);
  const context = useMemo(
    () => (rt?.context && grid ? buildContextScene(rt.context, rt.meta, rt.geo, grid) : null),
    [rt?.context, grid], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const value = useMemo(() => (rt && grid ? { rt, grid, context, meshRef } : null), [rt, grid, context]);
  useEffect(() => { document.body.dataset.sceneReady = value ? '1' : '0'; }, [value]);
  if (webgl === false) return <WebGLFallback />;
  if (!webgl || !value || !pose) return null;
  return (
    <Canvas
      flat dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 45, near: 50, far: 800000, position: pose.position }}
      style={{ position: 'absolute', inset: 0 }}
      aria-label="3D terrain of Jezero Crater, Mars"
    >
      <color attach="background" args={[HAZE]} />
      <fog attach="fog" args={[HAZE, pose.dist, pose.dist * 3]} />
      <Sky />
      <directionalLight position={SUN} intensity={2.4} color="#ffe2c6" />
      <hemisphereLight args={['#c9b5ad', '#3a2620', 1.6]} />
      <SceneCtx.Provider value={value}>
        <Apron />
        <Terrain />
        <CoverageOutline />
        <LineLayers />
        <Routes />
        <Pins />
        <CameraRig />
      </SceneCtx.Provider>
    </Canvas>
  );
}
