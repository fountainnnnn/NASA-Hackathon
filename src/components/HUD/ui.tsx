'use client';
import { Ban, Calculator, ChevronDown, ChevronUp, CircleHelp, Satellite } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Provenance } from '@/lib/contracts';
import s from './hud.module.css';

export const PROV: Record<Provenance, { label: string; Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>; color: string }> = {
  observed: { label: 'Observed NASA data', Icon: Satellite, color: 'var(--prov-observed)' },
  computed: { label: 'Computed from NASA data', Icon: Calculator, color: 'var(--prov-computed)' },
  assumption: { label: 'Assumption', Icon: CircleHelp, color: 'var(--prov-assumption)' },
  unavailable: { label: 'Unavailable', Icon: Ban, color: 'var(--prov-unavailable)' },
};

export function ProvBadge({ kind, long }: { kind: Provenance; long?: boolean }) {
  const p = PROV[kind];
  const short = kind === 'observed' ? 'Observed' : kind === 'computed' ? 'Computed' : p.label;
  return (
    <span className={s.badge} style={{ '--c': p.color } as React.CSSProperties} title={p.label}>
      <p.Icon size={12} aria-hidden /> {long ? p.label : short}
    </span>
  );
}

export function Slider(props: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void; text?: string; badge?: ReactNode; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={s.slider}>
      <div className={s.sliderTop}>
        <label htmlFor={id}>{props.label} {props.badge}</label>
        {props.text !== '' && <output htmlFor={id}>{props.text ?? `${props.value}${props.unit ?? ''}`}</output>}
      </div>
      <input
        id={id} type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className={s.switch}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}

export function Section({ title, icon, children, defaultOpen = true }: { title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`${s.panel} ${s.section}`}>
      <button className={s.sectionHead} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {icon} {title} {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>
      {open && <div id={id} className={s.sectionBody}>{children}</div>}
    </section>
  );
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(query);
    const f = () => setM(q.matches);
    f();
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, [query]);
  return m;
}
