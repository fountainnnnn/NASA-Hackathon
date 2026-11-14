'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { applyExaggeration, buildTerrainGeometry, marchRay } from '@/lib/scene/terrainGrid';
import { useWorld } from '@/state/world';
import { createApronMaterial } from './apronMaterial';
import { HOLE_INSET_M, insideRect } from './contextGrid';
import type { ContextScene } from './contextGrid';
import { useScene } from './sceneCtx';
import { useHover } from '@/state/ui';
import { pickPoint, hoverPoint } from './pick';

/** The regional context terrain around the high-resolution patch (MOLA 463 m + CTX global mosaic). */
export function Apron() {
  const { context } = useScene();
  return context ? <ApronMesh ctx={context} /> : null;
}

function ApronMesh({ ctx }: { ctx: ContextScene }) {
  const { rt } = useScene();
  const { grid, patchRect, rect, data } = ctx;
  const meshRef = useRef<THREE.Mesh>(null);
  const geom = useMemo(() => buildTerrainGeometry(grid, useWorld.getState().exaggeration), [grid]);
  const { material, uniforms, dummy } = useMemo(createApronMaterial, []);
  const appliedExag = useRef(useWorld.getState().exaggeration);
  const lastHover = useRef(0);

  useEffect(() => () => { geom.dispose(); material.dispose(); }, [geom, material]);

  useEffect(() => {
    uniforms.tCtx.value = data.texture;
    uniforms.uHasCtx.value = 1;
    uniforms.uGain.value = data.meta.imageGainToPatch;
    uniforms.uHole.value.set(patchRect.xMin + HOLE_INSET_M, patchRect.zMin + HOLE_INSET_M, patchRect.xMax - HOLE_INSET_M, patchRect.zMax - HOLE_INSET_M);
    uniforms.uExtent.value.set(rect.xMax - rect.xMin, rect.zMax - rect.zMin);
  }, [uniforms, data, patchRect, rect]);

  useFrame(() => {
    const s = useWorld.getState();
    if (s.exaggeration !== appliedExag.current) {
      applyExaggeration(geom, grid, s.exaggeration);
      appliedExag.current = s.exaggeration;
    }
    uniforms.uOpCtx.value = s.layers.ctx ? s.layerOpacity.ctx : 0;
    if (!data.texture) uniforms.tCtx.value = dummy;
  });

  // The apron is a hole where the patch is, so its ray test ignores hits inside the patch rectangle.
  const raycast = useMemo(() => (raycaster: THREE.Raycaster, out: THREE.Intersection[]) => {
    const r = raycaster.ray;
    const t = marchRay(grid, useWorld.getState().exaggeration, r.origin, r.direction, raycaster.near, raycaster.far);
    if (t == null || !meshRef.current) return;
    const p = r.at(t, new THREE.Vector3());
    if (insideRect(patchRect, p.x, p.z)) return;
    out.push({ distance: t, point: p, object: meshRef.current });
  }, [grid, patchRect]);

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const now = performance.now();
    if (now - lastHover.current < 80) return;
    lastHover.current = now;
    hoverPoint(rt, e.point);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    pickPoint(rt, e.point);
  };

  return (
    <mesh
      ref={meshRef} geometry={geom} material={material} raycast={raycast} frustumCulled={false} renderOrder={-2}
      onPointerMove={onMove} onPointerOut={() => useHover.getState().set(null)} onClick={onClick}
    />
  );
}
