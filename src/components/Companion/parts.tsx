'use client';
/** Small pieces shared by the map card and the panel: the MarsAgent mark, formula blocks, answer text, status dots, icons. */
import {
  AlertCircle, Check, ClipboardList, Crosshair, Footprints, Globe, ListOrdered, Loader, MapPin, Navigation, PlaneLanding, Play, RadioTower, RotateCcw, Route,
  ScanEye, SlidersHorizontal, Sun, Truck, type LucideIcon,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import type { DotTone, ScienceNote } from '@/state/thread';
import type { LineState } from './reveal';
import { richTokens } from './text';
import s from './agent.module.css';

const ICONS: Record<string, LucideIcon> = {
  'plane-landing': PlaneLanding, play: Play, navigation: Navigation, route: Route, footprints: Footprints, 'scan-eye': ScanEye,
  'radio-tower': RadioTower, truck: Truck, 'clipboard-list': ClipboardList, sun: Sun, 'sliders-horizontal': SlidersHorizontal, globe: Globe,
  crosshair: Crosshair, 'rotate-ccw': RotateCcw, 'list-ordered': ListOrdered,
};
export function ActionIcon({ name, size = 13 }: { name: string; size?: number }) {
  const I = ICONS[name] ?? MapPin;
  return <I size={size} strokeWidth={1.5} aria-hidden />;
}

/** The MarsAgent mark: the same survey reticle that follows the cursor, at 16 px. */
export function Mark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden focusable="false">
      <circle r="7" fill="none" stroke="#ece7e1" strokeWidth="1.3" />
      <g stroke="#ece7e1" strokeWidth="1.3"><line x1="0" y1="-9" x2="0" y2="-11" /><line x1="0" y1="9" x2="0" y2="11" /><line x1="-9" y1="0" x2="-11" y2="0" /><line x1="9" y1="0" x2="11" y2="0" /></g>
      <circle r="2" fill="#5cc8ff" />
    </svg>
  );
}

export function LineIcon({ state }: { state: LineState }) {
  if (state === 'now') return <Loader size={12} strokeWidth={1.75} aria-label="working" />;
  if (state === 'error') return <AlertCircle size={12} strokeWidth={1.75} aria-label="stopped" />;
  return <Check size={12} strokeWidth={1.75} aria-label="done" />;
}

const TONE_WORD: Record<DotTone, string> = { go: 'within limit', caution: 'caution', nogo: 'fails a limit', info: 'computed from data', none: 'no status' };
/** A status dot carries a verdict (pass, caution, fail); plain information rows get none. */
export const hasStatus = (tone: DotTone | undefined): tone is 'go' | 'caution' | 'nogo' => tone === 'go' || tone === 'caution' || tone === 'nogo';
export function Dot({ tone }: { tone?: DotTone }) {
  if (!hasStatus(tone)) return null;
  return <span className={s.dot} data-tone={tone} role="img" aria-label={TONE_WORD[tone]} title={TONE_WORD[tone]} />;
}

