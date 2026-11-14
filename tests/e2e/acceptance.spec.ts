/**
 * Handoff section 8 acceptance tests (UI-driven, deterministic; no AI needed except the @live test).
 * Markup assumptions live in selectors.ts. Needs WebGL: see playwright.config.ts launch args.
 */
import { expect, test } from '@playwright/test';
import * as H from './helpers';
import * as S from './selectors';

const LAT = [18.21, 18.73], LON = [77.16, 77.70]; // DEM bounds (public/data/dem_meta.json) with a little slack

test.describe.configure({ timeout: 180_000 });

test.describe('MarsWalk Copilot acceptance', () => {
  test('intro: first visit shows the welcome dialog, "Start exploring" dismisses it and it stays dismissed', async ({ page }) => {
    await H.gotoApp(page, { intro: true });
    await expect(S.introDialog(page)).toBeVisible();
    await S.introStart(page).click();
    await expect(S.introDialog(page)).toBeHidden();
    await page.reload();
    await H.waitSceneReady(page);
    await expect(S.introDialog(page)).toBeHidden();
  });

  test('loads: no console errors, terrain canvas, >=4 NASA/USGS sources with links (#1, #9)', async ({ page }) => {
    const log = H.collectErrors(page);
    await H.gotoApp(page);
    const box = await S.canvas(page).boundingBox();
    expect(box && box.width > 300 && box.height > 300, 'canvas should be large').toBeTruthy();

    await S.sourcesButton(page).click();
    const dlg = S.sourcesDialog(page);
    await expect(dlg).toBeVisible();
    const hrefs = await dlg.locator('a[href^="http"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
    expect(hrefs.length, `distinct source links: ${hrefs.join(', ')}`).toBeGreaterThanOrEqual(4);
    expect(hrefs.some((h) => /nasa\.gov/.test(h)), 'a NASA link').toBe(true);
    expect(hrefs.some((h) => /usgs\.gov/.test(h)), 'a USGS link').toBe(true);
    await S.sourcesClose(page).click();
    await expect(dlg).toBeHidden();
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  test('pick: click gives in-bounds lat/lon and a pin; orbit does not move it (#2)', async ({ page }) => {
    await H.gotoApp(page);
    const a = await H.selectPoint(page, 0.5, 0.5);
    expect(a.lat).toBeGreaterThan(LAT[0]); expect(a.lat).toBeLessThan(LAT[1]);
    expect(a.lon).toBeGreaterThan(LON[0]); expect(a.lon).toBeLessThan(LON[1]);
    await expect(S.selectedPinLabel(page).first()).toBeAttached();

    await H.orbitDrag(page, [0.4, 0.75], [0.5, 0.6]);
    const after = await H.readSelected(page);
    expect(after, 'readout after orbit').toEqual(a); // stored lon/lat identical, not re-picked
    await expect(S.selectedPinLabel(page).first()).toBeAttached();
  });

  test('deterministic route A then B: metrics shown, no stale A result (#4, #5)', async ({ page }) => {
    await H.gotoApp(page);
    const a = await H.selectPoint(page, 0.5, 0.5);
    const ma = await H.planAndWait(page);
    for (const k of [/length/i, /ascent/i, /max slope/i, /battery/i]) {
      const key = Object.keys(ma).find((x) => k.test(x));
      expect(key, `metric ${k} present in ${JSON.stringify(ma)}`).toBeTruthy();
      expect(ma[key!]).toMatch(/\d/);
    }
    const b = await H.selectPoint(page, 0.38, 0.62);
    expect(b).not.toEqual(a);
    const mb = await H.planAndWait(page);
    expect(H.metricsSig(mb), 'B metrics must differ from A (no stale result)').not.toEqual(H.metricsSig(ma));
  });

  test('constraints: tightest max slope changes the result or explains infeasibility (#6)', async ({ page }) => {
    await H.gotoApp(page);
    await H.selectPoint(page, 0.5, 0.5);
    const base = await H.planAndWait(page);
    await H.expandSection(page, /mission/i);
    const slider = S.maxSlope(page);
    await slider.fill(String(await slider.getAttribute('min') ?? '5'));
    const tight = await H.planAndWait(page);
    const infeasible = await S.routeDrawer(page).getByText(S.NOT_FEASIBLE).first().isVisible().catch(() => false);
    expect(
      infeasible || H.metricsSig(tight) !== H.metricsSig(base),
      `tight slope must change metrics or show a reason.\nbase=${H.metricsSig(base)}\ntight=${H.metricsSig(tight)}`,
    ).toBe(true);
  });

  test('steepest: "Show steepest stretch" adds a hazard callout (#7)', async ({ page }) => {
    await H.gotoApp(page);
    await H.selectPoint(page, 0.5, 0.5);
    await H.planAndWait(page);
    await expect(S.steepestButton(page)).toBeEnabled();
    await S.steepestButton(page).click();
    // Pin labels are drei <Html> overlays; occlusion may hide them visually, so assert presence in the DOM.
    await expect(page.locator('main').getByText(S.HAZARD_LABEL).first()).toBeAttached({ timeout: 15_000 });
  });

  test('layers: THEMIS and Geology toggle and show source info (#8)', async ({ page }) => {
    await H.gotoApp(page);
    await H.expandSection(page, /layers/i);
    for (const [name, src] of [[S.LAYER_THEMIS, S.SRC_THEMIS], [S.LAYER_GEOLOGY, S.SRC_GEOLOGY]] as const) {
      const sw = S.layerSwitch(page, name).first();
      await expect(sw, `layer switch ${name}`).toBeVisible();
      await expect(sw).toBeEnabled();
      const before = await sw.isChecked();
      await sw.setChecked(!before, { force: true });
      expect(await sw.isChecked()).toBe(!before);
      await sw.setChecked(before, { force: true });
      expect(await sw.isChecked()).toBe(before);
      // provenance badge / title in the row, and credit + link in Sources
      await S.sourcesButton(page).click();
      const dlg = S.sourcesDialog(page);
      await expect(dlg.getByText(src).first()).toBeVisible();
      await expect(dlg.locator('a[href^="http"]').first()).toBeVisible();
      await S.sourcesClose(page).click();
    }
  });

  test('refresh: reload works without console errors (#9)', async ({ page }) => {
    const log = H.collectErrors(page);
    await H.gotoApp(page);
    await page.reload();
    await H.waitSceneReady(page);
    await H.selectPoint(page, 0.5, 0.5); // still interactive after reload
    expect(log.errors, log.errors.join('\n')).toEqual([]);
  });

  // Costs money (LLM proxy). Opt in: E2E_LIVE_AGENT=1
  test('@live agent: "What\'s here?" shows trace + answer; "Plan a round trip here" draws a route (#3, #4)', async ({ page }) => {
    test.skip(process.env.E2E_LIVE_AGENT !== '1', 'set E2E_LIVE_AGENT=1 to run (paid LLM calls)');
    test.setTimeout(240_000);
    await H.gotoApp(page);
    await H.selectPoint(page, 0.5, 0.5);
    await H.ensureAskOpen(page);
    const ask = async (q: string) => {
      await S.askInput(page).fill(q);
      await S.askSend(page).click();
    };
    // The exact string "What's here?" is short-circuited to a deterministic tool (no LLM); extend it so the LLM path runs.
    const n0 = await S.botMessages(page).count();
    await ask("What's here? What am I looking at?");
    await expect(S.traceSteps(page).first()).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => S.botMessages(page).count(), { timeout: 90_000 }).toBeGreaterThan(n0);
    expect((await S.botMessages(page).last().innerText()).length).toBeGreaterThan(20);

    const before = await H.drawerRouteId(page);
    await ask('Plan a round trip here');
    await expect(S.routeDrawer(page)).toBeVisible({ timeout: 90_000 });
    await expect.poll(() => H.drawerRouteId(page), { timeout: 90_000 }).not.toBe(before);
  });
});
