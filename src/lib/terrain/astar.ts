import { R_MARS } from '@/lib/contracts';
import type { PlanningGrid, RouteObjective } from '@/lib/contracts';

const DEG = Math.PI / 180;

/** Tobler hiking speed in km/h for signed grade tanTheta (uphill positive), scaled by suit factor. */
export function toblerKmh(tanTheta: number, suitSpeedFactor: number): number {
  return suitSpeedFactor * 6 * Math.exp(-3.5 * Math.abs(tanTheta + 0.05));
}

export interface PathParams { maxSlopeDeg: number; objective: RouteObjective; suitSpeedFactor: number }
export type PathResult =
  | { ok: true; cells: number[]; cost: number; expanded: number }
  | { ok: false; reason: 'nodata_endpoint' | 'no_path'; expanded: number };

/** Per-grid precomputed row geometry + reusable workspace. */
interface Prep {
  dxRow: Float64Array;   // E-W spacing at row r
  dxMid: Float64Array;   // diagonal E-W spacing between rows r and r+1 (cos of mean latitude)
  dy: number;
  dxMin: number;         // smallest E-W spacing anywhere (admissible heuristic)
  g: Float64Array; came: Int32Array; closed: Uint8Array;
}
const cache = new WeakMap<PlanningGrid, Prep>();

function prep(grid: PlanningGrid): Prep {
  let p = cache.get(grid);
  if (p) return p;
  const { width: W, height: H } = grid;
  const dxRow = new Float64Array(H), dxMid = new Float64Array(Math.max(H - 1, 1));
  const lat = (r: number) => (grid.latMax - (r + 0.5) * grid.dLat) * DEG;
  let dxMin = Infinity;
  for (let r = 0; r < H; r++) {
    dxRow[r] = R_MARS * Math.cos(lat(r)) * grid.dLon * DEG;
    if (dxRow[r] < dxMin) dxMin = dxRow[r];
    if (r < H - 1) dxMid[r] = R_MARS * Math.cos((lat(r) + lat(r + 1)) / 2) * grid.dLon * DEG;
  }
  p = {
    dxRow, dxMid, dy: R_MARS * grid.dLat * DEG, dxMin,
    g: new Float64Array(W * H), came: new Int32Array(W * H), closed: new Uint8Array(W * H),
  };
  cache.set(grid, p);
  return p;
}

/** Binary min-heap on (key, value) with lazy deletion (duplicates allowed, stale entries skipped by caller). */
class MinHeap {
  keys: Float64Array; vals: Int32Array; size = 0;
  constructor(cap: number) { this.keys = new Float64Array(cap); this.vals = new Int32Array(cap); }
  push(k: number, v: number): void {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2); nk.set(this.keys); this.keys = nk;
      const nv = new Int32Array(this.size * 2); nv.set(this.vals); this.vals = nv;
    }
    const keys = this.keys, vals = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p]; vals[i] = vals[p]; i = p;
    }
    keys[i] = k; vals[i] = v;
  }
  /** Removes the minimum and returns its value. */
  pop(): number {
    const keys = this.keys, vals = this.vals;
    const top = vals[0];
    const n = --this.size;
    if (n > 0) {
      const k = keys[n], v = vals[n];
      let i = 0;
      for (;;) {
        let ch = 2 * i + 1;
        if (ch >= n) break;
        if (ch + 1 < n && keys[ch + 1] < keys[ch]) ch++;
        if (keys[ch] >= k) break;
        keys[i] = keys[ch]; vals[i] = vals[ch]; i = ch;
      }
      keys[i] = k; vals[i] = v;
    }
    return top;
  }
}

const DC = [-1, 0, 1, -1, 1, -1, 0, 1];
const DR = [-1, -1, -1, 0, 0, 1, 1, 1];

