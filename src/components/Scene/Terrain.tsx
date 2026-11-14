'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { applyExaggeration, buildTerrainGeometry, marchRay, meshHeightAt } from '@/lib/scene/terrainGrid';
import { loadImageTexture } from '@/lib/scene/textures';
import { useRuntime } from '@/state/services';
import { useHover } from '@/state/ui';
import { useWorld } from '@/state/world';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { createTerrainMaterial } from './terrainMaterial';
import { PATCH_BLEND_M } from './contextGrid';
import { hoverPoint, pickPoint } from './pick';
import { useScene } from './sceneCtx';

interface DetailIndex { metresPerPixel: number; tiles: { file: string; uv: [number, number, number, number] }[] }
let detailIndex: Promise<DetailIndex | null> | null = null;
const loadDetailIndex = () => (detailIndex ??= fetch('/data/ctx_tiles/index.json').then((r) => (r.ok ? r.json() as Promise<DetailIndex> : null)).catch(() => null));
/** Camera height above the ground (m) under which the native-resolution CTX tile is swapped in. */
export const DETAIL_BELOW_M = 4000;

/**
 * Native-resolution CTX tile near the camera: every half second, pick the tile whose centre is nearest the point the camera
 * looks at (with at least ~1 km of margin) when the camera is low; keep at most two decoded tiles.
 */
function useCtxDetail(uniforms: ReturnType<typeof createTerrainMaterial>['uniforms']) {
  const { grid } = useScene();
  const { camera, controls, gl } = useThree();
  const st = useRef({ idx: null as DetailIndex | null, want: '', cur: '', next: 0, cache: new Map<string, THREE.Texture>(), loading: '' });
  useEffect(() => { void loadDetailIndex().then((i) => { st.current.idx = i; }); }, []);
  useEffect(() => () => { st.current.cache.forEach((t) => t.dispose()); st.current.cache.clear(); }, []);
  useFrame((_, dt) => {
    const s = st.current;
    uniforms.uDetailMix.value = s.cur ? Math.min(1, uniforms.uDetailMix.value + dt / 0.4) : 0;
    const now = performance.now();
    if (now < s.next || !s.idx) return;
    s.next = now + 500;
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? camera.position;
    const exag = useWorld.getState().exaggeration;
    const h = camera.position.y - meshHeightAt(grid, camera.position.x, camera.position.z, exag);
    const u = (target.x - grid.x0) / ((grid.nx - 1) * grid.dx), v = (target.z - grid.z0) / ((grid.nz - 1) * grid.dz);
    let best = '', bestD = Infinity, rect: number[] = [];
    if (h < DETAIL_BELOW_M && u > 0 && u < 1 && v > 0 && v < 1) {
      for (const t of s.idx.tiles) {
        const [u0, v0, du, dv] = t.uv;
        const d = Math.hypot(u - (u0 + du / 2), v - (v0 + dv / 2));
        if (d < bestD) { bestD = d; best = t.file; rect = t.uv; }
      }
    }
    if (best === s.cur) return;
    if (!best) { s.cur = ''; return; }
    const have = s.cache.get(best);
    if (have) {
      s.cur = best; uniforms.tDetail.value = have; uniforms.uDetailRect.value.set(rect[0], rect[1], rect[2], rect[3]); uniforms.uDetailMix.value = 0;
      return;
    }
    if (s.loading === best) return;
    s.loading = best;
    void loadImageTexture(`/data/ctx_tiles/${best}`, 'color').then((tex) => {
      tex.anisotropy = gl.capabilities.getMaxAnisotropy();
      s.cache.set(best, tex);
      while (s.cache.size > 2) { const k = [...s.cache.keys()].find((x) => x !== best && x !== s.cur); if (!k) break; s.cache.get(k)?.dispose(); s.cache.delete(k); }
      s.loading = '';
      s.next = 0; // apply on the next frame
    }).catch(() => { s.loading = ''; });
  });
}

interface HiriseMeta { file: string; mask: string; lonMin: number; lonMax: number; latMin: number; latMax: number; metresPerPixel: { northSouth: number; eastWest: number } }
let hiriseMeta: Promise<HiriseMeta | null> | null = null;
const loadHiriseMeta = () => (hiriseMeta ??= fetch('/data/hirise/meta.json').then((r) => (r.ok ? r.json() as Promise<HiriseMeta> : null)).catch(() => null));
/** Camera height above the ground (m): HiRISE is fetched below the first, fully draped below the second, gone above the third. */
export const HIRISE_LOAD_BELOW_M = 4000, HIRISE_FULL_BELOW_M = 1600, HIRISE_NONE_ABOVE_M = 2600;