/** One formula line with the substituted numbers bright, comments dim and pass / fail coloured. */
const TOKEN = /(\/\/.*$)|\b(still pass|now pass|pass)\b|\b(fail)\b|\b(caution)\b|((?<![A-Za-z\d.])-?\d(?:[\d,]*\d)?(?:\.\d+)?(?:\s?(?:km\/h|m\/s²|m\/s|km²|km|kJ|Wh|W|min|ms|s\/au|au|h|m|s|%|°|kg|tiu|deg)(?![A-Za-z]))?)/g;
function CodeLine({ line }: { line: string }) {
  const out: React.ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    if (m[1]) out.push(<span key={k++} className={s.c}>{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className={s.ok}>{m[2]}</span>);
    else if (m[3]) out.push(<span key={k++} className={s.bad}>{m[3]}</span>);
    else if (m[4]) out.push(<span key={k++} className={s.warn}>{m[4]}</span>);
    else out.push(<em key={k++}>{m[5]}</em>);
    last = i + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return <>{out}</>;
}
export function Code({ lines, label }: { lines: string[]; label?: string }) {
  return (
    <pre className={s.code} aria-label={label}>
      {lines.map((l, i) => <Fragment key={i}>{i ? '\n' : ''}<CodeLine line={l} /></Fragment>)}
    </pre>
  );
}

/** Answer text with numbers in mono and any number the guard could not find in a tool result underlined. */
export function Rich({ text, unverified = [] }: { text: string; unverified?: string[] }) {
  const flagged = new Set(unverified.filter(Boolean));
  return (
    <>
      {richTokens(text).map((p, i) => (p.num
        ? <span key={i} className={`${s.num} ${flagged.has(p.text.replace(/\s?[a-z%°²/]+$/i, '')) || flagged.has(p.text) ? s.unverified : ''}`} title={flagged.has(p.text) ? 'not found in any tool result' : undefined}>{p.text}</span>
        : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(Math.round(m / 10) / 100).toLocaleString('en-US')} km`);
const camShort = (c: string) => c.replace(/^Navigation Camera/, 'Navcam').replace(/^Front Hazard Camera/, 'Front Hazcam').replace(/^Rear Hazard Camera/, 'Rear Hazcam').replace(/ (Left|Right)/, (_, x: string) => ` ${x.toLowerCase()}`);

/** One Perseverance frame; when it cannot load (offline), the caption still names it and links to NASA's page. */
function Photo({ p }: { p: NonNullable<ScienceNote['ground']>['photos'][number] }) {
  const [bad, setBad] = useState(false);
  const alt = `Perseverance ${camShort(p.cameraFull)} view, sol ${p.sol}`;
  if (bad) return <a className={s.photoOff} href={p.pageUrl ?? p.url} target="_blank" rel="noopener noreferrer">Photo did not load. Open it on mars.nasa.gov</a>;
  return (
    <a className={s.photo} href={p.pageUrl ?? p.url} target="_blank" rel="noopener noreferrer" title={`${alt}, ${p.earthDate}, ${p.credit}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote NASA raw image, shown as is */}
      <img src={p.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    </a>
  );
}

/** "Science at target" (geologic unit, nearest catalogued site) and "View from the ground" (nearest Perseverance frames). */
export function ScienceBlock({ sci, compact = false }: { sci: ScienceNote; compact?: boolean }) {
  const g = sci.ground;
  const first = g?.photos[0];
  return (
    <div className={s.sci} data-compact={compact}>
      <div className={s.sciRow}><span>Science at target</span><b>{sci.unit ? `${sci.unit.name} (${sci.unit.symbol})` : 'Unit not resolved at 20 m'}</b></div>
      {sci.site && <div className={s.sciRow}><span>Nearest catalogued site</span><b>{sci.site.name}, <span className={s.num}>{km(sci.site.distanceKm * 1000)}</span></b></div>}
      {g && first ? (
        <figure className={s.ground}>
          <div className={s.photos}>{g.photos.slice(0, 2).map((p) => <Photo key={p.id} p={p} />)}</div>
          <figcaption>
            <b>View from the ground</b> Sol <span className={s.num}>{g.sol}</span>, {camShort(first.cameraFull)}, {first.credit}.{' '}
            {g.distanceM <= 150 ? 'Taken at the target.' : <>Taken <span className={s.num}>{km(g.distanceM)}</span> from the target.</>}
          </figcaption>
        </figure>
      ) : <div className={s.sciRow}><span>View from the ground</span><b>Nearest frame loading from the traverse cache</b></div>}
    </div>
  );
}

export const ORIGIN_TEXT = (origin: string, at: { lat: number; lon: number } | null | undefined, ll: (p: { lat: number; lon: number }) => string) =>
  origin === 'map' ? (at ? `Asked on the map at ${ll(at)}` : 'Asked on the map')
    : origin === 'panel' ? 'Asked in the panel'
      : origin === 'drag' ? (at ? `Dragged on the map to ${ll(at)}` : 'Dragged on the map')
        : origin === 'lasso' ? 'Lassoed on the map' : 'From the tool rail';