/**
 * 8-connected A* over the planning grid (cell indices r*W+c).
 *
 * Edge i->j allowed iff elev[j] valid AND |atan(dh/horiz)| <= maxSlope AND slopeMaxDeg[j] <= maxSlope.
 * ENDPOINT RULE (symmetric): every cell on the path must be admissible, the start cell included. A start
 * or goal cell steeper than the limit yields no_path. Because the edge test |dh| <= horiz·tan(limit) is
 * symmetric and both endpoints are held to the same cell rule, solvePath(a, b).ok === solvePath(b, a).ok
 * for every pair (tested), so a round trip never has one leg without the other. A start/goal cell with
 * NaN elevation or NaN slope returns 'nodata_endpoint'.
 *
 * Cost: 'shortest' = 3D edge length (m); 'fastest' = 3D length / Tobler speed (minutes).
 * Heuristic: straight-line ground distance (using the smallest E-W spacing in the grid so it never
 * overestimates), divided by the peak speed for 'fastest'. Admissible and consistent.
 */
export function solvePath(grid: PlanningGrid, start: number, goal: number, params: PathParams): PathResult {
  const { width: W, height: H, elev, slopeMaxDeg } = grid;
  if (!(elev[start] === elev[start]) || !(slopeMaxDeg[start] === slopeMaxDeg[start]) ||
      !(elev[goal] === elev[goal]) || !(slopeMaxDeg[goal] === slopeMaxDeg[goal])) {
    return { ok: false, reason: 'nodata_endpoint', expanded: 0 };
  }
  const maxSlope = params.maxSlopeDeg;
  if (!(slopeMaxDeg[start] <= maxSlope) || !(slopeMaxDeg[goal] <= maxSlope)) return { ok: false, reason: 'no_path', expanded: 0 };
  if (start === goal) return { ok: true, cells: [start], cost: 0, expanded: 0 };

  const P = prep(grid);
  const { g, came, closed, dxRow, dxMid, dy, dxMin } = P;
  g.fill(Infinity); came.fill(-1); closed.fill(0);

  const tanMax = Math.tan(maxSlope * DEG);
  const fastest = params.objective === 'fastest';
  const vMaxMpm = params.suitSpeedFactor * 100; // 6 km/h = 100 m/min at factor 1
  const hScale = fastest ? 1 / vMaxMpm : 1;
  const gc = goal % W, gr = (goal / W) | 0;
  const heur = (c: number, r: number): number => hScale * Math.hypot(Math.abs(gc - c) * dxMin, Math.abs(gr - r) * dy);

  const heap = new MinHeap(1 << 16);
  g[start] = 0;
  heap.push(heur(start % W, (start / W) | 0), start);
  let expanded = 0;
  const limit = W * H;

  while (heap.size > 0 && expanded < limit) {
    const n = heap.pop();
    if (closed[n]) continue;
    closed[n] = 1; expanded++;
    if (n === goal) break;
    const r = (n / W) | 0, c = n - r * W;
    const e0 = elev[n], gn = g[n];
    for (let k = 0; k < 8; k++) {
      const c2 = c + DC[k], r2 = r + DR[k];
      if (c2 < 0 || c2 >= W || r2 < 0 || r2 >= H) continue;
      const m = r2 * W + c2;
      if (closed[m]) continue;
      const e1 = elev[m];
      if (e1 !== e1) continue;
      if (!(slopeMaxDeg[m] <= maxSlope)) continue; // also rejects NaN
      const dr = DR[k], dc = DC[k];
      const horiz = dr === 0 ? dxRow[r] : dc === 0 ? dy : Math.hypot(dxMid[r < r2 ? r : r2], dy);
      const dh = e1 - e0;
      if (Math.abs(dh) > horiz * tanMax) continue;
      const len3 = Math.sqrt(horiz * horiz + dh * dh);
      const cost = fastest ? len3 / (vMaxMpm * Math.exp(-3.5 * Math.abs(dh / horiz + 0.05))) : len3;
      const ng = gn + cost;
      if (ng < g[m]) {
        g[m] = ng; came[m] = n;
        heap.push(ng + heur(c2, r2), m);
      }
    }
  }

  if (!closed[goal]) return { ok: false, reason: 'no_path', expanded };
  const cells: number[] = [];
  for (let n = goal; n !== -1; n = came[n]) cells.push(n);
  cells.reverse();
  return { ok: true, cells, cost: g[goal], expanded };
}
