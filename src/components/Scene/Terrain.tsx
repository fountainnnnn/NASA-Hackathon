'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { applyExaggeration, buildTerrainGeometry, marchRay } from '@/lib/scene/terrainGrid';
import { useRuntime } from '@/state/services';
import { useHover } from '@/state/ui';
import { useWorld } from '@/state/world';
import { createTerrainMaterial } from './terrainMaterial';
import { PATCH_BLEND_M } from './contextGrid';
import { hoverPoint, pickPoint } from './pick';
import { useScene } from './sceneCtx';

export function Terrain() {
  const { rt, grid, meshRef, context } = useScene();
  const geom = useMemo(() => buildTerrainGeometry(grid, useWorld.getState().exaggeration), [grid]);
  const { material, uniforms, dummy } = useMemo(createTerrainMaterial, []);
  const appliedExag = useRef(useWorld.getState().exaggeration);
  const lastHover = useRef(0);

  useEffect(() => () => { geom.dispose(); material.dispose(); }, [geom, material]);

  // Everything dynamic is read from the stores once per frame: no React re-render while sliders move.
  useFrame(() => {
    const s = useWorld.getState();
    const cur = useRuntime.getState().rt ?? rt;
    if (s.exaggeration !== appliedExag.current) { // y + normals only, at most once per frame
      applyExaggeration(geom, grid, s.exaggeration);
      appliedExag.current = s.exaggeration;
    }
    const T = cur.textures;
    uniforms.tCtx.value = T.ctx ?? dummy;
    uniforms.tDay.value = T.themisDay ?? dummy;
    uniforms.tNight.value = T.themisNight ?? dummy;
    uniforms.tGeo.value = T.geology ?? dummy;
    uniforms.tPal.value = cur.paletteTexture ?? dummy;
    uniforms.tSlope.value = cur.slopeTexture ?? dummy;
    uniforms.uHas.value.set(+!!T.ctx, +!!T.themisDay, +!!T.themisNight, +!!T.geology);
    uniforms.uHas2.value.set(+!!cur.slopeTexture, +!!cur.paletteTexture);
    const L = s.layers, O = s.layerOpacity;
    uniforms.uOp.value.set(L.ctx ? O.ctx : 0, L.themisDay ? O.themisDay : 0, L.themisNight ? O.themisNight : 0, L.geology ? O.geology : 0);
    uniforms.uSlopeOp.value = L.slope ? O.slope : 0;
    uniforms.uLimit.value = s.constraints.maxSlopeDeg;
    // regional context imagery: the patch edge fades into it (set once the context data is in the scene)
    if (context) {
      const r = context.rect, p = context.patchRect;
      uniforms.tWide.value = context.data.texture;
      uniforms.uHasWide.value = 1;
      uniforms.uWideGain.value = context.data.meta.imageGainToPatch;
      uniforms.uWideRect.value.set(r.xMin, r.zMin, r.xMax - r.xMin, r.zMax - r.zMin);
      uniforms.uPatchRect.value.set(p.xMin, p.zMin, p.xMax, p.zMax);
      uniforms.uBlendM.value = PATCH_BLEND_M;
    } else uniforms.uHasWide.value = 0;
  });

  const raycast = useMemo(() => (raycaster: THREE.Raycaster, out: THREE.Intersection[]) => {
    const r = raycaster.ray;
    const t = marchRay(grid, useWorld.getState().exaggeration, r.origin, r.direction, raycaster.near, raycaster.far);
    if (t != null && meshRef.current) out.push({ distance: t, point: r.at(t, new THREE.Vector3()), object: meshRef.current });
  }, [grid, meshRef]);

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const now = performance.now();
    if (now - lastHover.current < 80) return;
    lastHover.current = now;
    hoverPoint(useRuntime.getState().rt ?? rt, e.point);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return; // it was a drag (orbit/pan), not a click
    e.stopPropagation();
    pickPoint(useRuntime.getState().rt ?? rt, e.point);
  };

  return (
    <mesh
      ref={meshRef} geometry={geom} material={material} raycast={raycast} frustumCulled={false}
      onPointerMove={onMove} onPointerOut={() => useHover.getState().set(null)} onClick={onClick}
    />
  );
}
