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
export interface Rect { left: number; top: number; right: number; bottom: number }

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Nearest spot to `c` where a Scout-sized box (side `size`) touches none of `rects` and stays inside the viewport.
 * Searches outward in rings of 16 directions; falls back to `c` clamped when the screen is full.
 */
export function nudgeClear(c: Vec, size: number, rects: Rect[], pad = 6, vw = Infinity, vh = Infinity): Vec {
  const h = size / 2 + pad;
  const free = (x: number, y: number) => x - size / 2 >= 2 && y - size / 2 >= 2 && x + size / 2 <= vw - 2 && y + size / 2 <= vh - 2
    && rects.every((r) => x + h <= r.left || x - h >= r.right || y + h <= r.top || y - h >= r.bottom);
  const clamp = (v: Vec): Vec => ({ x: Math.min(vw - size / 2 - 2, Math.max(size / 2 + 2, v.x)), y: Math.min(vh - size / 2 - 2, Math.max(size / 2 + 2, v.y)) });
  const start = clamp(c);
  if (free(start.x, start.y)) return start;
  for (let rad = 8; rad <= 560; rad += 8) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = start.x + Math.cos(a) * rad, y = start.y + Math.sin(a) * rad;
      if (free(x, y)) return { x, y };
    }
  }
  return start;
}

/**
 * Place the bubble near Scout (centre `scout`) without covering `avoid` (the cursor or the placed ring), the HUD rects
 * in `keepClear`, and inside the viewport. Order tried: right of Scout, above-right, below-right, then mirrored to the
 * left, then a sweep of the viewport; the first spot that touches nothing wins, otherwise the one that overlaps least.
 */
export function placeBubble(scout: Vec, size: number, bw: number, bh: number, vw: number, vh: number, avoid?: Vec, margin = 12, gap = 18, topInset = 0, keepClear: Rect[] = []): BubblePlacement {
  const clampX = (x: number) => Math.max(margin, Math.min(x, vw - margin - bw));
  const clampY = (y: number) => Math.max(margin + topInset, Math.min(y, vh - margin - bh));
  const hits = (l: number, t: number) => !!avoid && avoid.x > l - 20 && avoid.x < l + bw + 20 && avoid.y > t - 20 && avoid.y < t + bh + 20;
  const rightL = scout.x + size / 2 + gap, leftL = scout.x - size / 2 - gap - bw;
  const candidates: [number, number][] = [];
  for (const l of [rightL, leftL]) {
    for (const t of [scout.y - bh - gap, scout.y - 16, (avoid?.y ?? scout.y) + 26]) candidates.push([clampX(l), clampY(t)]);
  }
  for (let t = margin + topInset; t <= vh - margin - bh; t += 24) for (const l of [rightL, leftL, margin, vw - margin - bw]) candidates.push([clampX(l), clampY(t)]);
  const scoutBox: Rect = { left: scout.x - size / 2 - 4, top: scout.y - size / 2 - 4, right: scout.x + size / 2 + 4, bottom: scout.y + size / 2 + 4 };
  const cost = ([l, t]: [number, number]) => {
    const b: Rect = { left: l - 4, top: t - 4, right: l + bw + 4, bottom: t + bh + 4 };
    return keepClear.reduce((a, r) => a + overlapArea(b, r), 0) + overlapArea(b, scoutBox) * 4 + (hits(l, t) ? 1e6 : 0);
  };
  let best = candidates[0], bestCost = cost(best);
  for (const c of candidates) {
    if (bestCost === 0) break;
    const k = cost(c);
    if (k < bestCost) { best = c; bestCost = k; }
  }
  return { left: best[0], top: best[1], width: bw, height: bh };
}
