import type { RoverImage } from '@/lib/contracts';

/** Raw record subset from https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N */
export interface RawImage {
  imageid?: string;
  sol?: number;
  sample_type?: string;
  date_taken_utc?: string;
  link?: string;
  credit?: string;
  extended?: { dimension?: string };
  camera?: { instrument?: string };
  image_files?: { medium?: string; large?: string; small?: string; full_res?: string };
}

const CAMERA_FULL: Record<string, string> = {
  MCZ_LEFT: 'Mastcam-Z Left', MCZ_RIGHT: 'Mastcam-Z Right',
  NAVCAM_LEFT: 'Navigation Camera Left', NAVCAM_RIGHT: 'Navigation Camera Right',
  FRONT_HAZCAM_LEFT_A: 'Front Hazard Camera Left', FRONT_HAZCAM_RIGHT_A: 'Front Hazard Camera Right',
  FRONT_HAZCAM_LEFT_B: 'Front Hazard Camera Left (B)', FRONT_HAZCAM_RIGHT_B: 'Front Hazard Camera Right (B)',
  REAR_HAZCAM_LEFT: 'Rear Hazard Camera Left', REAR_HAZCAM_RIGHT: 'Rear Hazard Camera Right',
};

/** Lower rank = more human-eye. Unlisted (SuperCam RMI, SkyCam, WATSON, PIXL, EDL, CacheCam...) = excluded. */
export function cameraRank(camera: string): number {
  if (camera.startsWith('MCZ_')) return 0;
  if (camera.startsWith('NAVCAM_')) return 1;
  if (camera.startsWith('FRONT_HAZCAM_')) return 2;
  if (camera.startsWith('REAR_HAZCAM_')) return 3;
  return 99;
}

/** Raw `extended.dimension` is "(w,h)"; frames smaller than 400 px on a side are subframe crops, not views. */
export function isFullFrame(dimension: string | undefined): boolean {
  const m = dimension?.match(/\((\d+),\s*(\d+)\)/);
  return !m || (Number(m[1]) >= 400 && Number(m[2]) >= 400);
}

/** Normalise raw API records: drops thumbnails/subframes and non-landscape-engineering cameras; keeps medium (800 px) jpg. */
export function normalizeRawImages(raw: RawImage[], sol: number): RoverImage[] {
  const out: RoverImage[] = [];
  for (const r of raw) {
    const camera = r.camera?.instrument ?? '';
    if (cameraRank(camera) >= 99) continue;
    const st = (r.sample_type ?? 'Full').toLowerCase();
    if (st === 'thumbnail' || st === 'subframe') continue;
    if (!isFullFrame(r.extended?.dimension)) continue;
    const url = r.image_files?.medium ?? r.image_files?.large;
    if (!url || !r.imageid || !/^https:\/\/mars\.nasa\.gov\//.test(url)) continue;
    out.push({
      id: r.imageid, sol: r.sol ?? sol,
      earthDate: (r.date_taken_utc ?? '').slice(0, 10),
      camera, cameraFull: CAMERA_FULL[camera] ?? camera,
      url, pageUrl: r.link,
      credit: camera.startsWith('MCZ_') ? 'NASA/JPL-Caltech/ASU' : 'NASA/JPL-Caltech',
    });
  }
  return out;
}

/** Pick up to `limit` images: best camera classes first, no camera supplying more than ceil(limit/2). */
export function selectImages(images: RoverImage[], limit: number): RoverImage[] {
  const sorted = [...images].sort((a, b) => cameraRank(a.camera) - cameraRank(b.camera));
  const cap = Math.max(1, Math.ceil(limit / 2));
  const per = new Map<string, number>();
  const picked: RoverImage[] = [];
  for (const im of sorted) {
    if (picked.length >= limit) break;
    const n = per.get(im.camera) ?? 0;
    if (n >= cap) continue;
    per.set(im.camera, n + 1);
    picked.push(im);
  }
  for (const im of sorted) if (picked.length < limit && !picked.includes(im)) picked.push(im);
  return picked;
}
