/**
 * HUD store: everything the minimal interface remembers that is not world data.
 * (sheets and popovers, the committed route's verdict, preview line, lasso, scenario switches.)
 */
import { create } from 'zustand';
import type { LonLat } from '../lib/contracts';
import type { ReachResult } from '../components/Scenario/reach';

export type Sheet = 'sources' | 'cuff' | null;
export type Popover = 'layers' | 'limits' | null;
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
  /** EVA start time (UTC ms). Default: when the page opened. */
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
  startUtcMs: Date.now(),
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

  setSheet: (sheet) => set({ sheet, popover: null }),
  setPopover: (popover) => set({ popover }),
  togglePopover: (p) => set({ popover: get().popover === p ? null : p }),
  patch: (p) => set(p),
}));
