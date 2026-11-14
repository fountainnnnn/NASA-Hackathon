/**
 * Acceptance tests for the Survey Reticle UI (deterministic; the copilot LLM is never called).
 * Markup assumptions live in selectors.ts. Needs WebGL: see playwright.config.ts launch args.
 */
import { expect, test } from '@playwright/test';
import * as H from './helpers';
import * as S from './selectors';

test.describe.configure({ timeout: 240_000 });

test.describe('MarsWalk Copilot', () => {
  test('intro: credits shown, Start dismisses it and it stays dismissed', async ({ page }) => {
    await page.goto('/?qa=1');
    await expect(S.introDialog(page)).toBeVisible();
    await expect(page.getByText('Made by Ng Yu Hang, team Ecliptical.')).toBeVisible();
    await expect(page.getByText(/Interplanetary Survival Guide: Martian Map/)).toBeVisible();
    await S.introStart(page).click();
    await expect(S.introStart(page)).toBeHidden();
    await page.reload();
    await expect(S.introStart(page)).toBeHidden();
  });

  test('globe: no console errors, click makes Scout speak real conditions', async ({ page }) => {
    const log = H.collectErrors(page);
    await H.gotoApp(page);
    await H.clickCanvas(page, 0.5, 0.45);
    await expect(S.bubble(page)).toBeVisible({ timeout: 15_000 });
    await expect(S.bubble(page)).toContainText(/Elevation|No elevation data/);
    await expect(S.verb(page, 'Could we land here?')).toBeVisible();
    await expect(S.verb(page, 'Take me to Jezero')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(S.bubble(page)).toBeHidden();
    expect(log.errors.filter((e) => !/404|landing_criteria|edl_mars2020/.test(e)), log.errors.join('\n')).toEqual([]);
  });

  test('sources sheet lists NASA and USGS datasets with links, the 708 waypoint line and AI disclosure', async ({ page }) => {
    await H.gotoApp(page);
    await S.sourcesButton(page).click();
    const dlg = S.sourcesDialog(page);
    await expect(dlg).toBeVisible();
    const hrefs = await dlg.locator('a[href^="http"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    expect(hrefs.some((h) => /nasa\.gov/.test(h))).toBe(true);
    expect(hrefs.some((h) => /usgs\.gov/.test(h))).toBe(true);
    await expect(dlg).toContainText('708');
    await expect(dlg).toContainText('Scout art: AI-generated SVG');
    await expect(dlg).toContainText('LLM via OpenRouter');
    await S.sourcesClose(page).click();
    await expect(dlg).toBeHidden();
  });

  test('layers popover toggles a globe layer', async ({ page }) => {
    await H.gotoApp(page);
    await S.layersButton(page).click();
    const box = page.getByLabel('Hydrogen');
    await box.check();
    expect(await page.evaluate("window.__mw.globe.getState().layers.hydrogen")).toBe(true);
    await box.uncheck();
  });

  test('jezero: drag from the base plans a round trip and Scout speaks a one-word verdict', async ({ page }) => {
    const log = H.collectErrors(page);
    await H.gotoApp(page);
    await H.enterJezero(page);
    const base = await H.baseScreen(page);
    await H.drag(page, base, { x: base.x + 130, y: base.y - 30 });
    await expect(S.verdictWord(page)).toBeVisible({ timeout: 30_000 });
    await expect(S.bubble(page)).toContainText(/round trip/);
    await expect(S.verb(page, 'Cuff card')).toBeVisible();
    await S.verb(page, 'Cuff card').click();
    await expect(page.getByRole('region', { name: 'Cuff card' })).toBeVisible();
    expect(log.errors.filter((e) => !/404|landing_criteria|edl_mars2020/.test(e)), log.errors.join('\n')).toEqual([]);
  });

  test('mission limits popover changes a constraint', async ({ page }) => {
    await H.gotoApp(page);
    await H.enterJezero(page);
    await S.limitsButton(page).click();
    const slider = page.getByLabel('Max slope');
    await slider.fill('25');
    expect(await page.evaluate("window.__mw.world.getState().constraints.maxSlopeDeg")).toBe(25);
  });
});
