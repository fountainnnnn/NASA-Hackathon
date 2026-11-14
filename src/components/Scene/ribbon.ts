/**
 * Ground ribbon geometry (pure, unit-tested in tests/scene/ribbon.test.ts): a band of constant WORLD width along a path,
 * resampled every `stepM` metres so it follows the terrain triangles, each edge vertex set on the ground by `groundY`.
 * aS = distance along the path (m, from `startS`), aT = -1 (left edge) .. 1 (right edge).
 */
type Pt = [number, number, number];

export interface RibbonData { position: Float32Array; s: Float32Array; t: Float32Array; index: Uint32Array; lengthM: number }

/** Points every `stepM` metres or closer along the polyline (x/z distance), keeping every input vertex. */
export function resample(points: Pt[], stepM: number): { x: number; z: number; s: number }[] {
  const out: { x: number; z: number; s: number }[] = [];
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, , z] = points[i];
    if (i === 0) { out.push({ x, z, s: 0 }); continue; }
    const [px, , pz] = points[i - 1];
    const d = Math.hypot(x - px, z - pz);
    if (d < 1e-6) continue;
    const n = Math.max(1, Math.ceil(d / stepM));
    for (let k = 1; k <= n; k++) out.push({ x: px + ((x - px) * k) / n, z: pz + ((z - pz) * k) / n, s: s + (d * k) / n });
    s += d;
  }
  return out;
}

export function ribbonGeometryData(points: Pt[], widthM: number, stepM: number, startS: number, groundY: (x: number, z: number) => number): RibbonData {
  const p = resample(points, stepM);
  const n = p.length;
  const position = new Float32Array(Math.max(0, n) * 6), s = new Float32Array(n * 2), t = new Float32Array(n * 2);
  const index = new Uint32Array(Math.max(0, n - 1) * 6);
  const half = widthM / 2;
  for (let i = 0; i < n; i++) {
    // tangent from the neighbours (mitred corners without a spike: the half-width is not stretched)
    const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const nx = -tz, nz = tx; // left normal in the x/z plane
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      const x = p[i].x + nx * half * -sg, z = p[i].z + nz * half * -sg;
      const k = i * 2 + side;
      position[k * 3] = x; position[k * 3 + 1] = groundY(x, z); position[k * 3 + 2] = z;
      s[k] = startS + p[i].s; t[k] = sg;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, o = i * 6;
    index[o] = a; index[o + 1] = a + 2; index[o + 2] = a + 1;
    index[o + 3] = a + 1; index[o + 4] = a + 2; index[o + 5] = a + 3;
  }
  return { position, s, t, index, lengthM: n ? p[n - 1].s : 0 };
}
