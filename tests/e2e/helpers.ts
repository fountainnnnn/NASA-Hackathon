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

/** Open the app (intro skipped unless asked) and wait until the globe canvas and the global data are up. */
export async function gotoApp(page: Page, opts: { intro?: boolean } = {}) {
  if (!opts.intro) await page.addInitScript((k) => { try { localStorage.setItem(k, '1'); } catch { /* ignore */ } }, S.INTRO_SEEN_KEY);
  await page.goto('/?qa=1');
  await expect(S.canvas(page)).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction("window.__mw && window.__mw.globe.getState().status === 'ready'", null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
}

/** Fly into Jezero with the same command Scout's verb sends, and wait for the 20 m scene and the base marker. */
export async function enterJezero(page: Page) {
  await page.evaluate("window.__mw.globe.getState().applyGlobeCommands([{ type: 'enter_jezero' }])");
  await page.waitForFunction("window.__mw.globe.getState().mode === 'jezero' && window.__mw.projectJezero({lon: window.__mw.world.getState().base.lon, lat: window.__mw.world.getState().base.lat}).visible", null, { timeout: 150_000 });
  await page.waitForTimeout(2500);
}

export interface Pt { x: number; y: number }
/** Screen position of the base habitat in Jezero mode. */
export async function baseScreen(page: Page): Promise<Pt> {
  return page.evaluate("(() => { const w = window.__mw, b = w.world.getState().base; return w.projectJezero({ lon: b.lon, lat: b.lat }); })()") as Promise<Pt>;
}

/** Press, drag in small steps (so the live preview fires) and release. */
export async function drag(page: Page, from: Pt, to: Pt, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await page.waitForTimeout(90); }
  await page.waitForTimeout(600);
  await page.mouse.up();
}

export async function clickCanvas(page: Page, fx = 0.5, fy = 0.5) {
  const box = await S.canvas(page).boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  return { x, y };
}