/** Single-channel texture straight from an image file (R8 on the GPU: a quarter of the RGBA memory). */
async function loadRedTexture(url: string, maxAniso: number): Promise<THREE.Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
  t.format = THREE.RedFormat; t.colorSpace = THREE.NoColorSpace; t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

/**
 * HiRISE orthoimage around the base (scripts/prepare-hirise.mjs: the Mars 2020 TRN basemap, 25 cm controlled mosaic, read
 * at about 1.3 m per pixel over 6 x 5 km). Fetched the first time the camera comes within 4 km of the ground, draped in
 * place of CTX while the camera is under about 2 km, so walking-scale views stand on real ground detail.
 */
function useHirise(uniforms: ReturnType<typeof createTerrainMaterial>['uniforms']) {
  const { rt, grid } = useScene();
  const { camera, gl } = useThree();
  const st = useRef({ meta: null as HiriseMeta | null, state: 'idle' as 'idle' | 'loading' | 'ready' | 'failed', tex: [] as THREE.Texture[] });
  useEffect(() => { void loadHiriseMeta().then((m) => { st.current.meta = m; }); }, []);
  useEffect(() => () => { st.current.tex.forEach((t) => t.dispose()); }, []);
  useFrame((_, dt) => {
    const s = st.current;
    if (!s.meta) return;
    const exag = useWorld.getState().exaggeration;
    const h = camera.position.y - meshHeightAt(grid, camera.position.x, camera.position.z, exag);
    if (s.state === 'idle' && h < HIRISE_LOAD_BELOW_M) {
      s.state = 'loading';
      const aniso = gl.capabilities.getMaxAnisotropy();
      void Promise.all([loadRedTexture(`/data/hirise/${s.meta.file}`, aniso), loadRedTexture(`/data/hirise/${s.meta.mask}`, 1)]).then(([img, mask]) => {
        const m = s.meta!;
        const nw = rt.geo.toLocal(rt.meta, m.lonMin, m.latMax), se = rt.geo.toLocal(rt.meta, m.lonMax, m.latMin);
        uniforms.tHirise.value = img; uniforms.tHiriseMask.value = mask;
        uniforms.uHiriseRect.value.set(nw.x, nw.z, se.x - nw.x, se.z - nw.z);
        s.tex = [img, mask]; s.state = 'ready';
        if (new URLSearchParams(window.location.search).has('qa')) (window as unknown as { __hirise: unknown }).__hirise = { uniforms, st: s, aniso };
      }).catch(() => { s.state = 'failed'; });
    }
    const want = s.state === 'ready' ? 1 - Math.min(1, Math.max(0, (h - HIRISE_FULL_BELOW_M) / (HIRISE_NONE_ABOVE_M - HIRISE_FULL_BELOW_M))) : 0;
    const cur = uniforms.uHiriseMix.value;
    uniforms.uHiriseMix.value = cur + Math.max(-dt / 0.5, Math.min(dt / 0.5, want - cur));
    // the legend names HiRISE while the ground under the camera is draped with it
    const r = uniforms.uHiriseRect.value, x = camera.position.x, z = camera.position.z;
    useWalkUi.getState().setHirise(uniforms.uHiriseMix.value > 0.5 && x > r.x && x < r.x + r.z && z > r.y && z < r.y + r.w);
  });
}

export function Terrain() {
  const { rt, grid, meshRef, context } = useScene();
  const { gl } = useThree();
  const geom = useMemo(() => buildTerrainGeometry(grid, useWorld.getState().exaggeration), [grid]);
  const { material, uniforms, dummy } = useMemo(createTerrainMaterial, []);
  const appliedExag = useRef(useWorld.getState().exaggeration);
  const lastHover = useRef(0);
  useCtxDetail(uniforms);
  useHirise(uniforms);
  const aniso = useRef<THREE.Texture | null>(null);

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
    // full anisotropic filtering on the CTX base layer: the oblique and chase views look across it at grazing angles
    if (T.ctx && aniso.current !== T.ctx) { aniso.current = T.ctx; T.ctx.anisotropy = gl.capabilities.getMaxAnisotropy(); T.ctx.needsUpdate = true; }
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
