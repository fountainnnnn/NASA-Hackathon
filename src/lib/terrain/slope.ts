import { R_MARS } from '@/lib/contracts';
import type { Dem } from '@/lib/contracts';

const DEG = Math.PI / 180;

/**
 * Horn 3x3 slope (degrees) on the DEM posting. Per-row ground spacing:
 * dx = R·cos(lat_row)·dLon_rad, dy = R·dLat_rad. NaN if any of the 9 cells is NaN; border = NaN.
 */
export function computeSlopeField(dem: Dem): Float32Array {
  const { meta, elev } = dem;
  const w = meta.width, h = meta.height;
  const out = new Float32Array(w * h).fill(NaN);
  const dy = R_MARS * meta.dLat * DEG;
  for (let r = 1; r < h - 1; r++) {
    const lat = (meta.latMax - (r + 0.5) * meta.dLat) * DEG;
    const dx = R_MARS * Math.cos(lat) * meta.dLon * DEG;
    const k = 1 / 8;
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      const a = elev[i - w - 1], b = elev[i - w], cc = elev[i - w + 1];
      const d = elev[i - 1], f = elev[i + 1];
      const g = elev[i + w - 1], hh = elev[i + w], ii = elev[i + w + 1];
      const e = elev[i];
      const sum = a + b + cc + d + e + f + g + hh + ii;
      if (sum !== sum) continue; // any NaN poisons the sum
      const dzdx = ((cc + 2 * f + ii) - (a + 2 * d + g)) * k / dx;
      const dzdy = ((g + 2 * hh + ii) - (a + 2 * b + cc)) * k / dy;
      out[i] = Math.atan(Math.hypot(dzdx, dzdy)) / DEG;
    }
  }
  return out;
}
