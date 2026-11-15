'use client';
/** DOM overlays that belong to the Ops layer: drag and lasso readouts, helmet display, legend, cuff card, base mark. */
import { useEffect, useMemo, useRef } from 'react';
import { HelmetHud } from '@/components/Scenario/HelmetHud';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { Download, ExternalLink, X } from 'lucide-react';
import s from '@/components/HUD/hud.module.css';
import sh from '@/components/HUD/shell.module.css';
import { useHud } from '@/state/hud';
import { usePlayback, useThrottledT } from '@/state/playback';
import { useGlobal } from '@/state/services';
import { edlEndS } from '@/components/Scenario/landing';
import { REVEAL_DELAY_S } from '@/components/Planet/descent';
import { LANDING_LEGEND_TOP_PX, jezeroLegendRows, landingLegendRows } from './legendRows';
import { useGlobeStore } from '@/state/globe';
import { useWorld } from '@/state/world';
import { drawScaleNote, useDrawScale } from '@/lib/scenario/drawScale';
import { YIELDING_LABELS, blockedByHud } from '@/components/HUD/blocks';
import { projectJezero } from './projector';
import { downloadCuff, openCuff } from './cuffExport';
import { getOps } from '@/app/opsCache';
import { sunElevationAt } from './routeOps';
import { useWalkTimeline } from './useWalk';

/** Map labels and HUD blocks a pointer readout must not cover: the Base tag, scene pins, route ticks, crew tags, the legend, the card. */
const POINTER_LABEL_AVOID = '[data-avoid], [data-flip-label], [data-companion], [data-gl-label], [class*="tick"], [class*="tag__"]';

/**
 * A readout that sits beside the pointer, never leaves the map and never covers another map label: it tries the four
 * corners around the pointer, then the same corners further out, and takes the first spot that is clear (or the one
 * with the least overlap when none is).
 */
function PointerLabel({ at, children }: { at: { x: number; y: number }; children: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const n = el.current; if (!n) return;
    const w = n.offsetWidth, h = n.offsetHeight;
    // stay on the map: never over the rail, the panel or the bars
    const st = document.querySelector('[data-stage]')?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const obstacles = [...document.querySelectorAll<HTMLElement>(POINTER_LABEL_AVOID)]
      .filter((o) => o !== n && !n.contains(o) && !o.contains(n) && o.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false)
      .map((o) => o.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const clampX = (x: number) => Math.min(st.right - 4 - w, Math.max(st.left + 4, x));
    const clampY = (y: number) => Math.min(st.bottom - 4 - h, Math.max(st.top + 4, y));
    const PAD = 3;
    const cost = (x: number, y: number) => obstacles.reduce((q, r) => {
      const ox = Math.min(x + w, r.right + PAD) - Math.max(x, r.left - PAD), oy = Math.min(y + h, r.bottom + PAD) - Math.max(y, r.top - PAD);
      return ox > 0 && oy > 0 ? q + ox * oy : q;
    }, 0);
    let best = { x: clampX(at.x + 14), y: clampY(at.y + 16), c: Infinity };
    // right-below first (the usual place), then right-above, left-below, left-above; then 2x and 3x further out
    for (const k of [1, 2.4, 4]) {
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = clampX(sx > 0 ? at.x + 14 * k : at.x - 14 * k - w), y = clampY(sy > 0 ? at.y + 16 * k : at.y - 16 * k - h);
        // a clamped spot can land back on the pointer: the readout must stay beside it, not under it
        if (at.x > x - 6 && at.x < x + w + 6 && at.y > y - 6 && at.y < y + h + 6) continue;
        const c = cost(x, y);
        if (c < best.c) best = { x, y, c };
        if (c === 0) break;
      }
      if (best.c === 0) break;
    }
    n.style.left = `${best.x}px`;
    n.style.top = `${best.y}px`;
  });
  return <div ref={el} className={s.dragLabel} data-avoid data-over-map>{children}</div>;
}

export function DragLabel() {
  const pv = useHud((h) => h.preview);
  if (!pv) return null;
  return <PointerLabel at={pv.at}>{pv.label}</PointerLabel>;
}

