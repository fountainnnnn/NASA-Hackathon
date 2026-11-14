'use client';
import { X } from 'lucide-react';
import { MIN_SUN_ELEVATION_DEG, SUIT_ANTENNA_HEIGHT_M, SLOPE_CAUTION_FRACTION, BATTERY_CAUTION_MARGIN_PCT, EVA_CAUTION_FRACTION, COMMS_NOGO_SHADOW_M } from '@/lib/ops/assumptions';
import { DEFAULT_CONSTRAINTS } from '@/lib/contracts';
import { ROVER_SPEED_KMH } from '@/components/Scenario/model';
import { useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import { lightTimeMin } from '@/lib/ops/earthLink';
import { useGlobal, useRuntime } from '@/state/services';
import s from './hud.module.css';

interface Item { title: string; credit?: string; url?: string; note?: string; flag?: string }

/** A human title for a Mars Trek product label ("JEZ_ctx_B_soc_008_DTM..." -> "Jezero CTX terrain model, 20 m (MRO)"); the label stays in the detail line. */
export function demTitle(label: string, resM: number): string {
  const site = /^JEZ_/i.test(label) ? 'Jezero ' : '';
  const inst = /ctx/i.test(label) ? 'CTX ' : /hirise/i.test(label) ? 'HiRISE ' : '';
  const what = /DTM|DEM/i.test(label) ? 'terrain model' : 'mosaic';
  return `${site}${inst}${what}, ${resM} m (MRO)`;
}

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
  const stored = useGlobeStore((g) => g.manifest);
  const gs = useGlobal((g) => g.gs);
  const manifest = stored ?? gs?.manifest() ?? null;
  const layers = useRuntime((r) => r.rt?.layers);
  const meta = useRuntime((r) => r.rt?.meta);
  const earthData = useGlobal((g) => g.earth);
  const mast = useHud((h) => h.mastHeightM);
  if (!open) return null;

  const globalItems: Item[] = manifest ? [
    { title: manifest.texture.title, credit: manifest.texture.credit, url: manifest.texture.sourceUrl },
    { title: manifest.dem.title.split(' (')[0], credit: manifest.dem.credit, url: manifest.dem.sourceUrl },
    ...manifest.layers.map((l) => ({ title: l.title, credit: l.credit, url: l.sourceUrl, flag: l.simulated ? 'Simulated, not NASA data.' : undefined })),
    ...(manifest.geology && !manifest.layers.some((l) => l.id === 'geology') ? [{ title: manifest.geology.title, credit: `${manifest.geology.authors} (${manifest.geology.year}), scale ${manifest.geology.scale}`, url: manifest.geology.url }] : []),
  ] : [{ title: 'Global dataset not loaded', flag: 'No verified data is shown for the whole planet.' }];
  const jezeroItems: Item[] = [
    ...(meta ? [{ title: demTitle(meta.productLabel, meta.nominalResM), credit: `${meta.datum}. ${meta.nominalResM} m posting.`, note: `File: ${meta.productLabel}`, url: meta.sourceUrl }] : []),
    ...(layers ?? []).map((l) => ({ title: l.title, credit: `${l.mission}, ${l.instrument}. ${l.credit}`, url: l.sourceUrl, note: l.note, flag: l.simulated ? 'Simulated, not NASA data.' : undefined })),
    // the close-range ground around the base (data/source_manifest.json, public/data/hirise/jezero_base.jpg)
    { title: 'MRO HiRISE, Jezero Mosaic, Controlled', credit: 'NASA/JPL-Caltech/UArizona/USGS via JPL Mars Trek', note: 'About 1.3 m per pixel near base.', url: 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml' },
    { title: 'Perseverance raw images', credit: 'NASA/JPL-Caltech', url: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/' },
    { title: 'NASA Mars Fact Sheet, gravity 3.721 m/s2', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html' },
    ...(earthData ? [{ title: earthData.source.title, url: earthData.source.url, credit: 'NASA JPL Horizons', note: `Earth is ${(lightTimeMin(Date.now(), earthData) ?? NaN).toFixed(1)} light-minutes away right now (one way).` }] : []),
    { title: 'Mars24 sun position (Allison and McEwen 2000)', credit: 'NASA GISS', url: 'https://www.giss.nasa.gov/tools/mars24/' },
  ];
  const c = DEFAULT_CONSTRAINTS;
  return (
    <div className={s.sheet} role="dialog" aria-modal="false" aria-labelledby="src-title" data-modal>
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
            <span>Habitat comms mast <b>{mast} m</b> (default 10 m, change it under Mission limits), suit antenna <b>{SUIT_ANTENNA_HEIGHT_M} m</b>. Minimum sun elevation <b>{MIN_SUN_ELEVATION_DEG}°</b>.</span>
            <span>Caution bands: slope at <b>{SLOPE_CAUTION_FRACTION * 100}%</b> of the limit, battery within <b>{BATTERY_CAUTION_MARGIN_PCT} points</b> of reserve, EVA over <b>{EVA_CAUTION_FRACTION * 100}%</b> of its limit, radio shadow over <b>{COMMS_NOGO_SHADOW_M} m</b> is no-go.</span>
            <span>The landing slope limit is set by the user, not by NASA. Landing criteria are a reference from published landing-site constraints.</span>
            <span>The EDL approach track on the globe is schematic.</span>
          </div>
        </div>
        <div className={s.group}>
          <div className={s.groupTitle}>AI</div>
          <div className={s.list}>
            <span>MarsAgent reticle and map symbols: drawn in code, no AI art is shown.</span>
            <span>MarsAgent answers to free questions: LLM via OpenRouter, every number from a tool. Map actions, checks and maths follow-ups run fixed code with no model.</span>
            <span>Narrate aloud uses the synthetic voice built into your browser.</span>
          </div>
        </div>
        <div className={s.list}><span>Made by Ng Yu Hang, team Ecliptical. NASA Space Apps Challenge 2026, Singapore. Challenge: Interplanetary Survival Guide: Martian Map. Not affiliated with or endorsed by NASA.</span></div>
      </div>
    </div>
  );
}
