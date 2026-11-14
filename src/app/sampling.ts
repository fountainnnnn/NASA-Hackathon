/** Cursor readout for Scout: what is under the pointer, for the globe and for Jezero. Extras (slope, unit) only after a dwell. */
import { sampleElevationM } from '@/components/Globe/dem';
import { slopeAtDem } from '@/components/Ops/demTools';
import type { ReadoutSample } from '@/components/Companion/text';
import { useHud } from '@/state/hud';
import { useGlobeStore } from '@/state/globe';
import { useGlobal, useRuntime } from '@/state/services';
import { useHover } from '@/state/ui';

let key = '', since = 0, extra: { slopeDeg: number | null; unit: string | null } = { slopeDeg: null, unit: null }, extraKey = '';

function dwelled(lon: number, lat: number): boolean {
  const k = `${lon.toFixed(3)},${lat.toFixed(3)}`;
  const now = performance.now();
  if (k !== key) { key = k; since = now; }
  return now - since > 500;
}

export function sampleGlobe(): ReadoutSample | null {
  const h = useGlobeStore.getState().hovered;
  if (!h) return null;
  const out: ReadoutSample = { lon: h.lon, lat: h.lat, elevM: sampleElevationM(h.lon, h.lat) };
  if (dwelled(h.lon, h.lat)) {
    if (extraKey !== key) {
      extraKey = key;
      const gs = useGlobal.getState().gs;
      try {
        const c = gs?.conditionsAt(h.lon, h.lat);
        extra = { slopeDeg: c?.slopeDeg ?? null, unit: c?.geology?.name ?? null };
      } catch { extra = { slopeDeg: null, unit: null }; }
    }
    out.slopeDeg = extra.slopeDeg; out.unit = extra.unit;
  }
  return out;
}

export function sampleJezero(): ReadoutSample | null {
  const h = useHover.getState().hover;
  const rt = useRuntime.getState().rt;
  if (!h || !rt || useHud.getState().dragging) return null;
  const out: ReadoutSample = { lon: h.lon, lat: h.lat, elevM: h.elev };
  if (dwelled(h.lon, h.lat)) {
    if (extraKey !== key) {
      extraKey = key;
      extra = { slopeDeg: slopeAtDem(rt.dem, h.lon, h.lat), unit: rt.science.geologyAt({ lon: h.lon, lat: h.lat })?.name ?? null };
    }
    out.slopeDeg = extra.slopeDeg; out.unit = extra.unit;
  }
  return out;
}
