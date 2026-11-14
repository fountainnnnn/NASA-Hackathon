'use client';
import { Database, Info, Layers, SlidersHorizontal } from 'lucide-react';
import { useEffect } from 'react';
import { RoverAssistControl } from '@/components/Scenario/RoverAssist';
import { nextLocalNoon, ltstAt } from '@/components/Ops/routeOps';
import type { GlobalLayerId } from '@/lib/globeContracts';
import type { LayerId, MissionConstraints } from '@/lib/contracts';
import { GLOBE_LAYER_IDS, useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { useRuntime } from '@/state/services';
import { useWorld, world } from '@/state/world';
import { useIntro } from './Intro';
import s from './hud.module.css';

/* ------------------------------------------------------------------ corners */

export function TopLeft() {
  const mode = useGlobeStore((g) => g.mode);
  return (
    <div className={s.tl}>
      <span className={s.wordmark}>MarsWalk Copilot</span>
      <span className={s.byline}>by Ng Yu Hang, team Ecliptical</span>
      {mode === 'jezero' && <button className={s.link} onClick={() => useGlobeStore.getState().applyGlobeCommands([{ type: 'exit_jezero' }])}>Back to Mars</button>}
    </div>
  );
}

export function TopRight() {
  const popover = useHud((h) => h.popover);
  const sheet = useHud((h) => h.sheet);
  const mode = useGlobeStore((g) => g.mode);
  return (
    <>
      <div className={s.tr}>
        <button className={s.iconBtn} aria-label="Sources" aria-haspopup="dialog" aria-expanded={sheet === 'sources'} title="Sources" onClick={() => useHud.getState().setSheet(sheet === 'sources' ? null : 'sources')}>
          <Database size={17} strokeWidth={1.5} aria-hidden />
        </button>
        <button className={s.iconBtn} aria-label="About" aria-haspopup="dialog" title="About" onClick={() => useIntro.getState().show()}>
          <Info size={17} strokeWidth={1.5} aria-hidden />
        </button>
        {mode === 'jezero' && (
          <button className={s.iconBtn} aria-label="Mission limits" aria-expanded={popover === 'limits'} title="Mission limits" onClick={() => useHud.getState().togglePopover('limits')}>
            <SlidersHorizontal size={17} strokeWidth={1.5} aria-hidden />
          </button>
        )}
        <button className={s.iconBtn} aria-label="Layers" aria-expanded={popover === 'layers'} title="Layers" onClick={() => useHud.getState().togglePopover('layers')}>
          <Layers size={17} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      {popover === 'layers' && (mode === 'globe' ? <GlobeLayers /> : <JezeroLayers />)}
      {popover === 'limits' && mode === 'jezero' && <Limits />}
      <EscClose />
    </>
  );
}

function EscClose() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const h = useHud.getState();
      if (h.popover) h.setPopover(null);
      else if (h.sheet === 'sources') h.setSheet(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return null;
}

/* ------------------------------------------------------------------ popovers */

const GLOBE_LABEL: Record<GlobalLayerId, string> = {
  elevation: 'Elevation', geology: 'Geology', hydrogen: 'Hydrogen', thermalInertia: 'Thermal inertia', dust: 'Dust', slope: 'Slope',
};

function GlobeLayers() {
  const layers = useGlobeStore((g) => g.layers);
  const manifest = useGlobeStore((g) => g.manifest);
  const exag = useGlobeStore((g) => g.exaggeration);
  const have = (id: GlobalLayerId) => !manifest || manifest.layers.some((l) => l.id === id);
  return (
    <div className={s.pop} role="group" aria-label="Layers">
      {GLOBE_LAYER_IDS.filter(have).map((id) => {
        const info = manifest?.layers.find((l) => l.id === id);
        return (
          <label key={id} className={s.check}>
            <input type="checkbox" checked={layers[id]} onChange={(e) => useGlobeStore.getState().setLayer(id, e.target.checked)} />
            {GLOBE_LABEL[id]}
            {info?.simulated && <small>simulated</small>}
          </label>
        );
      })}
      <hr className={s.rule} />
      <div className={s.range}>
        <div className={s.row}><span>Relief height</span><b>{exag}x</b></div>
        <input type="range" min={1} max={50} step={1} value={exag} onChange={(e) => useGlobeStore.getState().setExaggeration(Number(e.target.value))} aria-label="Relief vertical exaggeration" />
      </div>
    </div>
  );
}

const JEZERO_ROWS: { id: LayerId; label: string }[] = [
  { id: 'ctx', label: 'CTX imagery' }, { id: 'themisDay', label: 'THEMIS day' }, { id: 'themisNight', label: 'THEMIS night' },
  { id: 'geology', label: 'Geology' }, { id: 'slope', label: 'Slope limit' }, { id: 'traverse', label: 'Perseverance traverse' }, { id: 'ellipse', label: 'Landing ellipse' },
];

function JezeroLayers() {
  const layers = useWorld((w) => w.layers);
  const exag = useWorld((w) => w.exaggeration);
  const rt = useRuntime((r) => r.rt);
  const ok = (id: LayerId) => !!rt && (id === 'slope' ? !!rt.slopeTexture : id === 'traverse' ? !!rt.traverse : id === 'ellipse' || id === 'geology' ? true : !!rt.textures[id as keyof typeof rt.textures]);
  return (
    <div className={s.pop} role="group" aria-label="Layers">
      {JEZERO_ROWS.map((r) => (
        <label key={r.id} className={s.check} data-off={!ok(r.id)}>
          <input type="checkbox" checked={layers[r.id] && ok(r.id)} disabled={!ok(r.id)} onChange={(e) => useWorld.getState().setLayer(r.id, e.target.checked)} />
          {r.label}
        </label>
      ))}
      {layers.slope && <p className={s.note}>Red is steeper than your limit, amber is within 80% of it.</p>}
      <hr className={s.rule} />
      <div className={s.range}>
        <div className={s.row}><span>Relief height</span><b>{exag.toFixed(1)}x</b></div>
        <input type="range" min={1} max={3} step={0.1} value={exag} onChange={(e) => useWorld.getState().setExaggeration(Number(e.target.value))} aria-label="Vertical exaggeration" />
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, unit, k }: { label: string; value: number; min: number; max: number; step?: number; unit: string; k: Exclude<keyof MissionConstraints, 'objective'> }) {
  return (
    <div className={s.range}>
      <div className={s.row}><label htmlFor={`lim-${k}`}>{label}</label><b>{value}{unit}</b></div>
      <input id={`lim-${k}`} type="range" min={min} max={max} step={step} value={value} onChange={(e) => world.setConstraints({ [k]: Number(e.target.value) })} />
    </div>
  );
}

function Field({ k, label, unit, min, max, step }: { k: 'suitPowerW' | 'batteryWh' | 'crewMassKg' | 'suitSpeedFactor'; label: string; unit: string; min: number; max: number; step: number }) {
  const v = useWorld((w) => w.constraints[k]);
  return (
    <div className={s.row}>
      <label htmlFor={`as-${k}`}>{label} ({unit})</label>
      <input id={`as-${k}`} className={s.num} type="number" min={min} max={max} step={step} value={v}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) world.setConstraints({ [k]: n }); }} />
    </div>
  );
}

