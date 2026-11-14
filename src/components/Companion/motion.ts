/** Pure motion and layout helpers for Scout (no DOM, unit tested). */

export interface Vec { x: number; y: number }

/** Exact critically damped spring step (no overshoot, unconditionally stable). omega ~ 12 settles in ~0.4 s. */
export function springStep(pos: number, vel: number, target: number, omega: number, dt: number): { pos: number; vel: number } {
  const x = pos - target;
  const temp = (vel + omega * x) * dt;
  const e = Math.exp(-omega * dt);
  return { pos: target + (x + temp) * e, vel: (vel - omega * temp) * e };
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Position along the fly-to arc: eased straight line plus a hump perpendicular to it (always bulging upward). */
export function arcPoint(from: Vec, to: Vec, t: number, maxHump = 90): Vec {
  const c = Math.min(1, Math.max(0, t));
  const e = easeInOutCubic(c);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const base = { x: from.x + dx * e, y: from.y + dy * e };
  if (dist < 1) return base;
  let nx = -dy / dist, ny = dx / dist;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const hump = Math.sin(Math.PI * c) * Math.min(maxHump, dist * 0.3);
  return { x: base.x + nx * hump, y: base.y + ny * hump };
}

/** Park at the nearest viewport edge when the point is off-screen or hidden. `angle` (radians) points from the parked spot toward the point. */
export function parkAtEdge(p: Vec, w: number, h: number, margin = 32): Vec & { angle: number } {
  const left = p.x - margin, right = w - margin - p.x, top = p.y - margin, bottom = h - margin - p.y;
  const inside = left >= 0 && right >= 0 && top >= 0 && bottom >= 0;
  let x = Math.min(w - margin, Math.max(margin, p.x));
  let y = Math.min(h - margin, Math.max(margin, p.y));
  if (inside) {
    const m = Math.min(left, right, top, bottom);
    if (m === left) x = margin; else if (m === right) x = w - margin; else if (m === top) y = margin; else y = h - margin;
  }
  const angle = Math.atan2(p.y - y, p.x - x);
  return { x, y, angle: Number.isFinite(angle) ? angle : 0 };
}

export interface BubblePlacement { left: number; top: number; width: number; height: number }

/**
 * Place the bubble near Scout (centre `scout`) without covering `avoid` (the cursor or the placed ring) and inside the viewport.
 * Order tried: right of Scout, above-right, below-right, then mirrored to the left.
 */
export function placeBubble(scout: Vec, size: number, bw: number, bh: number, vw: number, vh: number, avoid?: Vec, margin = 12, gap = 18): BubblePlacement {
  const clampX = (x: number) => Math.max(margin, Math.min(x, vw - margin - bw));
  const clampY = (y: number) => Math.max(margin, Math.min(y, vh - margin - bh));
  const hits = (l: number, t: number) => !!avoid && avoid.x > l - 20 && avoid.x < l + bw + 20 && avoid.y > t - 20 && avoid.y < t + bh + 20;
  const rightL = scout.x + size / 2 + gap, leftL = scout.x - size / 2 - gap - bw;
  const candidates: [number, number][] = [];
  for (const l of [rightL, leftL]) {
    for (const t of [scout.y - bh - gap, scout.y - 16, (avoid?.y ?? scout.y) + 26]) candidates.push([clampX(l), clampY(t)]);
  }
  const ok = candidates.find(([l, t]) => !hits(l, t)) ?? candidates[0];
  return { left: ok[0], top: ok[1], width: bw, height: bh };
}
