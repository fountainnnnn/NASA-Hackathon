'use client';
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LayerInfo } from '@/lib/contracts';
import { useRuntime } from '@/state/services';
import { useWorld } from '@/state/world';
import { ProvBadge } from './ui';
import s from './hud.module.css';

const NO_LAYERS: LayerInfo[] = [];

interface ArtCredit { file: string; description?: string; generator?: string; method?: string }

export function SourcesPanel() {
  const open = useWorld((st) => st.sourcesOpen);
  const layers = useRuntime((st) => st.rt?.layers ?? NO_LAYERS);
  const meta = useRuntime((st) => st.rt?.meta);
  const close = () => useWorld.getState().patch({ sourcesOpen: false });
  const ref = useRef<HTMLButtonElement>(null);
  const [art, setArt] = useState<ArtCredit[]>([]);
  useEffect(() => {
    if (!open) return;
    fetch('/art/CREDITS.json').then((r) => (r.ok ? r.json() : [])).then((j) => setArt(Array.isArray(j) ? j : [])).catch(() => setArt([]));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (!open) return null;
  return (
    <div className={s.modalBack} onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`${s.panel} ${s.modal}`} role="dialog" aria-modal="true" aria-labelledby="src-title">
        <div className={s.modalHead}>
          <h2 id="src-title">Data sources</h2>
          <button ref={ref} className={`${s.btn} ${s.iconBtn}`} onClick={close} aria-label="Close sources"><X size={16} aria-hidden /></button>
        </div>
        <div className={s.modalBody}>
          {meta && (
            <div className={s.src}>
              <h3>Terrain: {meta.productLabel} <ProvBadge kind="observed" /></h3>
              <span className={s.muted}>{meta.datum}. Elevations are metres above the Mars areoid at {meta.nominalResM} m posting.</span>
              {meta.sourceUrl && <a href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">{meta.sourceUrl} <ExternalLink size={12} aria-hidden /></a>}
            </div>
          )}
          {layers.length === 0 && <p className={s.muted}>No layer metadata was loaded (layers.json is missing).</p>}
          {layers.map((l) => (
            <div key={l.id} className={s.src}>
              <h3>
                {l.title} <ProvBadge kind={l.provenance} />
                {l.simulated && <span className={`${s.badge} ${s.simBadge}`}>Simulated, not NASA data</span>}
              </h3>
              <span>{l.mission}, {l.instrument}</span>
              <span className={s.muted}>Credit: {l.credit}</span>
              {l.note && <span className={s.muted}>{l.note}</span>}
              <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer">{l.sourceUrl} <ExternalLink size={12} aria-hidden /></a>
            </div>
          ))}
          <div className={s.src}>
            <h3>Validation <ProvBadge kind="computed" /></h3>
            <span>Terrain agrees with 708 Perseverance waypoints, median offset 1.1 m, mean bias −0.9 m (data/validation.json).</span>
          </div>
          <div className={s.src}>
            <h3>Artwork <span className={s.aiTag}>AI-generated</span></h3>
            <span className={s.muted}>The Scout mascot and markers are AI-generated. They use no NASA branding.</span>
            {art.map((a) => (
              <span key={a.file}>
                {a.file} <span className={s.aiTag}>AI-generated</span>{' '}
                <span className={s.muted}>{[a.description, a.generator].filter(Boolean).join(', ')}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
