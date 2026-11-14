/** Deterministic seeded PRNG: xoshiro128** seeded through splitmix32. Same seed -> same stream everywhere. */
export interface Rng { next(): number; gauss(): number }

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export function createRng(seed: number): Rng {
  const sm = splitmix32(Math.floor(seed));
  let s0 = sm(), s1 = sm(), s2 = sm(), s3 = sm();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  const u32 = () => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    s0 >>>= 0; s1 >>>= 0; s2 >>>= 0; s3 >>>= 0;
    return result;
  };
  let spare: number | null = null;
  const next = () => (u32() >>> 0) / 4294967296; // [0,1)
  const gauss = () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = next();
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}
