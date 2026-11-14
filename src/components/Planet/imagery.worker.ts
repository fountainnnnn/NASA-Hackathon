/**
 * Imagery fusion off the main thread: decode-free (bitmaps arrive decoded), resample Viking, fuse CTX detail
 * (imageryBlend.ts), and hand back an ImageBitmap flipped the way Cesium expects imagery bitmaps (it cannot flip them on upload).
 */
import { fuseTile } from './imageryBlend';

export interface FuseJob {
  id: number; size: number;
  /** Viking source (already cropped to the tile plus margin) and where the tile sits in it. */
  viking: ImageBitmap | null; ml: number; mt: number; sub: number;
  ctx: ImageBitmap | null;
}
export type FuseReply = { id: number; bitmap: ImageBitmap } | { id: number; error: string };

interface Scope { onmessage: ((e: MessageEvent<FuseJob>) => void) | null; postMessage(m: FuseReply, t?: Transferable[]): void }
const scope = self as unknown as Scope;

let g: OffscreenCanvasRenderingContext2D | null = null;
function ctx2d(size: number): OffscreenCanvasRenderingContext2D {
  if (!g || g.canvas.width !== size) g = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!;
  return g;
}

scope.onmessage = async (e) => {
  const j = e.data;
  try {
    const c2 = ctx2d(j.size);
    c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high';
    c2.clearRect(0, 0, j.size, j.size);
    let v: Uint8ClampedArray;
    if (j.viking) {
      const s = j.size / j.sub;
      c2.drawImage(j.viking, -j.ml * s, -j.mt * s, j.viking.width * s, j.viking.height * s);
      v = c2.getImageData(0, 0, j.size, j.size).data;
    } else v = new Uint8ClampedArray(j.size * j.size * 4).fill(110);
    let c: Uint8ClampedArray | null = null;
    if (j.ctx) { c2.clearRect(0, 0, j.size, j.size); c2.drawImage(j.ctx, 0, 0, j.size, j.size); c = c2.getImageData(0, 0, j.size, j.size).data; }
    j.viking?.close(); j.ctx?.close();
    fuseTile(v, c, j.size, v);
    const bitmap = await createImageBitmap(new ImageData(v as Uint8ClampedArray<ArrayBuffer>, j.size, j.size), { imageOrientation: 'flipY' });
    scope.postMessage({ id: j.id, bitmap }, [bitmap]);
  } catch (err) {
    scope.postMessage({ id: j.id, error: String(err) });
  }
};
