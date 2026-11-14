import type { LonLat } from '../../lib/contracts';
import { projectGlobe } from '../Ops/projector';

export interface Screen { x: number; y: number; visible: boolean }
type Proj = (p: LonLat) => Screen;

let live: Proj | null = null;
export const registerPlanetProjector = (p: Proj | null) => { live = p; };

/**
 * Scout's screen projection for the globe. Uses the Cesium planet while it runs; when PlanetView fell back to the
 * three.js globe, the Ops projector (mounted inside that canvas) answers instead.
 */
export const projectPlanet: Proj = (p) => (live ? live(p) : projectGlobe(p));
