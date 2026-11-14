import * as THREE from 'three';

/** fetch with byte progress (progress = null when the size is unknown). */
export async function fetchWithProgress(url: string, onProgress?: (frac: number | null) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(total ? Math.min(1, got / total) : null);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  onProgress?.(1);
  return out.buffer;
}

export type TexKind = 'color' | 'data' | 'index';

export async function loadImageTexture(url: string, kind: TexKind, onProgress?: (f: number | null) => void): Promise<THREE.Texture> {
  const buf = await fetchWithProgress(url, onProgress);
  const type = url.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const bmp = await createImageBitmap(new Blob([buf], { type }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const t = new THREE.Texture(bmp);
  t.flipY = false; // v = 0 is the north edge of every raster
  t.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (kind === 'index') {
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  } else {
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
  }
  t.needsUpdate = true;
  return t;
}

/** 256x1 RGBA palette: index 0 transparent, index k+1 = unitOrder[k] colour. */
export function makePaletteTexture(colors: string[]): THREE.DataTexture {
  const data = new Uint8Array(256 * 4);
  colors.slice(0, 255).forEach((hex, k) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
    const o = (k + 1) * 4;
    // hex colours are sRGB bytes; the texture is flagged sRGB so the GPU decodes them.
    data[o] = m ? parseInt(m[1], 16) : 160; data[o + 1] = m ? parseInt(m[2], 16) : 160; data[o + 2] = m ? parseInt(m[3], 16) : 160; data[o + 3] = 255;
  });
  const t = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Slope (deg) as a half-float R texture, same layout as the DEM (row 0 = north). */
export function makeSlopeTexture(slope: Float32Array, width: number, height: number): THREE.DataTexture {
  const half = new Uint16Array(slope.length);
  for (let i = 0; i < slope.length; i++) {
    const v = slope[i];
    half[i] = THREE.DataUtils.toHalfFloat(v === v ? Math.min(v, 89) : 0);
  }
  const t = new THREE.DataTexture(half, width, height, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

export function makeDummyTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
