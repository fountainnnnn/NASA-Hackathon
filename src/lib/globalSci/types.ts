import type { LonLat } from '../contracts';
import type { EdlPhase, GlobalManifest, GlobalSite, GlobeCommand, LandingCheck, SiteConditions } from '../globeContracts';
import type { SlopeSource } from '../scenario/types';

export type LandingCheckResult = LandingCheck & {
  /** criteria that need rover-scale data (not part of the verdict) are included here */
  notes: string[];
  criteriaCaveat: string;
};

export interface GlobalScienceApi {
  load(): Promise<void>;
  readonly loaded: boolean;
  manifest(): GlobalManifest | null;
  conditionsAt(lon: number, lat: number): SiteConditions;
  sitesNear(lon: number, lat: number, radiusKm: number): { site: GlobalSite; distanceKm: number; bearingDeg: number }[];
  placeName(lon: number, lat: number): string | null;
  /** global DEM slope (deg) at a point, for scenarios; null = no data */
  slopeSource(): SlopeSource;
  checkLandingSite(lon: number, lat: number): LandingCheckResult;
  edlPhases(): EdlPhase[];
  /** default Mars 2020 ellipse (7.7 x 6.6 km) from landing_criteria.json, null if not loaded */
  defaultEllipse(): LandingCheck['ellipse'] | null;
}

/** Facade over the globe scene (state/globe). Optional in ToolDeps so the Jezero-only app keeps working. */
export interface GlobeFacade {
  applyGlobeCommands(cmds: GlobeCommand[]): { applied: number; errors: string[] };
  snapshot(): { mode: 'globe' | 'jezero'; clicked: LonLat | null; hovered: LonLat | null };
}
