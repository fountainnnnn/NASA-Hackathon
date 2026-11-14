import { createContext, useContext } from 'react';

/** Mutable per-frame camera state shared with overlays (read in useFrame; never triggers React renders). */
export interface CamState {
  lon: number; lat: number;
  /** altitude above the displayed local surface, km */
  altKm: number;
  /** camera distance from the planet centre, units of R_MARS */
  dist: number;
}
export const CamCtx = createContext<{ current: CamState } | null>(null);
export const useCam = () => {
  const c = useContext(CamCtx);
  if (!c) throw new Error('CamCtx missing');
  return c;
};
