'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useGlobeStore } from '../../state/globe';
import { registerPlanetProjector } from './projection';
import { startLandingSimulation, stopLandingSimulation } from './simBus';
import type { PlanetHandle } from './engine';
import styles from './planet.module.css';

// Fallback when WebGL 2 or Cesium is unavailable: the previous three.js globe, children (its projector and landing layer) included.
const GlobeCanvas = dynamic(() => import('../Globe/GlobeCanvas'), { ssr: false });

function hasWebGL2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

/**
 * Whole-Mars planet on CesiumJS: NASA Mars Trek terrain (quantized mesh) with Viking and CTX imagery, flown from orbit to an
 * oblique ground view. Drop-in for GlobeCanvas: same store, same picks, same commands. Mount inside a positioned parent.
 * `children` are three.js nodes for the fallback globe only; they are not rendered while Cesium runs.
 */
export default function PlanetView({ controls = true, children }: { controls?: boolean; children?: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const credit = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const handle = useRef<PlanetHandle | null>(null);
  const [caption, setCaption] = useState<{ title: string; detail: string; loading?: boolean } | null>(null);
  const [phase, setPhase] = useState<'init' | 'ready' | 'fallback'>('init');
  const mode = useGlobeStore((s) => s.mode);
  const alt = useGlobeStore((s) => s.view.altitudeKm);

  useEffect(() => {
    if (!hasWebGL2()) { setPhase('fallback'); return; }
    let dead = false;
    void (async () => {
      try {
        const { createPlanet } = await import('./engine');
        if (dead || !stage.current || !labels.current || !credit.current) return;
        const h = await createPlanet({
          container: stage.current, labelsEl: labels.current, creditEl: credit.current,
          veil: (v) => { if (veil.current) veil.current.style.opacity = String(v); },
          caption: setCaption,
        });
        if (dead) { h.destroy(); return; }
        handle.current = h;
        registerPlanetProjector(h.project);
        if (new URLSearchParams(window.location.search).has('qa')) (window as unknown as { __planet: unknown }).__planet = Object.assign(h.debug, { startLandingSimulation, stopLandingSimulation });
        setPhase('ready');
        setTimeout(() => { if (veil.current && useGlobeStore.getState().mode === 'globe') veil.current.style.opacity = '0'; }, 500);
      } catch (e) {
        console.error('Planet view failed, using the three.js globe', e);
        if (!dead) setPhase('fallback');
      }
    })();
    return () => { dead = true; registerPlanetProjector(null); handle.current?.destroy(); handle.current = null; };
  }, []);

  // the render loop only runs while the globe owns the screen; the veil closes at hand-off and opens when we come back
  useEffect(() => {
    const h = handle.current; if (!h) return;
    h.setActive(mode === 'globe');
    if (mode === 'globe') requestAnimationFrame(() => requestAnimationFrame(() => { if (veil.current) veil.current.style.opacity = '0'; }));
  }, [mode, phase]);

  if (phase === 'fallback') return <GlobeCanvas controls={controls}>{children}</GlobeCanvas>;
  return (
    <div className={styles.root} aria-label="Interactive 3D terrain of Mars">
      <div ref={stage} className={styles.stage} />
      <div ref={labels} className={styles.labels} />
      <div ref={veil} className={styles.veil} />
      {caption && mode === 'globe' && <div className={caption.loading ? `${styles.caption} ${styles.captionLoading}` : styles.caption} data-avoid role="status"><b>{caption.title}</b><span>{caption.detail}</span></div>}
      <div ref={credit} className={styles.credit} data-avoid />
      {phase === 'init' && <div role="status" className={styles.status}><b>Loading Mars terrain</b></div>}
      {controls && mode === 'globe' && phase === 'ready' && <div className={styles.info}><span>Altitude {alt.toLocaleString('en-US')} km</span></div>}
    </div>
  );
}
