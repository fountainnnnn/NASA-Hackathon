'use client';
import { Crosshair, Flag, Footprints, Mountain, Search } from 'lucide-react';
import { useId, useState } from 'react';
import type { MissionConstraints } from '@/lib/contracts';
import { fmtElev, fmtLat, fmtLon } from '@/lib/scene/format';
import { planRoundTripToSelection, showSteepestStretch, whatsHere } from '@/state/services';
import { useWorld, world } from '@/state/world';
import { ProvBadge, Section, Slider } from './ui';
import s from './hud.module.css';

const set = (c: Partial<MissionConstraints>) => { world.setConstraints(c); };

function AssumptionField({ k, label, unit, min, max, step }: { k: 'suitPowerW' | 'batteryWh' | 'crewMassKg' | 'suitSpeedFactor'; label: string; unit: string; min: number; max: number; step: number }) {
  const id = useId();
  const v = useWorld((st) => st.constraints[k]);
  return (
    <div className={s.field}>
      <div className={s.fieldTop}><label htmlFor={id}>{label} ({unit})</label><ProvBadge kind="assumption" /></div>
      <input id={id} className={s.num} type="number" min={min} max={max} step={step} value={v}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) world.setConstraints({ [k]: n }); }} />
    </div>
  );
}

export function MissionPanel() {
  const c = useWorld((st) => st.constraints);
  const base = useWorld((st) => st.base);
  const selected = useWorld((st) => st.selected);
  const hasRoute = useWorld((st) => st.visibleRouteIds.length > 0);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, fn: () => Promise<void>) => { setBusy(name); try { await fn(); } finally { setBusy(null); } };
  return (
    <Section title="Mission" icon={<Flag size={16} aria-hidden />}>
      <div className={s.baseBox}>
        <div><strong>Base</strong> <span className={s.muted}>{base?.label ?? 'not set'}</span></div>
        {base && <span className={`${s.mono} ${s.muted}`}>{fmtLat(base.lat)}, {fmtLon(base.lon)}, {fmtElev(base.elevationM)}</span>}
        <button className={s.btn} disabled={!selected} onClick={() => selected && world.setBase(selected)}>
          <Crosshair size={15} aria-hidden /> Set base to selection
        </button>
      </div>

      <Slider label="Max slope" value={c.maxSlopeDeg} min={5} max={40} unit="°" onChange={(v) => set({ maxSlopeDeg: v })} />
      <Slider label="Battery reserve" value={c.batteryReservePct} min={0} max={60} step={5} unit="%" onChange={(v) => set({ batteryReservePct: v })} />
      <Slider label="EVA limit" value={c.evaMaxMin} min={30} max={480} step={15} unit=" min" onChange={(v) => set({ evaMaxMin: v })} />
      <Slider label="Dwell at destination" value={c.dwellMin} min={0} max={180} step={5} unit=" min" onChange={(v) => set({ dwellMin: v })} />
      <div className={s.field}>
        <span id="obj-label">Objective</span>
        <div className={s.seg} role="radiogroup" aria-labelledby="obj-label">
          {(['fastest', 'shortest'] as const).map((o) => (
            <button key={o} role="radio" aria-checked={c.objective === o} onClick={() => set({ objective: o })}>{o === 'fastest' ? 'Fastest' : 'Shortest'}</button>
          ))}
        </div>
      </div>

      <details>
        <summary><ProvBadge kind="assumption" /> Assumptions</summary>
        <div className={s.sectionBody} style={{ padding: '10px 0 0' }}>
          <p className={s.note}>Model inputs, not NASA values. Change them to see how a route responds.</p>
          <AssumptionField k="suitPowerW" label="Suit power" unit="W" min={20} max={2000} step={10} />
          <AssumptionField k="batteryWh" label="Battery capacity" unit="Wh" min={100} max={20000} step={100} />
          <AssumptionField k="crewMassKg" label="Crew + suit + kit mass" unit="kg" min={40} max={400} step={5} />
          <AssumptionField k="suitSpeedFactor" label="Suit speed factor" unit="× Tobler" min={0.1} max={1} step={0.05} />
        </div>
      </details>

      <div className={s.actions}>
        <button className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`} disabled={!selected || busy !== null} onClick={() => run('plan', planRoundTripToSelection)}>
          <Footprints size={16} aria-hidden /> {busy === 'plan' ? 'Planning…' : 'Plan round trip to selection'}
        </button>
        <button className={`${s.btn} ${s.btnBlock}`} disabled={!hasRoute || busy !== null} onClick={() => run('steep', showSteepestStretch)}>
          <Mountain size={16} aria-hidden /> Show steepest stretch
        </button>
        <button className={`${s.btn} ${s.btnBlock}`} disabled={!selected || busy !== null} onClick={() => run('here', whatsHere)}>
          <Search size={16} aria-hidden /> What&apos;s here?
        </button>
        {!selected && <p className={s.note}>Click the terrain to select a point.</p>}
      </div>
    </Section>
  );
}
