'use client';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GLOBE_LAYER_IDS, MAX_EXAGGERATION, MIN_EXAGGERATION, useGlobeStore } from '../../state/globe';
import { GlobeCameraRig } from './GlobeCameraRig';
import { CamCtx, type CamState } from './globeCtx';
import styles from './globe.module.css';
import { Overlays } from './Overlays';
import { Planet } from './Planet';
import { useGlobalData } from './useGlobalData';

function hasWebGL(): boolean {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2')); } catch { return false; }
}

function Info() {
  const manifest = useGlobeStore((s) => s.manifest);
  const exag = useGlobeStore((s) => s.exaggeration);
  const setExag = useGlobeStore((s) => s.setExaggeration);
  const layers = useGlobeStore((s) => s.layers);
  const detail = useGlobeStore((s) => s.statusDetail);
  const alt = useGlobeStore((s) => s.view.altitudeKm);
  const active = manifest ? GLOBE_LAYER_IDS.filter((id) => layers[id]).map((id) => manifest.layers.find((l) => l.id === id)).filter(Boolean) : [];
  return (
    <div className={styles.info}>
      <label>
        Relief exaggeration (vertical only)
        <input type="range" min={MIN_EXAGGERATION} max={MAX_EXAGGERATION} step={1} value={exag} onChange={(e) => setExag(Number(e.target.value))} aria-label="Relief vertical exaggeration" />
        <output>{exag}x</output>
      </label>
      <span>Altitude {alt.toLocaleString('en-US')} km</span>
      {detail && manifest && <span>{detail}</span>}
      {manifest && <span>{manifest.texture.credit}. {manifest.dem.credit}.</span>}
      {active.map((l) => l && <span key={l.id}>{l.title}: {l.credit}{l.simulated ? ' (simulated, not NASA data)' : ''}</span>)}
    </div>
  );
}

/**
 * Whole-Mars globe. Mount inside a positioned parent (it fills it). Renders only while store.mode === 'globe';
 * when the camera falls into Jezero it calls store.setMode('jezero') so the orchestrator can swap canvases.
 */
export default function GlobeCanvas({ controls = true, children }: { controls?: boolean; children?: ReactNode }) {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(hasWebGL()), []);
  const data = useGlobalData();
  const mode = useGlobeStore((s) => s.mode);
  const status = useGlobeStore((s) => s.status);
  const detail = useGlobeStore((s) => s.statusDetail);
  const fadeRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const cam = useRef<CamState>({ lon: 0, lat: 0, altKm: 9000, dist: 3 });

  // veil: opaque for the first frame, then fades; re-opens when mode returns to 'globe'
  useEffect(() => {
    const el = fadeRef.current; if (!el) return;
    if (mode === 'globe') requestAnimationFrame(() => { el.style.opacity = '0'; });
  }, [mode]);

  if (webgl === false) return <div role="alert" className={styles.status}><b>3D is not available in this browser</b>The Mars globe needs WebGL 2.</div>;
  return (
    <div className={styles.root}>
      {webgl && (
        <Canvas
          flat dpr={[1, 2]} frameloop={mode === 'globe' ? 'always' : 'never'}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: 40, near: 0.01, far: 300, position: [3, 1, 3] }}
          style={{ position: 'absolute', inset: 0 }}
          aria-label="Interactive globe of Mars"
        >
          <color attach="background" args={['#060505']} />
          <CamCtx.Provider value={cam}>
            <Planet data={data} />
            <Overlays />
            <GlobeCameraRig fadeRef={fadeRef} reticleRef={reticleRef} />
            {children}
          </CamCtx.Provider>
        </Canvas>
      )}
      <div ref={reticleRef} className={styles.reticle} aria-hidden>
        <svg width="40" height="40" viewBox="-20 -20 40 40" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M-20 0H-2M2 0H20M0 -20V-2M0 2V20" />
        </svg>
      </div>
      <div ref={fadeRef} className={styles.fade} />
      {status === 'loading' && <div role="status" className={styles.status}><b>Loading NASA global data</b></div>}
      {status === 'unavailable' && <div role="status" className={styles.status}><b>NASA global data unavailable</b>{detail}</div>}
      {controls && mode === 'globe' && <Info />}
    </div>
  );
}
