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

/** Open the app (intro skipped unless asked) and wait until the planet is mounted on the stage and the global data loaded. */
export async function gotoApp(page: Page, opts: { intro?: boolean; keepStorage?: boolean } = {}) {
  if (!opts.intro) await page.addInitScript((k) => { try { localStorage.setItem(k, '1'); } catch { /* ignore */ } }, S.INTRO_SEEN_KEY);
  await page.goto('/?qa=1');
  await expect(S.canvas(page)).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction('window.__mw && window.__mw.ready()', null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
}

/** Wait until the newest MarsAgent turn has finished and all of its narration lines are on screen. */
export async function waitTurnDone(page: Page, before: number, timeout = 90_000) {
  await page.waitForFunction((b) => {
    const m = (window as unknown as { __mw: { thread: { getState(): { turns: { id: string; status: string; narration: unknown[] }[] } }; reveal: { getState(): { shown: Record<string, number> } } } }).__mw;
    const ts = m.thread.getState().turns;
    if (ts.length <= b) return false;
    const t = ts[ts.length - 1];
    return t.status !== 'working' && (m.reveal.getState().shown[t.id] ?? 0) >= t.narration.length;
  }, before, { timeout });
}
export const turnCount = (page: Page) => page.evaluate('window.__mw.thread.getState().turns.length') as Promise<number>;

/** Ask through the same event bus the card, the panel and the rail use; waits for the turn to finish. */
export async function ask(page: Page, text: string, origin: 'map' | 'panel' | 'tool' = 'tool', timeout = 90_000) {
  const before = await turnCount(page);
  await page.evaluate(([t, o]) => (window as unknown as { __mw: { ask(t: string, m: unknown): void } }).__mw.ask(t, { origin: o, at: null }), [text, origin]);
  await waitTurnDone(page, before, timeout);
}

/** Fly into Jezero with the rail verb, and wait for the 20 m scene and the base marker. */
export async function enterJezero(page: Page) {
  await ask(page, 'Take me to Jezero', 'tool', 150_000);
  await page.waitForFunction("window.__mw.globe.getState().mode === 'jezero' && window.__mw.projectJezero({lon: window.__mw.world.getState().base.lon, lat: window.__mw.world.getState().base.lat}).visible", null, { timeout: 150_000 });
  await page.waitForTimeout(2500);
}

export interface Pt { x: number; y: number }
/** Screen position of the base habitat in Jezero mode. */
export async function baseScreen(page: Page): Promise<Pt> {
  return page.evaluate("(() => { const w = window.__mw, b = w.world.getState().base; return w.projectJezero({ lon: b.lon, lat: b.lat }); })()") as Promise<Pt>;
}

/** Press, drag in small steps (so the live preview fires) and release; waits for the plan turn. */
export async function dragPlan(page: Page, from: Pt, to: Pt, steps = 10) {
  const before = await turnCount(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await page.waitForTimeout(90); }
  await page.waitForTimeout(600);
  await page.mouse.up();
  await waitTurnDone(page, before);
  // the pointer lands wherever the camera puts it; when that has no walkable path, plan the known delta target instead
  const legs = await page.evaluate('(() => { const m = window.__mw, id = m.hud.getState().activeRouteId; return id ? m.world.getState().routes[id].legs.length : 0; })()') as number;
  if (!legs) {
    const b2 = await turnCount(page);
    await page.evaluate('window.__mw.plan({ lon: 77.3867, lat: 18.4341 })');
    await waitTurnDone(page, b2);
  }
}

export async function clickStage(page: Page, fx = 0.5, fy = 0.5) {
  const box = await S.stage(page).boundingBox();
  if (!box) throw new Error('stage has no bounding box');
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  const before = await turnCount(page);
  // the planet can drop a click while it is still settling after load (seen in the first ~2 s): click again if no turn starts
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
    const started = await page.waitForFunction((b) => (window as unknown as { __mw: { thread: { getState(): { turns: unknown[] } } } }).__mw.thread.getState().turns.length > b, before, { timeout: 8_000 }).then(() => true, () => false);
    if (started) break;
  }
  await waitTurnDone(page, before, 60_000);
  return { x, y };
}
