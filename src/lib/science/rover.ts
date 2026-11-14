import type { RoverImage } from '@/lib/contracts';

/** Raw record subset from https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N */
export interface RawImage {
  imageid?: string;
  sol?: number;
  sample_type?: string;
  date_taken_utc?: string;
  link?: string;
  credit?: string;
  extended?: { dimension?: string; sclk?: string; mastEl?: string; mastAz?: string };
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

/**
 * Lower rank = better "view from the ground". Navcam first: wide landscape frames from the mast at eye height. Mastcam-Z
 * next (narrow, often a close-up of one rock). Hazcams look down at the wheels. Unlisted (SuperCam RMI, SkyCam, WATSON,
 * PIXL, EDL, CacheCam...) = excluded.
 */
export function cameraRank(camera: string): number {
  if (camera.startsWith('NAVCAM_')) return 0;
  if (camera.startsWith('MCZ_')) return 1;
  if (camera.startsWith('FRONT_HAZCAM_')) return 2;
  if (camera.startsWith('REAR_HAZCAM_')) return 3;
  return 99;
}

/** Raw `extended.dimension` is "(w,h)"; frames smaller than 400 px on a side are subframe crops, not views. */
export function isFullFrame(dimension: string | undefined): boolean {
  const m = dimension?.match(/\((\d+),\s*(\d+)\)/);
  return !m || (Number(m[1]) >= 400 && Number(m[2]) >= 400);
}

const num = (v: string | undefined): number | undefined => { const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };

/** Spacecraft clock of a frame: the record's own, else the third field of a Mars 2020 image id (NRF_0013_0668099880_...). */
export function sclkOf(im: Pick<RoverImage, 'id' | 'sclk'>): number | null {
  if (im.sclk != null && Number.isFinite(im.sclk)) return im.sclk;
  const m = im.id.match(/^[A-Z]{3}_\d{4}_(\d{10})_/);
  return m ? Number(m[1]) : null;
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
    const sclk = num(r.extended?.sclk), mastElDeg = num(r.extended?.mastEl), mastAzDeg = num(r.extended?.mastAz);
    out.push({
      id: r.imageid, sol: r.sol ?? sol,
      earthDate: (r.date_taken_utc ?? '').slice(0, 10),
      camera, cameraFull: CAMERA_FULL[camera] ?? camera,
      url, pageUrl: r.link,
      credit: camera.startsWith('MCZ_') ? 'NASA/JPL-Caltech/ASU' : 'NASA/JPL-Caltech',
      ...(sclk != null ? { sclk } : {}), ...(mastElDeg != null ? { mastElDeg } : {}), ...(mastAzDeg != null ? { mastAzDeg } : {}),
    });
  }
  return out;
}

/**
 * Mast elevation band, degrees, in which a frame keeps the horizon well inside it (the camera's half field of view above
 * it): Navcam is about 73° tall, Mastcam-Z at most about 19°. Steeper down, the frame is mostly the ground next to the
 * rover, the deck, the wheels or the rover's own shadow.
 */
export const LANDSCAPE_EL_DEG = { navcam: { min: -25, max: 20 }, mastcam: { min: -8, max: 12 } } as const;
/** Frames closer in time than this are one look (a stereo pair, a mosaic tile next to its neighbour). */
export const SAME_LOOK_S = 60;
/** A second frame is shown only when it looks somewhere else: this far apart in mast azimuth, degrees. */
export const DISTINCT_AZ_DEG = 45;

/**
 * How well a frame works as the crew's view from the ground (lower is better): camera class first, then how far the mast
 * points from the horizon. Mast cameras pointed steeply down (mostly the deck, wheels or the rover's own shadow) and
 * body-fixed Hazcams rank last. A frame without pointing metadata keeps its camera rank.
 */
export function viewScore(im: RoverImage): number {
  const rank = cameraRank(im.camera);
  const band = rank === 0 ? LANDSCAPE_EL_DEG.navcam : rank === 1 ? LANDSCAPE_EL_DEG.mastcam : null;
  const el = im.mastElDeg;
  let s = rank * 100;
  if (band && el != null) {
    if (el < band.min || el > band.max) s += 250; // ranks below a Hazcam: looking at the ground or the sky
    s += Math.abs(el + 5); // nearest a slightly downward look at the horizon
  }
  return s;
}

const azGap = (a?: number, b?: number) => (a == null || b == null ? null : Math.abs(((a - b + 540) % 360) - 180));

/**
 * The view from the ground at a target: the best frame by viewScore, and a second one only when it is a different look
 * (more than SAME_LOOK_S apart in time, and more than DISTINCT_AZ_DEG apart in mast azimuth when both are known; never
 * the stereo partner or the next mosaic tile). Frames within SAME_LOOK_S of an already kept frame are dropped.
 */
export function selectImages(images: RoverImage[], limit = 2): RoverImage[] {
  const sorted = [...images].filter((i) => cameraRank(i.camera) < 99).sort((a, b) => viewScore(a) - viewScore(b));
  const picked: RoverImage[] = [];
  for (const im of sorted) {
    if (picked.length >= limit) break;
    const t = sclkOf(im);
    const sameLook = picked.some((p) => {
      const tp = sclkOf(p);
      if (t != null && tp != null && Math.abs(t - tp) < SAME_LOOK_S) return true;
      const gap = azGap(im.mastAzDeg, p.mastAzDeg);
      return gap != null && gap < DISTINCT_AZ_DEG;
    });
    if (sameLook) continue;
    // a second frame only when it is also a landscape from the mast (never a Hazcam or a look down at the ground)
    if (picked.length && viewScore(im) >= 200) continue;
    picked.push(im);
  }
  return picked;
}
