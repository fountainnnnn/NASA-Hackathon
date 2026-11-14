import { R_MARS } from '../contracts';

const D2R = Math.PI / 180;

export type RasterData = Int16Array | Uint8Array;

/** Equirectangular raster covering lon -180..180, lat 90..-90, pixel-edge aligned (row 0 = north). */
export interface Raster {
  width: number; height: number;
  data: RasterData;
  scale: number; offset: number; nodata: number;
}

export const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u8 = new Uint8Array(buf);
  if (!isGzip(u8)) return buf; // the server (or fetch) already decoded it
  if (typeof DecompressionStream === 'undefined') throw new Error('gzip data but no DecompressionStream');
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export function decodeRaster(buf: ArrayBuffer, type: 'int16le' | 'uint8', width: number, height: number, scale: number, offset: number, nodata: number): Raster {
  let data: RasterData;
  if (type === 'uint8') data = new Uint8Array(buf, 0, width * height);
  else {
    const dv = new DataView(buf);
    const a = new Int16Array(width * height);
    for (let i = 0; i < a.length; i++) a[i] = dv.getInt16(i * 2, true);
    data = a;
  }
  if (data.length !== width * height) throw new Error(`raster size mismatch: ${data.length} != ${width}x${height}`);
  return { width, height, data, scale, offset, nodata };
}

/** Nearest-cell value (scaled), or null for nodata. Longitude wraps; latitude clamps. */
export function sampleNearest(r: Raster, lon: number, lat: number): number | null {
  const c = cellCol(r, lon);
  const row = cellRow(r, lat);
  const raw = r.data[row * r.width + c];
  return raw === r.nodata ? null : raw * r.scale + r.offset;
}

export function cellCol(r: Raster, lon: number): number {
  const c = Math.floor(((lon + 180) / 360) * r.width);
  return ((c % r.width) + r.width) % r.width;
}
export function cellRow(r: Raster, lat: number): number {
  return Math.min(r.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * r.height)));
}

/**
 * Bilinear sample on pixel centres. Longitude wraps across +-180; latitude clamps at the first/last pixel row
 * (so the poles return the polar row value). null if any contributing cell (non-zero weight) is nodata.
 */
export function sampleBilinear(r: Raster, lon: number, lat: number): number | null {
  const fx = ((lon + 180) / 360) * r.width - 0.5;
  const fy = ((90 - lat) / 180) * r.height - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const col = (x: number) => ((x % r.width) + r.width) % r.width;
  const row = (y: number) => Math.min(r.height - 1, Math.max(0, y));
  let acc = 0;
  for (let j = 0; j < 2; j++) {
    const wy = j === 0 ? 1 - ty : ty;
    if (wy === 0) continue;
    for (let i = 0; i < 2; i++) {
      const wx = i === 0 ? 1 - tx : tx;
      if (wx === 0) continue;
      const raw = r.data[row(y0 + j) * r.width + col(x0 + i)];
      if (raw === r.nodata) return null;
      acc += wx * wy * raw;
    }
  }
  return acc * r.scale + r.offset;
}

/**
 * Horn 3x3 slope (deg) at the cell containing (lon, lat), at the raster's own posting. Per-row ground spacing
 * dx = R cos(lat_row) dLon, dy = R dLat. Longitude wraps. null if any of the 9 cells is nodata or the cell is
 * in the first/last row (poles: no row above/below, and dx -> 0).
 */
export function slopeHorn(r: Raster, lon: number, lat: number): number | null {
  const row = cellRow(r, lat);
  if (row <= 0 || row >= r.height - 1) return null;
  const c = cellCol(r, lon);
  const W = r.width;
  const z = (dr: number, dc: number) => {
    const raw = r.data[(row + dr) * W + (((c + dc) % W) + W) % W];
    return raw === r.nodata ? NaN : raw * r.scale + r.offset;
  };
  const a = z(-1, -1), b = z(-1, 0), cc = z(-1, 1), d = z(0, -1), f = z(0, 1), g = z(1, -1), h = z(1, 0), i = z(1, 1);
  const e = z(0, 0);
  if (a + b + cc + d + e + f + g + h + i !== a + b + cc + d + e + f + g + h + i) return null; // NaN present
  const dLonRad = (360 / W) * D2R, dLatRad = (180 / r.height) * D2R;
  const latRow = (90 - (row + 0.5) * (180 / r.height)) * D2R;
  const dx = R_MARS * Math.cos(latRow) * dLonRad;
  const dy = R_MARS * dLatRad;
  const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * dx);
  const dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) / (8 * dy);
  return Math.atan(Math.hypot(dzdx, dzdy)) / D2R;
}

/** Slope raster over the whole grid (row 0 / last row = NaN). Used to hand the WASM engine a grid. */
export function slopeGrid(r: Raster): Float32Array {
  const out = new Float32Array(r.width * r.height).fill(NaN);
  for (let row = 1; row < r.height - 1; row++) {
    const lat = 90 - (row + 0.5) * (180 / r.height);
    for (let c = 0; c < r.width; c++) {
      const lon = -180 + (c + 0.5) * (360 / r.width);
      const s = slopeHorn(r, lon, lat);
      if (s != null) out[row * r.width + c] = s;
    }
  }
  return out;
}
