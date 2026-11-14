import { expect, type Page } from '@playwright/test';
import * as S from './selectors';

export interface ErrorLog { errors: string[] }

/** Collects uncaught page errors, console.error output and same-origin HTTP >= 400 responses. */
export function collectErrors(page: Page): ErrorLog {
  const log: ErrorLog = { errors: [] };
  const origin = () => new URL(page.url() === 'about:blank' ? 'http://x' : page.url()).origin;
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (S.IGNORED_CONSOLE.some((r) => r.test(t))) return;
    log.errors.push(`console.error: ${t}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    if (!u.startsWith(origin()) || S.IGNORED_CONSOLE.some((x) => x.test(u))) return;
    log.errors.push(`HTTP ${r.status()}: ${u}`);
  });
  return log;
}

/** Open the app and wait until the DEM is decoded and the WebGL canvas is mounted. */
export async function gotoApp(page: Page, opts: { intro?: boolean } = {}) {
  // Intro.tsx shows a blocking welcome dialog until localStorage 'marswalk-intro-seen' is set.
  if (!opts.intro) await page.addInitScript((k) => { try { localStorage.setItem(k, '1'); } catch { /* ignore */ } }, S.INTRO_SEEN_KEY);
  await page.goto('/');
  await waitSceneReady(page);
}

/** Wait for DEM + canvas, then let the first frames render and the camera settle (clicks before this are ignored). */
export async function waitSceneReady(page: Page) {
  await page.waitForFunction(S.SCENE_READY_JS, null, { timeout: 150_000 });
  await expect(S.canvas(page)).toBeVisible();
  await page.waitForTimeout(1500);
}

export interface LatLon { lat: number; lon: number }

/** "18.44667° N, 77.45167° E" or "lat 18.4, lon 77.4" → numbers (S/W negative). */
export function parseLatLon(text: string): LatLon | null {
  const hemi = text.match(/(\d+(?:\.\d+)?)\s*°?\s*([NS])\b[^\d]{0,12}?(\d+(?:\.\d+)?)\s*°?\s*([EW])\b/);
  if (hemi) {
    return { lat: Number(hemi[1]) * (hemi[2] === 'S' ? -1 : 1), lon: Number(hemi[3]) * (hemi[4] === 'W' ? -1 : 1) };
  }
  const lab = text.match(/lat\w*\W{0,6}(-?\d+(?:\.\d+)?)[\s\S]{0,30}?lon\w*\W{0,6}(-?\d+(?:\.\d+)?)/i);
  return lab ? { lat: Number(lab[1]), lon: Number(lab[2]) } : null;
}

/** Make sure the ask panel (which shows the selected point's coordinates) is open. */
export async function ensureAskOpen(page: Page) {
  if (await S.askPanel(page).count()) return;
  const opener = S.askOpener(page);
  if (await opener.count()) await opener.first().click();
}

/** Coordinates of the SELECTED point (not the hover readout). null until something is selected. */
export async function readSelected(page: Page): Promise<LatLon | null> {
  const tid = S.selectedReadoutTestId(page);
  if (await tid.count()) return parseLatLon(await tid.first().innerText());
  await ensureAskOpen(page);
  const ask = S.askPanel(page);
  if (await ask.count()) return parseLatLon(await ask.first().innerText());
  return null;
}

/** Click at a fraction of the canvas box (default centre). Returns the pixel used. */
export async function clickCanvas(page: Page, fx = 0.5, fy = 0.5) {
  const box = await S.canvas(page).boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  return { x, y };
}

/** The ask panel floats next to the selected pin and can sit on top of the next click target: close it. */
export async function closeAsk(page: Page) {
  const x = page.getByRole('button', { name: /close ask panel/i });
  if (await x.count()) await x.first().click();
}

export async function selectPoint(page: Page, fx: number, fy: number): Promise<LatLon> {
  const before = await readSelected(page);
  await closeAsk(page);
  await clickCanvas(page, fx, fy);
  let got: LatLon | null = null;
  await expect
    .poll(async () => {
      got = await readSelected(page);
      return got !== null && (!before || got.lat !== before.lat || got.lon !== before.lon);
    }, { message: 'selected-point coordinates should appear / change after clicking the terrain', timeout: 15_000 })
    .toBe(true);
  return got!;
}

/** Drag on empty terrain to orbit the camera. */
export async function orbitDrag(page: Page, from: [number, number], to: [number, number]) {
  const box = await S.canvas(page).boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const [x0, y0] = [box.x + box.width * from[0], box.y + box.height * from[1]];
  const [x1, y1] = [box.x + box.width * to[0], box.y + box.height * to[1]];
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 8 });
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** Route id shown in the drawer header ("R3 · round trip"), or null. */
export async function drawerRouteId(page: Page): Promise<string | null> {
  const d = S.routeDrawer(page);
  if (!(await d.count())) return null;
  const m = (await d.first().innerText()).match(/\bR(\d+)\b/);
  return m ? `R${m[1]}` : null;
}

/** The drawer's <dl>: label → value text, e.g. { Length: "3.42 km", "Max slope": "12.1°" }. */
export async function routeMetrics(page: Page): Promise<Record<string, string>> {
  const d = S.routeDrawer(page).first();
  const dts = await d.locator('dl dt').allInnerTexts();
  const dds = await d.locator('dl dd').allInnerTexts();
  const out: Record<string, string> = {};
  dts.forEach((k, i) => { out[k.trim()] = (dds[i] ?? '').trim(); });
  return out;
}

export const metricsSig = (m: Record<string, string>) => JSON.stringify(m);

/** Click "Plan round trip…", wait for a NEW route id to appear in the drawer, return its metrics. */
export async function planAndWait(page: Page) {
  const prev = await drawerRouteId(page);
  const btn = S.planButton(page);
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect.poll(() => drawerRouteId(page), { message: 'a new route should open in the drawer', timeout: 30_000 }).not.toBe(prev);
  await expect(S.routeDrawer(page).locator('dl')).toBeVisible();
  return routeMetrics(page);
}

/** Expand a collapsed HUD section (Section in ui.tsx: <button aria-expanded=false>Title</button>). */
export async function expandSection(page: Page, name: RegExp) {
  const h = S.mapSectionHeader(page, name);
  if (await h.count()) await h.first().click();
}
