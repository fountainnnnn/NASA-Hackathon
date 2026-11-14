import { normalizeRawImages, type RawImage } from '@/lib/science/rover';
import type { RoverImage } from '@/lib/contracts';

const API = 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=';
const TTL_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 8000;
const cache = new Map<number, { at: number; images: RoverImage[] }>();

export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get('sol') ?? '';
  const sol = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(sol) || sol < 0 || sol > 5000) {
    return Response.json({ sol: null, images: [], error: 'sol must be an integer between 0 and 5000' }, { status: 400 });
  }
  const hit = cache.get(sol);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json({ sol, images: hit.images });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API + sol, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return Response.json({ sol, images: [], error: `NASA raw images API returned HTTP ${res.status}` });
    const body = (await res.json()) as { images?: RawImage[] };
    const images = normalizeRawImages(body.images ?? [], sol);
    cache.set(sol, { at: Date.now(), images });
    return Response.json({ sol, images });
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'NASA raw images API timed out' : 'NASA raw images API unreachable';
    return Response.json({ sol, images: [], error: msg });
  } finally {
    clearTimeout(timer);
  }
}
