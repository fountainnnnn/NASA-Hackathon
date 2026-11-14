/**
 * Vertex normals for the Mars Trek terrain. The mars_v14 tiles advertise the normals extension in layer.json but the files
 * on S3 carry none, so Cesium's vertex lighting would shade with an undefined normal (whole tiles turned dark: the "dark
 * rectangle"). Each tile's normals are computed here from its own triangles (area weighted, in Mars-fixed coordinates, as
 * the quantized-mesh spec stores them) and handed to Cesium before it builds the mesh; upsampled child tiles inherit them.
 * Relief then shades from the real terrain under the scene's sun.
 */
import type * as CesiumNS from 'cesium';

type C = typeof CesiumNS;
interface QMData {
  _encodedNormals?: Uint8Array; _uValues?: Uint16Array; _vValues?: Uint16Array; _heightValues?: Uint16Array;
  _indices?: Uint16Array | Uint32Array; _minimumHeight: number; _maximumHeight: number;
}
const MAXQ = 32767;
/**
 * Shading tilt limit. The DEM has a few seams where two source products meet with a near-vertical step (one sits on a
 * tile edge north of Gale); unclamped they shade as black lines. Real slopes at this resolution stay well under 40 degrees.
 */
export const MAX_SHADING_TILT_DEG = 30;
/** Deepest terrain level requested; finer levels are interpolated tiles (no new data), so Cesium upsamples instead. */
export const MAX_TERRAIN_LEVEL = 15;
/**
 * Deepest level used to sample heights for marks (sampleTerrainMostDetailed). Level 13 tiles are 1.3 km wide with about
 * 150 m vertex spacing; one tile covers many touchdown points, so a 1500-point scatter costs tens of requests, not hundreds.
 */
export const MAX_SAMPLE_LEVEL = 13;

export function encodeTileNormals(C: C, ellipsoid: CesiumNS.Ellipsoid, rect: CesiumNS.Rectangle, d: QMData): Uint8Array | undefined {
  const u = d._uValues, v = d._vValues, hv = d._heightValues, idx = d._indices;
  if (!u || !v || !hv || !idx) return undefined;
  const n = u.length, pos = new Float64Array(n * 3), acc = new Float64Array(n * 3);
  const carto = new C.Cartographic(), p = new C.Cartesian3();
  const dh = d._maximumHeight - d._minimumHeight;
  for (let i = 0; i < n; i++) {
    carto.longitude = rect.west + (u[i] / MAXQ) * rect.width;
    carto.latitude = rect.south + (v[i] / MAXQ) * rect.height;
    carto.height = d._minimumHeight + (hv[i] / MAXQ) * dh;
    ellipsoid.cartographicToCartesian(carto, p);
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
  }
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;   // length = 2 x area
    for (const k of [a, b, c]) { acc[k] += nx; acc[k + 1] += ny; acc[k + 2] += nz; }
  }
  const out = new Uint8Array(n * 2), nrm = new C.Cartesian3(), up = new C.Cartesian3(), side = new C.Cartesian3(), enc = new C.Cartesian2();
  const cosMax = Math.cos((MAX_SHADING_TILT_DEG * Math.PI) / 180), sinMax = Math.sin((MAX_SHADING_TILT_DEG * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    p.x = pos[i * 3]; p.y = pos[i * 3 + 1]; p.z = pos[i * 3 + 2];
    ellipsoid.geodeticSurfaceNormal(p, up);
    nrm.x = acc[i * 3]; nrm.y = acc[i * 3 + 1]; nrm.z = acc[i * 3 + 2];
    const m = C.Cartesian3.magnitude(nrm);
    if (m < 1e-9) C.Cartesian3.clone(up, nrm);
    else {
      C.Cartesian3.divideByScalar(nrm, m, nrm);
      if (C.Cartesian3.dot(nrm, up) < 0) C.Cartesian3.negate(nrm, nrm);   // winding-proof: normals point away from the planet
      const cos = C.Cartesian3.dot(nrm, up);
      if (cos < cosMax) {   // tilt down to the limit, keeping the direction the slope faces
        C.Cartesian3.subtract(nrm, C.Cartesian3.multiplyByScalar(up, cos, side), side);
        const sm = C.Cartesian3.magnitude(side);
        if (sm > 1e-9) {
          C.Cartesian3.multiplyByScalar(side, sinMax / sm, side);
          C.Cartesian3.add(C.Cartesian3.multiplyByScalar(up, cosMax, nrm), side, nrm);
        } else C.Cartesian3.clone(up, nrm);
      }
    }
    C.AttributeCompression.octEncode(nrm, enc);
    out[i * 2] = enc.x; out[i * 2 + 1] = enc.y;
  }
  return out;
}

/**
 * Patch a quantized-mesh terrain provider so every tile it returns carries vertex normals, and so levels past
 * MAX_TERRAIN_LEVEL are never fetched (near the ground Cesium would otherwise request hundreds of level 17 tiles).
 */
export function withTerrainNormals(C: C, tp: CesiumNS.CesiumTerrainProvider, ellipsoid: CesiumNS.Ellipsoid): void {
  const avail = tp.getTileDataAvailable.bind(tp);
  tp.getTileDataAvailable = (x, y, level) => (level > MAX_TERRAIN_LEVEL ? false : avail(x, y, level));
  const ta = tp.availability;
  if (ta) {
    const maxAt = ta.computeMaximumLevelAtPosition.bind(ta);
    ta.computeMaximumLevelAtPosition = (pos) => Math.min(maxAt(pos), MAX_SAMPLE_LEVEL);
  }
  const orig = tp.requestTileGeometry.bind(tp);
  tp.requestTileGeometry = (x, y, level, request) => {
    const p = orig(x, y, level, request);
    return p?.then((data) => {
      const d = data as unknown as QMData;
      if (!d._encodedNormals) {
        try { d._encodedNormals = encodeTileNormals(C, ellipsoid, tp.tilingScheme.tileXYToRectangle(x, y, level), d); } catch { /* unlit tile beats no tile */ }
      }
      return data;
    });
  };
}
