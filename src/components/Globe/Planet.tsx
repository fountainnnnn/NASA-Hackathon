'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { GLOBE_LAYER_IDS, useGlobeStore } from '../../state/globe';
import { ATMO_SHELL, createAtmosphereMaterial, createPlanetMaterial, LAYER_SLOTS } from './planetMaterial';
import type { GlobalData } from './useGlobalData';

const LAYER_OPACITY = 0.7;

/** Sparse, dim, deterministic star field (no twinkle). */
function Stars() {
  const geo = useMemo(() => {
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const n = 700, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u), d = 120;
      pos.set([r * Math.cos(a) * d, u * d, r * Math.sin(a) * d], i * 3);
      const b = 0.10 + Math.pow(rnd(), 3) * 0.32;
      col.set([b, b * 0.97, b * 0.93], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return <points geometry={geo} frustumCulled={false} renderOrder={-1}><pointsMaterial size={1.2} sizeAttenuation={false} vertexColors depthWrite={false} /></points>;
}

export function Planet({ data }: { data: GlobalData }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const sun = useMemo(() => new THREE.Vector3(-0.6, 0.3, 0.75).normalize(), []);
  const mat = useMemo(() => { const m = createPlanetMaterial(); m.uniforms.uSun.value = sun; return m; }, [sun]);
  const atmo = useMemo(() => createAtmosphereMaterial(sun), [sun]);
  const geo = useMemo(() => new THREE.SphereGeometry(1, 512, 256), []);
  const shell = useMemo(() => new THREE.SphereGeometry(ATMO_SHELL, 96, 48), []);
  const layers = useGlobeStore((s) => s.layers);
  void dpr;

  useEffect(() => () => { mat.dispose(); atmo.dispose(); geo.dispose(); shell.dispose(); }, [mat, atmo, geo, shell]);

  useEffect(() => {
    mat.uniforms.uTex.value = data.texture ?? mat.uniforms.uTex.value;
    mat.uniforms.uHasTex.value = data.texture ? 1 : 0;
  }, [data.texture, mat]);
  useEffect(() => {
    if (data.demTexture) { mat.uniforms.uDem.value = data.demTexture; mat.uniforms.uDemSize.value.set(data.demSize[0], data.demSize[1]); }
    mat.uniforms.uHasDem.value = data.demTexture ? 1 : 0;
  }, [data.demTexture, data.demSize, mat]);
  useEffect(() => {
    const la = mat.uniforms.uLA.value as number[];
    GLOBE_LAYER_IDS.slice(0, LAYER_SLOTS).forEach((id, i) => {
      const t = data.layerTextures[id];
      if (t) mat.uniforms[`uL${i}`].value = t;
      la[i] = layers[id] && t ? LAYER_OPACITY : 0;
    });
  }, [data.layerTextures, layers, mat]);

  useFrame(({ camera }) => {
    mat.uniforms.uExag.value = useGlobeStore.getState().exaggeration;
    // camera-relative sun: upper left, ~50° off the view axis
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const right = new THREE.Vector3(e[0], e[1], e[2]), up = new THREE.Vector3(e[4], e[5], e[6]), back = new THREE.Vector3(e[8], e[9], e[10]);
    sun.set(0, 0, 0).addScaledVector(right, -0.62).addScaledVector(up, 0.30).addScaledVector(back, 0.62).normalize();
  });

  return (
    <>
      <Stars />
      <mesh geometry={geo} material={mat} frustumCulled={false} />
      <mesh geometry={shell} material={atmo} frustumCulled={false} renderOrder={2} />
    </>
  );
}
