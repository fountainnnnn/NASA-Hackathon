'use client';
import { ChevronRight, PanelRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { lightTimeMin } from '@/lib/ops/earthLink';
import { ltstHours, formatHms, marsState, sunPosition } from '@/lib/ops/mars24';
import { emitAsk } from '@/state/companion';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { formatMissionTime, usePlayback, useThrottledT } from '@/state/playback';
import { useGlobal } from '@/state/services';
import { useSession } from '@/state/session';
import { useShell } from '@/state/shell';
import { useWorld } from '@/state/world';
import { useIntro } from './Intro';
import { useSimLoaded } from './Timeline';
import s from './shell.module.css';

function useNow(ms = 1000) {
  const [now, setNow] = useState(0); // 0 until mounted: the server render must not depend on the clock
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

/**
 * Where the clock reads local time and sun elevation: the place you selected (a click, a landing site), else the base
 * while in Jezero. With no place there is no local time to give, so the cells say so instead of reading the view centre.
 */
function useClockSite(): { lon: number; lat: number; label: string } | null {
  const site = useSession((x) => x.site);
  const mode = useGlobeStore((g) => g.mode);
  const base = useWorld((w) => w.base);
  const ll = (p: { lon: number; lat: number }) => `${Math.abs(p.lat).toFixed(2)}${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(2)}${p.lon >= 0 ? 'E' : 'W'}`;
  if (mode === 'jezero' && base && (!site || (Math.abs(site.lon - base.lon) < 1e-9 && Math.abs(site.lat - base.lat) < 1e-9))) return { lon: base.lon, lat: base.lat, label: 'the base' };
  if (site) return { lon: site.lon, lat: site.lat, label: ll(site) };
  if (mode === 'jezero' && base) return { lon: base.lon, lat: base.lat, label: 'the base' };
  return null;
}

export function TopBar() {
  const mode = useGlobeStore((g) => g.mode);
  const region = useSession((x) => x.region);
  const place = useSession((x) => x.place);
  const open = useShell((x) => x.panelOpen);
  const earth = useGlobal((g) => g.earth);
  const kind = usePlayback((p) => p.kind);
  const start = useHud((h) => h.startUtcMs);
  const walkOn = useHud((h) => h.walkOn);
  const t = useThrottledT(4);
  const now = useNow(1000);
  const site = useClockSite();

  // a simulation counts only while its timeline is on screen; when it collapses the mission clock returns to T+00:00:00
  const simOn = useSimLoaded();
  // mission instant: EVA start plus scenario time while a walk plays, otherwise now
  // landing: the descent is timed to touch down at 10:00 local solar time at the site (daylight), entry + scenario time
  const landStart = useHud((h) => h.landing?.startUtcMs);
  const when = simOn && walkOn && kind !== 'landing' ? start + t * 1000 : simOn && kind === 'landing' && landStart ? landStart + t * 1000 : now;
  let ltst = '', sun = '';
  if (now && site) try {
    ltst = formatHms(ltstHours(marsState(when), site.lon)).slice(0, 5);
    sun = `${Math.round(sunPosition(when, site.lat, site.lon).elevationDeg)}°`;
  } catch { ltst = 'n/a'; sun = 'n/a'; }
  let delay = now ? 'n/a' : '';
  if (earth && now) { const m = lightTimeMin(now, earth); if (m != null) delay = `${m.toFixed(1)} min`; }
  const regionText = mode === 'jezero' ? 'Jezero Crater' : region;

  return (
    <header className={s.top} data-avoid>
      <button type="button" className={s.brand} onClick={() => useIntro.getState().show()} aria-label="HeyMars, about this app">HEYMARS</button>
      <nav className={s.crumbs} aria-label="Location">
        {mode === 'jezero'
          ? <button type="button" className={`${s.crumbBtn} ${regionText || place ? s.crumbRoot : ''}`} onClick={() => emitAsk('Back to Mars', { origin: 'tool' })} title="Back to the whole planet">Mars</button>
          : <span className={regionText || place ? s.crumbRoot : ''}>Mars</span>}
        {regionText && <><ChevronRight size={12} strokeWidth={1.5} aria-hidden className={s.crumbRoot} /><span>{regionText}</span></>}
        {place && place !== regionText && <><ChevronRight size={12} strokeWidth={1.5} aria-hidden /><b>{place}</b></>}
      </nav>
      <div className={s.clock} role="group" aria-label="Mission clock">
        <div className={s.cell} title="Elapsed time of the loaded simulation"><small>Mission time</small><span>{formatMissionTime(simOn ? t : 0)}</span></div>
        <div className={s.cell} title={site ? `Local true solar time at ${site.label}, NASA GISS Mars24` : 'Select a place on Mars to read its local solar time'}><small>Local solar time{site ? `, ${site.label === 'the base' ? 'base' : 'selected'}` : ''}</small>{site ? <span>{ltst}</span> : <em className={s.none}>select a place</em>}</div>
        <div className={s.cell} title={site ? `Sun elevation at ${site.label}, Mars24` : 'Select a place on Mars to read the sun elevation there'}><small>Sun elevation</small>{site ? <span>{sun}</span> : <em className={s.none}>select a place</em>}</div>
        <div className={s.cell} title="One-way light time from Earth, NASA JPL Horizons"><small>Earth light delay</small><span>{delay}</span></div>
      </div>
      <span className={s.by}>Ng Yu Hang, team Ecliptical</span>
      <button type="button" className={s.agentBtn} aria-pressed={open} aria-controls="marsagent-panel" aria-label="MarsAgent panel" onClick={() => useShell.getState().togglePanel()} title={open ? 'Collapse the MarsAgent panel' : 'Open the MarsAgent panel'}>
        <PanelRight size={14} strokeWidth={1.5} aria-hidden /><span className={s.agentLabel}>MarsAgent</span>
      </button>
    </header>
  );
}
