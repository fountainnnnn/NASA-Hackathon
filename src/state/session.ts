/**
 * Session facts the report and the top bar need that no other store keeps: the last landing check and landing
 * scenario, the name of the place the route goes to, and the breadcrumb (Mars > region > place).
 */
import { create } from 'zustand';
import type { LonLat } from '../lib/contracts';
import type { LandingFact, ScenarioFact, TargetScienceFact } from '../lib/report/build';

export interface SessionState {
  landing: LandingFact | null;
  scenario: ScenarioFact | null;
  /** Science at the planned target and the nearest Perseverance view (for the report). */
  science: TargetScienceFact | null;
  targetName: string | null;
  /** Breadcrumb after "Mars": region (e.g. "Jezero Crater") and the selected place. */
  region: string | null;
  place: string | null;
  /** Where the clock cells read local solar time and sun elevation. */
  site: LonLat | null;
  patch(p: Partial<SessionState>): void;
}

export const useSession = create<SessionState>((set) => ({
  landing: null, scenario: null, science: null, targetName: null, region: null, place: null, site: null,
  patch: (p) => set(p),
}));
