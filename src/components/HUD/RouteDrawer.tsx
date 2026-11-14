'use client';
import { Calculator, Camera, Check, CircleAlert, Download, ExternalLink, Mountain, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { InfeasibleReason, RoverImage, RouteResult } from '@/lib/contracts';
import { fmtDeg, fmtKm, fmtMin } from '@/lib/scene/format';
import { exportPlan, roverImagesFor, showSteepestStretch } from '@/state/services';
import { useWorld } from '@/state/world';
import { ElevationProfile } from './ElevationProfile';
import { ProvBadge } from './ui';
import s from './hud.module.css';

const REASON: Record<InfeasibleReason, string> = {
  no_path_slope: 'No path exists that stays under your maximum slope limit.',
  battery_reserve: 'The battery would fall below your reserve before you could get back.',
  eva_time: 'The total time outside exceeds your EVA limit.',
  nodata_endpoint: 'The start or end point has no terrain data (a gap in the DEM).',
  out_of_bounds: 'A point is outside the terrain tile that is loaded.',
};

const num = (n: number, d = 0) => n.toFixed(d);

function Totals({ r }: { r: RouteResult }) {
  const t = r.totals;
  return (
    <dl className={s.totals}>
      <dt>Length</dt><dd>{fmtKm(t.lengthM)}</dd>
      <dt>Ascent</dt><dd>{num(t.ascentM)} m</dd>
      <dt>Max slope</dt><dd>{fmtDeg(t.maxSlopeDeg)}</dd>
      <dt>Walking time</dt><dd>{fmtMin(t.walkMin)}</dd>
      <dt>EVA time (with dwell)</dt><dd>{fmtMin(t.evaMin)}</dd>
      <dt>Battery used</dt><dd>{num(t.batteryUsedPct, 1)}%</dd>
      <dt>Climb work</dt><dd>{num(t.climbWorkKJ)} kJ</dd>
    </dl>
  );
}

function Legs({ r }: { r: RouteResult }) {
  const name = (i: number) => (r.legs.length === 1 ? 'One way' : i === 0 ? 'Outbound' : i === r.legs.length - 1 && r.roundTrip ? 'Return' : `Leg ${i + 1}`);
  return (
    <table className={s.table}>
      <thead><tr><th scope="col">Leg</th><th scope="col">Length</th><th scope="col">Ascent</th><th scope="col">Max slope</th><th scope="col">Time</th></tr></thead>
      <tbody>
        {r.legs.map((l, i) => (
          <tr key={i}><td>{name(i)}</td><td>{fmtKm(l.lengthM)}</td><td>{num(l.ascentM)} m</td><td>{fmtDeg(l.maxSlopeDeg)}</td><td>{fmtMin(l.timeMin)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function Comparison({ a, b }: { a: RouteResult; b: RouteResult }) {
  const rows: [string, (r: RouteResult) => string][] = [
    ['Feasible', (r) => (r.feasible ? 'yes' : 'no')],
    ['Length', (r) => fmtKm(r.totals.lengthM)],
    ['Ascent', (r) => `${num(r.totals.ascentM)} m`],
    ['Max slope', (r) => fmtDeg(r.totals.maxSlopeDeg)],
    ['Walking time', (r) => fmtMin(r.totals.walkMin)],
    ['EVA time', (r) => fmtMin(r.totals.evaMin)],
    ['Battery used', (r) => `${num(r.totals.batteryUsedPct, 1)}%`],
    ['Slope limit used', (r) => `${r.constraintsUsed.maxSlopeDeg}°`],
  ];
  return (
    <div>
      <h3 className={s.h3}>Comparison</h3>
      <table className={s.table}>
        <thead><tr><th scope="col">Metric</th><th scope="col">{a.id}</th><th scope="col">{b.id}</th></tr></thead>
        <tbody>{rows.map(([k, f]) => <tr key={k}><td>{k}</td><td>{f(a)}</td><td>{f(b)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Inspector({ r }: { r: RouteResult }) {
  const c = r.constraintsUsed;
  const consts: [string, string, boolean][] = [
    ['Suit power P', `${c.suitPowerW} W`, true], ['Battery capacity C', `${c.batteryWh} Wh`, true],
    ['Crew + suit + kit mass m', `${c.crewMassKg} kg`, true], ['Suit speed factor', `${c.suitSpeedFactor} × Tobler`, true],
    ['EVA limit', `${c.evaMaxMin} min`, true], ['Dwell', `${c.dwellMin} min`, true],
    ['Mars gravity g', '3.721 m/s²', false],
  ];
  return (
    <details className={s.inspector}>
      <summary><Calculator size={15} aria-hidden /> How was this calculated?</summary>
      <div className={s.sectionBody} style={{ padding: '10px 0 0' }}>
        <ul>
          <li>Path: A* search on a {r.gridResM} m planning grid built from the {r.demResM} m CTX DEM.</li>
          <li>An edge is allowed only if its grade ≤ the slope limit and the cell&apos;s steepest 20 m sub-cell is ≤ the slope limit.</li>
        </ul>
        <pre className={s.eq}>{`speed = suit factor × 6·exp(−3.5·|tanθ + 0.05|) km/h   (Tobler)
time  = Σ segment length / speed
battery used % = 100 · P · t / C
climb work = m · g · total ascent`}</pre>
        <div className={s.consts}>
          {consts.map(([k, v, a]) => (
            <span key={k} style={{ display: 'contents' }}>
              <span>{k}</span><span className={s.mono}>{v}</span>
              {a ? <ProvBadge kind="assumption" /> : <ProvBadge kind="observed" />}
            </span>
          ))}
        </div>
        <ul>
          <li>Limits: the DEM cannot show boulders or ledges smaller than its {r.demResM} m posting.</li>
          <li>This is not a NASA EVA model. Power, battery, mass and speed are assumptions, so treat results as planning estimates.</li>
          <li>Solved in {Math.round(r.computeMs)} ms in your browser.</li>
        </ul>
      </div>
    </details>
  );
}

function RoverPhotos({ route }: { route: RouteResult }) {
  const [imgs, setImgs] = useState<RoverImage[]>([]);
  useEffect(() => {
    let dead = false;
    setImgs([]);
    void roverImagesFor(route.to).then((r) => { if (!dead) setImgs(r); });
    return () => { dead = true; };
  }, [route.id, route.to]);
  if (!imgs.length) return null;
  return (
    <div>
      <h3 className={s.h3}><Camera size={13} aria-hidden style={{ verticalAlign: '-2px' }} /> Rover photos near the destination</h3>
      <div className={s.photos}>
        {imgs.map((i) => (
          <a key={i.id} className={s.photo} href={i.pageUrl ?? i.url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.url} alt={`Perseverance ${i.cameraFull || i.camera} image from sol ${i.sol}`} loading="lazy" />
            Sol {i.sol}, {i.camera}, {i.credit} <ExternalLink size={10} aria-hidden />
          </a>
        ))}
      </div>
    </div>
  );
}

export function RouteDrawer() {
  const open = useWorld((st) => st.drawerOpen);
  const routes = useWorld((st) => st.routes);
  const visible = useWorld((st) => st.visibleRouteIds);
  const profileId = useWorld((st) => st.profileRouteId);
  const comparison = useWorld((st) => st.comparison);
  const id = profileId ?? visible[visible.length - 1];
  const r = id ? routes[id] : undefined;
  if (!open || !r) return null;
  const cmp = comparison && routes[comparison[0]] && routes[comparison[1]] ? [routes[comparison[0]], routes[comparison[1]]] : null;
  return <DrawerContent route={r} cmp={cmp} onClose={() => useWorld.getState().patch({ drawerOpen: false })} />;
}

export function DrawerContent({ route: r, cmp, onClose }: { route: RouteResult; cmp: RouteResult[] | null; onClose?: () => void }) {
  const reasons = r.reasons.map((x) => REASON[x]);
  return (
    <aside className={`${s.panel} ${onClose ? s.drawer : ''}`} aria-label="Route details">
      <div className={s.drawerHead}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{r.label}</h2>
          <span className={`${s.mono} ${s.muted}`}>{r.id}, {r.roundTrip ? 'round trip' : 'one way'}{r.stops?.length ? `, ${r.stops.length} stop${r.stops.length > 1 ? 's' : ''}` : ''}</span>
        </div>
        <ProvBadge kind="computed" />
        {onClose && <button className={`${s.btn} ${s.iconBtn}`} aria-label="Close route details" onClick={onClose}><X size={16} aria-hidden /></button>}
      </div>
      <div className={s.drawerBody}>
        <div className={s.verdict} data-ok={r.feasible}>
          {r.feasible ? <Check size={18} aria-hidden /> : <CircleAlert size={18} aria-hidden />}
          <div>
            <strong>{r.feasible ? 'Feasible under your limits' : 'Not feasible under your limits'}</strong>
            {r.feasible
              ? <span className={s.muted}>Within the assumed suit model. Not a certified plan.</span>
              : <>{reasons.map((x) => <span key={x} style={{ display: 'block' }}>{x}</span>)}
                {r.minFeasibleSlopeDeg != null && <span style={{ display: 'block' }}>A path exists if the slope limit is raised to {r.minFeasibleSlopeDeg}°.</span>}
                {r.turnBackIndex && <span style={{ display: 'block' }}>The grey part of the line is beyond the point where the reserve is reached.</span>}</>}
          </div>
        </div>
        <Totals r={r} />
        <div><h3 className={s.h3}>Legs</h3><Legs r={r} /></div>
        <div><h3 className={s.h3}>Elevation and slope</h3><ElevationProfile route={r} /></div>
        {cmp && <Comparison a={cmp[0]} b={cmp[1]} />}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={s.btn} onClick={() => void showSteepestStretch()}><Mountain size={15} aria-hidden /> Steepest stretch</button>
          <button className={s.btn} onClick={() => void exportPlan(r.id)}><Download size={15} aria-hidden /> Export plan (GeoJSON)</button>
        </div>
        <Inspector r={r} />
        <RoverPhotos route={r} />
      </div>
    </aside>
  );
}
