/**
 * HUD store: everything the minimal interface remembers that is not world data.
 * (sheets and popovers, the committed route's verdict, preview line, lasso, scenario switches.)
 */
import { create } from 'zustand';
import type { LonLat } from '../lib/contracts';
import type { ReachResult } from '../components/Scenario/reach';
import { nextLtstUtcMs } from '../lib/ops/lighting';
import { BASE_LONLAT } from './world';

export type Sheet = 'sources' | 'cuff' | null;
export type Popover = 'layers' | 'limits' | null;
/** ASSUMPTION: antenna mast height on the base habitat, m. The comms check is line of sight from here. */
export const DEFAULT_MAST_M = 10;
export const MAST_RANGE_M = { min: 2, max: 30 } as const;
/**
 * ASSUMPTION: a planned EVA starts at 09:00 local true solar time at the base (Mars24), the next one after the page opens,
 * so a normal walk is in daylight. Limits has Now, 09:00 and Local noon to change it.
 */
export const DEFAULT_START_LTST_H = 9;
export const defaultStartUtcMs = (fromMs: number = Date.now()) => nextLtstUtcMs(BASE_LONLAT.lon, DEFAULT_START_LTST_H, fromMs);
/** Landing simulations touch down in daylight: 10:00 local true solar time at the site (Mars24), not "now". */
export const LANDING_TOUCHDOWN_LTST_H = 10;
/** Entry time (UTC ms) for a descent of `touchdownS` seconds that lands at 10:00 LTST at `lon`. */
export const landingStartUtcMs = (lon: number, touchdownS: number, fromMs: number = Date.now()) => nextLtstUtcMs(lon, LANDING_TOUCHDOWN_LTST_H, fromMs) - touchdownS * 1000;

export type Tone = 'go' | 'caution' | 'nogo';

export interface Verdict { word: 'GO' | 'HOLD' | 'NO GO'; tone: Tone; reason: string; routeId: string }

export interface PreviewLine {
  points: (LonLat & { h: number })[];
  tone: Tone;
  /** distance and time shown at the cursor */
  label: string;
  at: { x: number; y: number };
}

export interface LandingView {
  scenarioId: string;
  site: LonLat;
  /** UTC (ms) of atmospheric entry, chosen so touchdown falls at LANDING_TOUCHDOWN_LTST_H local solar time at the site */
  startUtcMs?: number;
  maxSlopeDeg: number;
  ellipse: { semiMajorKm: number; semiMinorKm: number; azimuthDeg: number };
}

export interface CuffView { routeId: string; svg: string; text: string; filenameBase: string; turnBack: string | null }

export interface HudState {
  sheet: Sheet;
  popover: Popover;
  verdict: Verdict | null;
  /** The route Scout is talking about (latest committed). */
  activeRouteId: string | null;
  /** EVA start time (UTC ms). Default: the next 09:00 local solar time at the base after the page opened. */
  startUtcMs: number;
  preview: PreviewLine | null;
  dragging: boolean;
  /** Lasso polygon in viewport pixels while shift is held. */
  lasso: { x: number; y: number }[] | null;
  lassoLabel: string | null;
  /** Scenario switches */
  walkOn: boolean;
  reachOn: boolean;
  reach: ReachResult | null;
  /** "7 of 24 plans" while the reach contours compute */
  reachProgress: string | null;
  landing: LandingView | null;
  edl: boolean;
  cuff: CuffView | null;
  /** Comms mast height on the base habitat, m (Assumption). */
  mastHeightM: number;
  /** Page of verbs shown after a route (Scout shows at most four at a time). */
  verbPage: 0 | 1;

  setSheet(s: Sheet): void;
  setPopover(p: Popover): void;
  togglePopover(p: Exclude<Popover, null>): void;
  patch(p: Partial<HudState>): void;
}

export const useHud = create<HudState>((set, get) => ({
  sheet: null,
  popover: null,
  verdict: null,
  activeRouteId: null,
  startUtcMs: defaultStartUtcMs(),
  preview: null,
  dragging: false,
  lasso: null,
  lassoLabel: null,
  walkOn: false,
  reachOn: false,
  reach: null,
  reachProgress: null,
  landing: null,
  edl: false,
  cuff: null,
  verbPage: 0,
  mastHeightM: DEFAULT_MAST_M,

  setSheet: (sheet) => set({ sheet, popover: null }),
  setPopover: (popover) => set({ popover }),
  togglePopover: (p) => set({ popover: get().popover === p ? null : p }),
  patch: (p) => set(p),
}));
