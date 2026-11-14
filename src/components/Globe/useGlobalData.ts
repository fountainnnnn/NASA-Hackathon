'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { GlobalLayerId, GlobalManifest } from '../../lib/globeContracts';
import { GLOBE_LAYER_IDS, useGlobeStore } from '../../state/globe';
import { demToTexture, loadGlobalDem } from './dem';

export const GLOBAL_BASE = '/data/global';

const abs = (f: string) => (/^(https?:)?\/\//.test(f) || f.startsWith('/') ? f : `${GLOBAL_BASE}/${f}`);

function loadTex(url: string, srgb = true): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 8; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      resolve(t);
    }, undefined, () => reject(new Error(`could not load ${url}`)));
  });
}

export interface GlobalData {
  /** Real NASA global colour mosaic (2k first, then the large one swapped in). null until loaded. */
  texture: THREE.Texture | null;
  textureRes: 'none' | 'low' | 'high';
  demTexture: THREE.DataTexture | null;
  demSize: [number, number];
  layerTextures: Partial<Record<GlobalLayerId, THREE.Texture>>;
}

/**
 * Loads public/data/global/ (manifest → texture 2k→8k, MOLA DEM, layer PNGs on demand) and mirrors
 * progress into the globe store (status / manifest). Never fabricates data: if the manifest or the base
 * texture is missing, status becomes 'unavailable'.
 */
export function useGlobalData(): GlobalData {
  const [data, setData] = useState<GlobalData>({ texture: null, textureRes: 'none', demTexture: null, demSize: [2880, 1440], layerTextures: {} });
  const manifestRef = useRef<GlobalManifest | null>(null);
  const layers = useGlobeStore((s) => s.layers);
  const manifest = useGlobeStore((s) => s.manifest);
  const requested = useRef(new Set<GlobalLayerId>());

  useEffect(() => {
    let dead = false;
    const st = useGlobeStore.getState();
    (async () => {
      st.setStatus('loading');
      let man: GlobalManifest;
      try {
        const res = await fetch(`${GLOBAL_BASE}/manifest.json`);
        if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
        man = (await res.json()) as GlobalManifest;
        if (!man?.texture?.file || !man?.dem?.file) throw new Error('manifest.json is missing texture or dem entries');
      } catch (e) {
        if (!dead) st.setStatus('unavailable', (e as Error).message);
        return;
      }
      if (dead) return;
      manifestRef.current = man; st.setManifest(man);

      const hi = abs(man.texture.file);
      const lo = /8k/i.test(hi) ? hi.replace(/8k/i, '2k') : null;
      const texJob = (async () => {
        if (lo) { try { const t = await loadTex(lo); if (dead) return true; setData((d) => ({ ...d, texture: t, textureRes: 'low' })); st.setStatus('ready', useGlobeStore.getState().statusDetail); } catch { /* 2k is optional */ } }
        try {
          const t = await loadTex(hi);
          if (dead) return true;
          setData((d) => { d.texture?.dispose(); return { ...d, texture: t, textureRes: 'high' }; });
          st.setStatus('ready', useGlobeStore.getState().statusDetail);
          return true;
        } catch (e) {
          if (!dead && useGlobeStore.getState().status !== 'ready') st.setStatus('unavailable', (e as Error).message);
          return false;
        }
      })();

      const demJob = (async () => {
        try {
          const dem = await loadGlobalDem(GLOBAL_BASE, man.dem);
          const tex = await demToTexture(dem);
          if (dead) return;
          setData((d) => ({ ...d, demTexture: tex, demSize: [dem.width, dem.height] }));
        } catch (e) {
          if (!dead) { console.warn('[globe] relief unavailable:', (e as Error).message); st.setStatus(useGlobeStore.getState().status, `Relief unavailable: ${(e as Error).message}`); }
        }
      })();
      await Promise.all([texJob, demJob]);
    })();
    return () => { dead = true; };
  }, []);

  // overlay layers load lazily the first time they are switched on
  useEffect(() => {
    if (!manifest) return;
    for (const id of GLOBE_LAYER_IDS) {
      if (!layers[id] || requested.current.has(id)) continue;
      const info = manifest.layers.find((l) => l.id === id);
      if (!info) continue;
      requested.current.add(id);
      loadTex(abs(info.file)).then((t) => setData((d) => ({ ...d, layerTextures: { ...d.layerTextures, [id]: t } })))
        .catch(() => { requested.current.delete(id); console.warn(`[globe] layer ${id} failed to load`); });
    }
  }, [layers, manifest]);

  return data;
}
