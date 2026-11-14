'use client';
import { Check, CircleAlert, Ellipsis } from 'lucide-react';
import type { TraceStep } from '@/lib/contracts';
import s from './hud.module.css';

export function AgentTrace({ steps }: { steps: TraceStep[] }) {
  if (!steps.length) return null;
  return (
    <ul className={s.trace} aria-label="Tools the copilot called" style={{ listStyle: 'none' }}>
      {steps.map((t) => (
        <li key={t.id} className={s.chip} data-status={t.status} title={t.summary ?? t.tool}>
          {t.status === 'done' ? <Check size={12} aria-hidden /> : t.status === 'error' ? <CircleAlert size={12} aria-hidden /> : <Ellipsis size={12} aria-hidden />}
          <span>{t.label}</span>
          <span className={`${s.mono} ${s.muted}`}>{t.status === 'running' ? 'running' : t.ms != null ? `${Math.round(t.ms)} ms` : ''}</span>
          <span className={s.srOnly}>{t.status}</span>
        </li>
      ))}
    </ul>
  );
}
