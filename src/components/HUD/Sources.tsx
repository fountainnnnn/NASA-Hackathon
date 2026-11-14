'use client';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MIN_SUN_ELEVATION_DEG, STATION_MAST_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M, SLOPE_CAUTION_FRACTION, BATTERY_CAUTION_MARGIN_PCT, EVA_CAUTION_FRACTION, COMMS_NOGO_SHADOW_M } from '@/lib/ops/assumptions';
import { DEFAULT_CONSTRAINTS } from '@/lib/contracts';
import { ROVER_SPEED_KMH } from '@/components/Scenario/model';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { lightTimeMin } from '@/lib/ops/earthLink';
import { useGlobal, useRuntime } from '@/state/services';
import s from './hud.module.css';

interface Item { title: string; credit?: string; url?: string; note?: string; flag?: string }

function Row({ it }: { it: Item }) {
  return (
    <div className={s.src}>
      {it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a> : <strong>{it.title}</strong>}
      {it.credit && <span>{it.credit}</span>}
      {it.note && <span>{it.note}</span>}
      {it.flag && <span className={s.flag}>{it.flag}</span>}
    </div>
  );
}

export function SourcesSheet() {
  const open = useHud((h) => h.sheet === 'sources');
  const manifest = useGlobeStore((g) => g.manifest);
  const layers = useRuntime((r) => r.rt?.layers);
  const meta = useRuntime((r) => r.rt?.meta);
  const [art, setArt] = useState(0);
  const earthData = useGlobal((g) => g.earth);
  useEffect(() => {
    if (!open) return;
    fetch('/art/CREDITS.json').then((r) => (r.ok ? r.json() : [])).then((j) => setArt(Array.isArray(j) ? j.length : 0)).catch(() => setArt(0));
  }, [open]);
  if (!open) return null;

  const globalItems: Item[] = manifest ? [
    { title: manifest.texture.title, credit: manifest.texture.credit, url: manifest.texture.sourceUrl },
    { title: manifest.dem.title.split(' (')[0], credit: manifest.dem.credit, url: manifest.dem.sourceUrl },
    ...manifest.layers.map((l) => ({ title: l.title, credit: l.credit, url: l.sourceUrl, flag: l.simulated ? 'Simulated, not NASA data.' : undefined })),
    ...(manifest.geology && !manifest.layers.some((l) => l.id === 'geology') ? [{ title: manifest.geology.title, credit: `${manifest.geology.authors} (${manifest.geology.year}), scale ${manifest.geology.scale}`, url: manifest.geology.url }] : []),
  ] : [{ title: 'Global dataset not loaded', flag: 'No verified data is shown for the whole planet.' }];
  const jezeroItems: Item[] = [
    ...(meta ? [{ title: meta.productLabel, credit: `${meta.datum}. ${meta.nominalResM} m posting.`, url: meta.sourceUrl }] : []),
    ...(layers ?? []).map((l) => ({ title: l.title, credit: `${l.mission}, ${l.instrument}. ${l.credit}`, url: l.sourceUrl, note: l.note, flag: l.simulated ? 'Simulated, not NASA data.' : undefined })),
    { title: 'Perseverance raw images', credit: 'NASA/JPL-Caltech', url: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/' },
    { title: 'NASA Mars Fact Sheet, gravity 3.721 m/s2', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html' },
    ...(earthData ? [{ title: earthData.source.title, url: earthData.source.url, credit: 'NASA JPL Horizons', note: `Earth is ${(lightTimeMin(Date.now(), earthData) ?? NaN).toFixed(1)} light-minutes away right now (one way).` }] : []),
    { title: 'Mars24 sun position (Allison and McEwen 2000)', credit: 'NASA GISS', url: 'https://www.giss.nasa.gov/tools/mars24/' },
  ];
  const c = DEFAULT_CONSTRAINTS;
  return (
    <div className={s.sheet} role="dialog" aria-modal="false" aria-labelledby="src-title">
      <div className={s.sheetHead}>
        <h2 id="src-title">Where every number comes from</h2>
        <button className={s.iconBtn} aria-label="Close sources" onClick={() => useHud.getState().setSheet(null)}><X size={16} strokeWidth={1.5} aria-hidden /></button>
      </div>
      <div className={s.sheetBody}>
        <div className={s.group}><div className={s.groupTitle}>Whole planet</div>{globalItems.map((it) => <Row key={it.title} it={it} />)}</div>
        <div className={s.group}><div className={s.groupTitle}>Jezero Crater</div>{jezeroItems.map((it) => <Row key={it.title} it={it} />)}</div>
        <div className={s.group}>
          <div className={s.groupTitle}>Validation</div>
          <div className={s.list}><span>The Jezero terrain agrees with <b>708</b> Perseverance waypoints, median offset <b>1.1 m</b>, mean bias <b>-0.9 m</b> (data/validation.json).</span></div>
        </div>
        <div className={s.group}>
          <div className={s.groupTitle}>Assumptions</div>
          <div className={s.list}>
            <span>Suit power <b>{c.suitPowerW} W</b>, battery <b>{c.batteryWh} Wh</b>, crew with suit and kit <b>{c.crewMassKg} kg</b>, suit speed <b>{c.suitSpeedFactor}</b> of Tobler walking speed.</span>
            <span>Rover cruise speed <b>{ROVER_SPEED_KMH} km/h</b>. Suit stays powered while riding.</span>
            <span>Habitat mast <b>{STATION_MAST_HEIGHT_M} m</b>, suit antenna <b>{SUIT_ANTENNA_HEIGHT_M} m</b>. Minimum sun elevation <b>{MIN_SUN_ELEVATION_DEG} deg</b>.</span>
            <span>Caution bands: slope at <b>{SLOPE_CAUTION_FRACTION * 100}%</b> of the limit, battery within <b>{BATTERY_CAUTION_MARGIN_PCT} points</b> of reserve, EVA over <b>{EVA_CAUTION_FRACTION * 100}%</b> of its limit, radio shadow over <b>{COMMS_NOGO_SHADOW_M} m</b> is no-go.</span>
            <span>The landing slope limit is set by the user, not by NASA. Landing criteria are a reference from published landing-site constraints.</span>
            <span>The EDL approach track on the globe is schematic.</span>
          </div>
        </div>
        <div className={s.group}>
          <div className={s.groupTitle}>AI</div>
          <div className={s.list}>
            <span>Scout art: AI-generated SVG, see public/art/CREDITS.json{art ? ` (${art} files)` : ''}.</span>
            <span>Copilot answers: LLM via OpenRouter, numbers from tools.</span>
          </div>
        </div>
        <div className={s.list}><span>Made by Ng Yu Hang, team Ecliptical. NASA Space Apps Challenge 2026, Singapore. Challenge: Interplanetary Survival Guide: Martian Map. Not affiliated with or endorsed by NASA.</span></div>
      </div>
    </div>
  );
}