export function LassoOverlay() {
  const pts = useHud((h) => h.lasso);
  const label = useHud((h) => h.lassoLabel);
  if (!pts || pts.length < 2) return null;
  const last = pts[pts.length - 1];
  return (
    <>
      <svg className={s.lassoSvg} aria-hidden>
        <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(236,231,225,0.05)" stroke="#ece7e1" strokeWidth={1.5} strokeDasharray="6 4" />
      </svg>
      {label && <PointerLabel at={last}>{label}</PointerLabel>}
    </>
  );
}

/** The helmet display while a walk plays in helmet view: heading tape, three numbers, mini map, and the way out. */
export function HelmetLayer() {
  const walkOn = useHud((h) => h.walkOn);
  const mode = useGlobeStore((g) => g.mode);
  const tl = useWalkTimeline();
  const start = useHud((h) => h.startUtcMs);
  const route = useWorld((w) => (tl ? w.routes[tl.routeId] : undefined));
  const helmet = useWalkUi((w) => w.helmet);
  const t = useThrottledT(4);
  const site = route?.from;
  const sun = useMemo(() => (site ? (tS: number) => sunElevationAt(site, start, tS) : undefined), [site, start]);
  useEffect(() => {
    if (!helmet) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') useWalkUi.getState().setHelmet(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [helmet]);
  if (mode !== 'jezero' || !walkOn || !tl || !sun || !helmet) return null;
  const ops = getOps(tl.routeId);
  let comms: boolean | null = null;
  if (ops?.comms) {
    const n = ops.comms.visible.length;
    const idx = Math.min(n - 1, Math.max(0, Math.round((t / Math.max(1, tl.durationS)) * (n - 1))));
    comms = ops.comms.visible[idx] ?? null;
  }
  return (
    <>
      <div className={sh.helmetWrap}><HelmetHud timeline={tl} sunElevationDeg={sun} commsVisible={comms} /></div>
      <button type="button" className={sh.exitHelmet} onClick={() => useWalkUi.getState().setHelmet(false)}><X size={14} strokeWidth={1.5} aria-hidden />Exit helmet view</button>
    </>
  );
}

/**
 * Small legend: what the marks on the ground mean and where the terrain and imagery come from, with only the rows that apply
 * now. During a landing it sits top left under the phase caption: the bottom of the view belongs to the descending vehicle and
 * the data credit.
 */
export function Legend() {
  const mode = useGlobeStore((g) => g.mode);
  const landing = useHud((h) => h.landing);
  const routeId = useHud((h) => h.activeRouteId);
  const scenario = useHud((h) => h.walkOn || h.reachOn);
  const popover = useHud((h) => h.popover);
  const sheet = useHud((h) => h.sheet);
  const helmet = useWalkUi((w) => w.helmet);
  const close = useWalkUi((w) => w.closeRange);
  const hirise = useWalkUi((w) => w.hirise);
  const traverse = useWorld((w) => w.layers.traverse);
  const route = useWorld((w) => (routeId && w.visibleRouteIds.includes(routeId) ? w.routes[routeId] ?? null : null));
  const highlights = useWorld((w) => w.annotations.filter((a) => a.kind === 'highlight' && a.highlight?.routeId === routeId).length);
  const gs = useGlobal((g) => g.gs);
  const edlEnd = useMemo(() => edlEndS(gs?.edlPhases() ?? []), [gs]);
  const t = useThrottledT(2);
  const kind = usePlayback((p) => p.kind);
  // honest note when scenario objects are drawn larger than life (lib/scenario/drawScale)
  const scaleNote = useDrawScale((d) => drawScaleNote(d, mode));
  if (popover || sheet || helmet) return null;
  if (mode === 'globe') {
    if (!landing) return null;
    const rows = landingLegendRows(kind === 'landing' ? t : edlEnd + REVEAL_DELAY_S, edlEnd);
    // same colours as the dots on the ground
    return (
      <div className={`${sh.legend} ${sh.legendTop}`} style={{ top: LANDING_LEGEND_TOP_PX }} data-avoid aria-label="Legend">
        {rows.dots && <div className={sh.row}><span className={sh.dotSw} style={{ background: '#58c98a' }} />Touchdown under {landing.maxSlopeDeg}°</div>}
        {rows.dots && <div className={sh.row}><span className={sh.dotSw} style={{ background: '#d9423b' }} />Touchdown over the limit</div>}
        <div className={sh.src}>Terrain: Mars Trek, EDL: Mars 2020</div>
        <div className={sh.src}>Imagery: CTX 5 m on Viking 232 m per pixel</div>
        <div className={sh.src}>Relief drawn 2.5 times true height</div>
        {scaleNote && <div className={sh.src}>{scaleNote}</div>}
      </div>
    );
  }
  const rows = jezeroLegendRows({ route, highlights, traverse, scenario, hirise, close });
  return (
    <div className={sh.legend} data-avoid aria-label="Legend">
      {rows.route && <div className={sh.row}><span className={sh.sw} style={{ borderColor: '#e0884a' }} />Planned route, ticks every 100 m</div>}
      {rows.fails && <div className={sh.row}><span className={sh.sw} style={{ borderColor: '#d9423b', borderTopStyle: 'dashed' }} />Fails a limit</div>}
      {rows.traverse && <div className={sh.row}><span className={sh.sw} style={{ borderColor: 'rgba(236,231,225,0.45)' }} />Perseverance traverse</div>}
      <div className={sh.src}>MRO CTX DEM 20 m, JPL Mars Trek</div>
      {rows.imagery && <div className={sh.src}>{rows.imagery}</div>}
      {scaleNote && <div className={sh.src}>{scaleNote}</div>}
    </div>
  );
}

export function CuffSheet() {
  const sheet = useHud((h) => h.sheet);
  const cuff = useHud((h) => h.cuff);
  if (sheet !== 'cuff' || !cuff) return null;
  return (
    <section className={sh.cuff} aria-label="Cuff card" data-avoid data-over-map>
      <div className={sh.cuffHead}><h3>Cuff card, {cuff.routeId}</h3><button type="button" className={sh.btn} style={{ height: 24, padding: '0 6px' }} aria-label="Close cuff card" onClick={() => useHud.getState().setSheet(null)}><X size={13} strokeWidth={1.5} aria-hidden /></button></div>
      {/* the checklist at wrist width: 11 px mono, black on white, scrolling inside the sheet (the SVG is the print file) */}
      <pre className={sh.cuffText} tabIndex={0} aria-label="Cuff checklist">{cuff.text}</pre>
      <div className={sh.cuffBar}>
        <button type="button" className={sh.btn} onClick={() => downloadCuff(cuff)}><Download size={13} strokeWidth={1.5} aria-hidden />Download</button>
        <button type="button" className={sh.btn} onClick={() => openCuff(cuff)}><ExternalLink size={13} strokeWidth={1.5} aria-hidden />Open in a tab</button>
      </div>
    </section>
  );
}

/** The base habitat on screen: a square ring and a label that follow it over the Jezero scene (always shown, never occluded). */
export function BaseMark() {
  const base = useWorld((w) => w.base);
  // with reach on, the habitat model marks the base itself: the ring would sit on top of it, so only the label stays
  const reachOn = useHud((h) => h.reachOn);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!base) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const n = el.current; if (!n) return;
      const p = projectJezero({ lon: base.lon, lat: base.lat });
      const st = document.querySelector('[data-stage]')?.getBoundingClientRect();
      const ok = !!st && p.visible && p.x > st.left + 12 && p.x < st.right - 70 && p.y > st.top + 14 && p.y < st.bottom - 20;
      n.style.visibility = ok ? 'visible' : 'hidden';
      if (ok) {
        n.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
        // under a HUD block or the bubble: say nothing rather than print over it. Map labels that give way (route ticks,
        // scene pins, the drag readout) move or hide for the Base tag instead, so they never hide it.
        const parts = [...n.querySelectorAll('span')].map((c) => c.getBoundingClientRect());
        if (parts.some((r) => blockedByHud(r, n, YIELDING_LABELS))) n.style.visibility = 'hidden';
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [base]);
  if (!base) return null;
  return (
    <div ref={el} className={s.baseMark} style={{ visibility: 'hidden' }} aria-hidden>
      {!reachOn && <span className={s.baseRing} data-avoid />}
      <span className={s.baseLabel} data-avoid>Base</span>
    </div>
  );
}
