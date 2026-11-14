'use client';
/** Popover bodies for the rail: globe layers, Jezero layers, mission limits and suit assumptions. */
import { RoverAssistControl } from '@/components/Scenario/RoverAssist';
import { nextLocalNoon, ltstAt } from '@/components/Ops/routeOps';
import type { GlobalLayerId } from '@/lib/globeContracts';
import type { LayerId, MissionConstraints } from '@/lib/contracts';
import { GLOBE_LAYER_IDS, useGlobeStore } from '@/state/globe';
import { DEFAULT_START_LTST_H, MAST_RANGE_M, useHud } from '@/state/hud';
import { nextLtstUtcMs } from '@/lib/ops/lighting';
import { useRuntime } from '@/state/services';
import { useWorld, world } from '@/state/world';
import s from './hud.module.css';

/* ------------------------------------------------------------------ popovers */

const GLOBE_LABEL: Record<GlobalLayerId, string> = {
  elevation: 'Elevation', geology: 'Geology', hydrogen: 'Hydrogen', thermalInertia: 'Thermal inertia', dust: 'Dust', slope: 'Slope',
};

export function GlobeLayers() {
  const layers = useGlobeStore((g) => g.layers);
  const manifest = useGlobeStore((g) => g.manifest);
  const exag = useGlobeStore((g) => g.exaggeration);
  const have = (id: GlobalLayerId) => !manifest || manifest.layers.some((l) => l.id === id);
  return (
    <div className={s.popBody} role="group" aria-label="Layers">
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

export function JezeroLayers() {
  const layers = useWorld((w) => w.layers);
  const exag = useWorld((w) => w.exaggeration);
  const rt = useRuntime((r) => r.rt);
  const ok = (id: LayerId) => !!rt && (id === 'slope' ? !!rt.slopeTexture : id === 'traverse' ? !!rt.traverse : id === 'ellipse' || id === 'geology' ? true : !!rt.textures[id as keyof typeof rt.textures]);
  return (
    <div className={s.popBody} role="group" aria-label="Layers">
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

function MastField() {
  const v = useHud((h) => h.mastHeightM);
  return (
    <div className={s.row}>
      <label htmlFor="as-mast">Comms mast height (m)</label>
      <input id="as-mast" className={s.num} type="number" min={MAST_RANGE_M.min} max={MAST_RANGE_M.max} step={1} value={v}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) useHud.getState().patch({ mastHeightM: Math.min(MAST_RANGE_M.max, Math.max(MAST_RANGE_M.min, Math.round(n))) }); }} />
    </div>
  );
}

export function Limits() {
  const c = useWorld((w) => w.constraints);
  const base = useWorld((w) => w.base);
  const start = useHud((h) => h.startUtcMs);
  const lon = base?.lon ?? 77.45;
  return (
    <div className={s.popBody} role="group" aria-label="Mission limits">
      <Slider label="Max slope" k="maxSlopeDeg" value={c.maxSlopeDeg} min={5} max={40} unit="°" />
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
        <button className={s.segBtn} aria-pressed={false} title="The next 09:00 local solar time at the base (the default)" onClick={() => useHud.getState().patch({ startUtcMs: nextLtstUtcMs(lon, DEFAULT_START_LTST_H, Date.now()) })}>09:00</button>
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
          <MastField />
          <RoverAssistControl />
        </div>
      </details>
    </div>
  );
}

