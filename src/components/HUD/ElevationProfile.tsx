'use client';
import { useMemo, useState } from 'react';
import type { RouteResult } from '@/lib/contracts';
import { fmtKm, groundM } from '@/lib/scene/format';
import s from './hud.module.css';

const W = 360, H1 = 130, H2 = 64, PAD = { l: 34, r: 8, t: 8, b: 16 };

interface Pt { d: number; h: number; slope: number; leg: number }

function samples(r: RouteResult): { pts: Pt[]; legStarts: number[] } {
  const pts: Pt[] = [];
  const legStarts: number[] = [];
  let d = 0;
  r.legs.forEach((leg, li) => {
    legStarts.push(d);
    leg.path.forEach((p, i) => {
      if (i > 0) d += groundM(leg.path[i - 1], p);
      pts.push({ d, h: p.h, slope: i === 0 ? (leg.segSlopeDeg[0] ?? 0) : (leg.segSlopeDeg[i - 1] ?? 0), leg: li });
    });
  });
  return { pts, legStarts };
}

const colorFor = (slope: number, limit: number) => (slope > limit ? '#ff7a6e' : slope > 0.8 * limit ? '#ffb347' : '#5cc8ff');

export function ElevationProfile({ route }: { route: RouteResult }) {
  const limit = route.constraintsUsed.maxSlopeDeg;
  const { pts, legStarts } = useMemo(() => samples(route), [route]);
  const [hover, setHover] = useState<number | null>(null);
  if (pts.length < 2) return <p className={s.note}>No path to profile.</p>;

  const total = pts[pts.length - 1].d || 1;
  let hMin = Infinity, hMax = -Infinity, sMax = 0;
  for (const p of pts) { hMin = Math.min(hMin, p.h); hMax = Math.max(hMax, p.h); sMax = Math.max(sMax, p.slope); }
  const hPad = Math.max(2, (hMax - hMin) * 0.08);
  const y0 = hMin - hPad, y1 = hMax + hPad;
  const sTop = Math.max(limit * 1.25, sMax * 1.1, 5);
  const x = (d: number) => PAD.l + (d / total) * (W - PAD.l - PAD.r);
  const yE = (h: number) => PAD.t + (1 - (h - y0) / (y1 - y0)) * (H1 - PAD.t - PAD.b);
  const yS = (v: number) => PAD.t + (1 - v / sTop) * (H2 - PAD.t - PAD.b);

  // merge consecutive same-colour segments into polylines
  const runs: { color: string; d: string }[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].leg !== pts[i - 1].leg) continue;
    const c = colorFor(pts[i].slope, limit);
    const seg = `${x(pts[i - 1].d).toFixed(1)},${yE(pts[i - 1].h).toFixed(1)} ${x(pts[i].d).toFixed(1)},${yE(pts[i].h).toFixed(1)}`;
    const last = runs[runs.length - 1];
    if (last && last.color === c) last.d += ` ${x(pts[i].d).toFixed(1)},${yE(pts[i].h).toFixed(1)}`;
    else runs.push({ color: c, d: seg });
  }
  const slopeLine = pts.map((p) => `${x(p.d).toFixed(1)},${yS(p.slope).toFixed(1)}`).join(' ');
  const hp = hover != null ? pts[hover] : null;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const fx = ((e.clientX - b.left) / b.width) * W;
    const d = ((fx - PAD.l) / (W - PAD.l - PAD.r)) * total;
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].d < d) lo = m + 1; else hi = m; }
    setHover(Math.max(0, Math.min(pts.length - 1, lo)));
  };

  return (
    <div className={s.profile} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {hp && <span className={s.tip}>{fmtKm(hp.d)}, {Math.round(hp.h)} m, {hp.slope.toFixed(1)}°</span>}
      <svg viewBox={`0 0 ${W} ${H1 + H2}`} role="img"
        aria-label={`Elevation profile, ${fmtKm(total)} total, from ${Math.round(hMin)} to ${Math.round(hMax)} metres, steepest segment ${sMax.toFixed(1)} degrees against a ${limit} degree limit`}>
        <g fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">
          <text x={PAD.l - 4} y={yE(hMax)} textAnchor="end" dominantBaseline="middle">{Math.round(hMax)}</text>
          <text x={PAD.l - 4} y={yE(hMin)} textAnchor="end" dominantBaseline="middle">{Math.round(hMin)}</text>
        </g>
        <line x1={PAD.l} x2={W - PAD.r} y1={H1 - PAD.b} y2={H1 - PAD.b} stroke="var(--hairline-strong)" />
        {legStarts.slice(1).map((d, i) => (
          <line key={i} x1={x(d)} x2={x(d)} y1={PAD.t} y2={H1 + H2 - PAD.b} stroke="var(--hairline-strong)" strokeDasharray="3 3" />
        ))}
        <g fontSize="9" fill="var(--muted)">
          {legStarts.map((d, i) => (
            <text key={i} x={x(d) + 3} y={PAD.t + 8}>{route.legs.length === 1 ? 'One way' : i === 0 ? 'Out' : i === route.legs.length - 1 && route.roundTrip ? 'Back' : `Leg ${i + 1}`}</text>
          ))}
        </g>
        {runs.map((r, i) => <polyline key={i} points={r.d} fill="none" stroke={r.color} strokeWidth="2" strokeLinejoin="round" />)}

        <g transform={`translate(0 ${H1})`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={H2 - PAD.b} y2={H2 - PAD.b} stroke="var(--hairline-strong)" />
          <polyline points={slopeLine} fill="none" stroke="var(--muted)" strokeWidth="1" />
          <line x1={PAD.l} x2={W - PAD.r} y1={yS(limit)} y2={yS(limit)} stroke="#ff7a6e" strokeDasharray="4 3" />
          <text x={W - PAD.r} y={yS(limit) - 3} textAnchor="end" fontSize="9" fill="#ff7a6e" fontFamily="var(--font-mono)">limit {limit}°</text>
          <text x={PAD.l - 4} y={yS(0)} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">0°</text>
          <text x={PAD.l - 4} y={yS(sTop)} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">{Math.round(sTop)}°</text>
          <text x={W - PAD.r} y={H2 - 3} textAnchor="end" fontSize="9" fill="var(--muted)" fontFamily="var(--font-mono)">{fmtKm(total)}</text>
        </g>
        {hp && <line x1={x(hp.d)} x2={x(hp.d)} y1={PAD.t} y2={H1 + H2 - PAD.b} stroke="var(--text)" strokeWidth="0.8" />}
      </svg>
    </div>
  );
}
