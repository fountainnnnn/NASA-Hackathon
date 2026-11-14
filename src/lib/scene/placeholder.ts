/**
 * DEV-ONLY procedural stand-in terrain. It is NOT NASA data and is only used when loading the real
 * DEM fails in development; the UI shows a persistent "PLACEHOLDER" banner whenever it is active.
 */
import { R_MARS } from '../contracts';
import type { Dem, DemMeta } from '../contracts';

export const PLACEHOLDER_LABEL = 'PLACEHOLDER: loading real data failed';

export function makePlaceholderDem(): Dem {
  const width = 480, height = 400;
  const lonC = 77.45088572, latC = 18.44462715;
  const DEG = Math.PI / 180;
  const dLat = 20 / (R_MARS * DEG);
  const dLon = 20 / (R_MARS * Math.cos(latC * DEG) * DEG);
  const elev = new Float32Array(width * height);
  let mn = Infinity, mx = -Infinity;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const u = (c / width - 0.5) * 2, v = (r / height - 0.5) * 2;
      const rad = Math.hypot(u * 1.0, v * 1.2);
      const bowl = rad < 0.8 ? -300 : -300 + (rad - 0.8) * 2600;
      const delta = 160 * Math.exp(-((u + 0.35) ** 2 + (v + 0.1) ** 2) / 0.05);
      const rough = 18 * Math.sin(c * 0.09) * Math.cos(r * 0.07) + 8 * Math.sin(c * 0.31 + r * 0.17);
      const e = -2500 + bowl + delta + rough;
      elev[r * width + c] = e;
      if (e < mn) mn = e;
      if (e > mx) mx = e;
    }
  }
  const sorted = Float32Array.from(elev).sort();
  const meta: DemMeta = {
    productLabel: PLACEHOLDER_LABEL, sourceUrl: '', width, height,
    lonMin: lonC - (width * dLon) / 2, lonMax: lonC + (width * dLon) / 2,
    latMin: latC - (height * dLat) / 2, latMax: latC + (height * dLat) / 2,
    dLon, dLat, nominalResM: 20,
    encoding: { type: 'int16le', scale: 1, offset: 0, nodata: -32768 }, file: '',
    elevMin: mn, elevMax: mx, hRef: sorted[sorted.length >> 1],
    datum: 'PLACEHOLDER: synthetic heights, not NASA data',
  };
  return { meta, elev };
}
