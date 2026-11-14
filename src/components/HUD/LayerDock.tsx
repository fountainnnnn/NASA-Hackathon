'use client';
import { Layers, MapPin, Trash2 } from 'lucide-react';
import type { LayerId } from '@/lib/contracts';
import { useRuntime } from '@/state/services';
import { useWorld, world } from '@/state/world';
import { Section, Slider, Switch } from './ui';
import s from './hud.module.css';

const ROWS: { id: LayerId; title: string; note?: string }[] = [
  { id: 'ctx', title: 'CTX imagery' },
  { id: 'themisDay', title: 'THEMIS day infrared' },
  { id: 'themisNight', title: 'THEMIS night infrared' },
  { id: 'geology', title: 'Geology (USGS)' },
  { id: 'slope', title: 'Slope limit', note: 'Red: steeper than your limit. Amber: within 80% of it.' },
  { id: 'traverse', title: 'Perseverance traverse' },
  { id: 'ellipse', title: 'Landing ellipse' },
];

export function LayerDock() {
  const layers = useWorld((st) => st.layers);
  const opacity = useWorld((st) => st.layerOpacity);
  const exag = useWorld((st) => st.exaggeration);
  const annotations = useWorld((st) => st.annotations);
  const rt = useRuntime((st) => st.rt);
  const geologyState = useRuntime((st) => st.geologyState);

  const available = (id: LayerId): boolean => {
    if (!rt) return false;
    if (id === 'slope') return !!rt.slopeTexture;
    if (id === 'traverse') return !!rt.traverse;
    if (id === 'ellipse' || id === 'geology') return geologyState !== 'error'; // loaded on first use
    return !!rt.textures[id as keyof typeof rt.textures];
  };

  return (
    <>
      <Section title="Layers" icon={<Layers size={16} aria-hidden />}>
        {ROWS.map((r) => {
          const info = rt?.layers.find((l) => l.id === r.id);
          const ok = available(r.id);
          return (
            <div key={r.id} className={s.layerRow}>
              <Switch checked={layers[r.id] && ok} disabled={!ok} label={`Show ${r.title}`} onChange={(v) => useWorld.getState().setLayer(r.id, v)} />
              <span className={s.layerTitle}>
                {r.title}
                {info?.simulated && <span className={`${s.badge} ${s.simBadge}`}>Simulated</span>}
              </span>
              {r.note && layers[r.id] && <span className={s.layerNote}>{r.note}</span>}
              {layers[r.id] && ok && (
                <div className={s.layerOpacity}>
                  <Slider label="Opacity" value={Math.round(opacity[r.id] * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => useWorld.getState().setOpacity(r.id, v / 100)} />
                </div>
              )}
              {r.id === 'geology' && layers.geology && rt && rt.geologyUnits.length > 0 && (
                <div className={`${s.layerOpacity} ${s.unitChips}`}>
                  {rt.geologyUnits.map((u) => (
                    <span key={u.symbol} className={s.unitChip} title={u.name}><i style={{ background: u.color }} />{u.symbol}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <Slider
          label={`Vertical exaggeration ${exag.toFixed(1)}×`} text="" value={exag} min={1} max={3} step={0.1}
          onChange={(v) => useWorld.getState().setExaggeration(v)}
        />
      </Section>

      {annotations.length > 0 && (
        <Section title="Annotations" icon={<MapPin size={16} aria-hidden />}>
          {annotations.map((a) => (
            <div key={a.id} className={s.annRow}>
              <span title={a.label}>{a.label}</span>
              <button className={`${s.btn} ${s.iconBtn}`} aria-label={`Remove annotation ${a.label}`}
                onClick={() => world.applyCommands([{ type: 'remove_annotation', id: a.id }])}>
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
          <button className={s.btn} onClick={() => world.applyCommands([{ type: 'clear_annotations' }])}>Clear annotations and routes</button>
        </Section>
      )}
    </>
  );
}
