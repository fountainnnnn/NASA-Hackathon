'use client';
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import { fmtElev, fmtLat, fmtLon } from '@/lib/scene/format';
import { PLACEHOLDER_LABEL } from '@/lib/scene/placeholder';
import { useRuntime } from '@/state/services';
import { useHover } from '@/state/ui';
import { useWorld } from '@/state/world';
import s from './hud.module.css';

export function Toasts() {
  const toasts = useWorld((st) => st.toasts);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => useWorld.getState().dismissToast(toasts[0].id), 7000);
    return () => clearTimeout(t);
  }, [toasts]);
  return (
    <div className={s.toasts} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`${s.panel} ${s.toast}`} data-kind={t.kind}>
          {t.kind === 'error' ? <CircleAlert size={16} aria-hidden /> : <Info size={16} aria-hidden />}
          <span>{t.text}</span>
          <button className={`${s.btn} ${s.iconBtn}`} style={{ width: 26, minHeight: 26 }} aria-label="Dismiss message" onClick={() => useWorld.getState().dismissToast(t.id)}><X size={14} aria-hidden /></button>
        </div>
      ))}
    </div>
  );
}

export function HoverReadout() {
  const h = useHover((st) => st.hover);
  return (
    <div className={`${s.panel} ${s.readout}`} aria-hidden={!h}>
      {h
        ? <><span><b>{fmtLat(h.lat)}</b></span><span><b>{fmtLon(h.lon)}</b></span><span>elev <b>{fmtElev(h.elev)}</b></span></>
        : <span>Hover the terrain for coordinates and elevation. Click to select.</span>}
    </div>
  );
}

export function CreditStrip() {
  return (
    <button className={s.credit} onClick={() => useWorld.getState().patch({ sourcesOpen: true })} aria-haspopup="dialog">
      NASA MRO CTX, Mars Odyssey THEMIS, USGS SIM 3464, Perseverance
    </button>
  );
}

export function PlaceholderBanner() {
  const p = useRuntime((st) => st.rt?.placeholder);
  if (!p) return null;
  return <div className={s.banner} role="alert"><TriangleAlert size={16} aria-hidden /> {PLACEHOLDER_LABEL}. Synthetic terrain, not NASA data.</div>;
}

export function LoadingScreen() {
  const steps = useRuntime((st) => st.steps);
  const rt = useRuntime((st) => st.rt);
  const error = useRuntime((st) => st.error);
  const ready = useWorld((st) => st.ready);
  if (rt && ready) return null;
  return (
    <div className={s.loading} role="status" aria-live="polite">
      <div className={s.loadBox}>
        <h1>MarsWalk <span>Copilot</span></h1>
        <div className={s.steps}>
          {steps.map((t) => (
            <div key={t.id} className={s.step}>
              <div className={s.stepTop}>
                <span>{t.label}</span>
                <span className={`${s.mono} ${s.muted}`}>{t.status === 'error' ? 'failed' : t.status === 'done' ? 'done' : t.status === 'pending' ? 'waiting' : t.progress == null ? 'loading' : `${Math.round(t.progress * 100)}%`}</span>
              </div>
              <div className={s.bar} data-status={t.status} role="progressbar" aria-label={t.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((t.progress ?? 0) * 100)}>
                <i style={{ width: `${Math.round((t.status === 'done' ? 1 : t.progress ?? 0.15) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        {error && (
          <div>
            <p style={{ color: 'var(--bad)', marginBottom: 10 }}>{error}</p>
            <button className={s.btn} onClick={() => location.reload()}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