function Limits() {
  const c = useWorld((w) => w.constraints);
  const base = useWorld((w) => w.base);
  const start = useHud((h) => h.startUtcMs);
  const lon = base?.lon ?? 77.45;
  return (
    <div className={s.pop} role="group" aria-label="Mission limits">
      <Slider label="Max slope" k="maxSlopeDeg" value={c.maxSlopeDeg} min={5} max={40} unit=" deg" />
      <Slider label="Battery reserve" k="batteryReservePct" value={c.batteryReservePct} min={0} max={60} step={5} unit="%" />
      <Slider label="EVA limit" k="evaMaxMin" value={c.evaMaxMin} min={30} max={480} step={15} unit=" min" />
      <Slider label="Dwell at the target" k="dwellMin" value={c.dwellMin} min={0} max={180} step={5} unit=" min" />
      <div className={s.row}>
        <span>Objective</span>
        <div className={s.seg}>
          {(['fastest', 'shortest'] as const).map((o) => (
            <button key={o} className={s.segBtn} aria-pressed={c.objective === o} onClick={() => world.setConstraints({ objective: o })}>{o === 'fastest' ? 'Fastest' : 'Shortest'}</button>
          ))}
        </div>
      </div>
      <div className={s.row}>
        <span>Start, local solar time</span>
        <b>{ltstAt(start, lon)}</b>
      </div>
      <div className={s.seg}>
        <button className={s.segBtn} aria-pressed={false} onClick={() => useHud.getState().patch({ startUtcMs: Date.now() })}>Now</button>
        <button className={s.segBtn} aria-pressed={false} onClick={() => useHud.getState().patch({ startUtcMs: nextLocalNoon({ lon, lat: base?.lat ?? 18.4 }, Date.now()) })}>Local noon</button>
      </div>
      <details className={s.details}>
        <summary>Assumptions</summary>
        <div>
          <p className={s.note}>Model inputs, not NASA values. Change them to see how a walk responds.</p>
          <Field k="suitPowerW" label="Suit power" unit="W" min={20} max={2000} step={10} />
          <Field k="batteryWh" label="Battery" unit="Wh" min={100} max={20000} step={100} />
          <Field k="crewMassKg" label="Crew, suit, kit" unit="kg" min={40} max={400} step={5} />
          <Field k="suitSpeedFactor" label="Suit speed" unit="x Tobler" min={0.1} max={1} step={0.05} />
          <RoverAssistControl />
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ bottom */

export function Credit() {
  const mode = useGlobeStore((g) => g.mode);
  return (
    <p className={s.credit}>
      {mode === 'globe'
        ? 'Viking MDIM mosaic, MOLA, USGS SIM 3292, Odyssey GRS. Not affiliated with NASA.'
        : 'MRO CTX DEM and imagery, THEMIS, USGS SIM 3464, Perseverance. Not affiliated with NASA.'}
    </p>
  );
}

export function Hint() {
  const mode = useGlobeStore((g) => g.mode);
  const walk = useHud((h) => h.walkOn);
  const landing = useHud((h) => h.landing);
  const rt = useRuntime((r) => r.rt);
  const bubble = useHud((h) => h.sheet);
  if (mode === 'jezero' && !rt) return <p className={s.status} role="status">Loading terrain</p>;
  if (walk || landing || bubble === 'cuff') return null;
  return <p className={s.hint}>{mode === 'jezero' ? 'Drag to plan. Shift-drag to lasso. Right-drag to orbit.' : 'Click the planet. Drag to turn it. Scroll to zoom.'}</p>;
}

export function Toasts() {
  const t = useWorld((w) => w.toasts);
  useEffect(() => {
    if (!t.length) return;
    const id = setTimeout(() => useWorld.getState().dismissToast(t[0].id), 6000);
    return () => clearTimeout(id);
  }, [t]);
  if (!t.length) return null;
  return <div className={s.toast} role="status" aria-live="polite">{t[t.length - 1].text}</div>;
}
