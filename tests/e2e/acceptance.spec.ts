/**
 * Acceptance tests for the HeyMars shell and MarsAgent (deterministic: every question here is a verb or a maths follow-up,
 * so the language model is never called). Markup assumptions live in selectors.ts. Needs WebGL: see playwright.config.ts.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import * as H from './helpers';
import * as S from './selectors';

test.describe.configure({ timeout: 300_000 });
const SAMPLES = 'deliverables/report-samples';
const allowed = (errs: string[]) => errs.filter((e) => !/404|landing_criteria|edl_mars2020/.test(e));

test.describe('HeyMars', () => {
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

  test('shell: 40 px top bar with clock and byline, 56 px rail with ten labelled tools, no report button, no old names', async ({ page }) => {
    await H.gotoApp(page);
    const top = await S.topBar(page).boundingBox();
    expect(Math.round(top!.height)).toBe(40);
    await expect(S.topBar(page)).toContainText('HEYMARS');
    await expect(S.topBar(page)).toContainText('Ng Yu Hang, team Ecliptical');
    for (const l of ['Mission time', 'Local solar time', 'Sun elevation', 'Earth light delay']) await expect(S.clock(page)).toContainText(l);
    await expect(S.topBar(page).getByRole('button', { name: /report/i })).toHaveCount(0);
    const rail = await S.rail(page).boundingBox();
    expect(Math.round(rail!.width)).toBe(56);
    for (const id of ['plan', 'lasso', 'landing', 'walk', 'helmet', 'reach', 'layers', 'limits', 'sources', 'cuff']) {
      await expect(S.railTool(page, id)).toBeVisible();
      await expect(page.locator(`#tip-${id}`)).toHaveAttribute('role', 'tooltip');
    }
    await S.railTool(page, 'reach').hover();
    await expect(page.locator('#tip-reach')).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/\bScout\b|\bCopilot\b/i);
    expect(text).not.toMatch(/—|·/);
  });

  test('panel toggle collapses the MarsAgent panel and the state survives a reload', async ({ page }) => {
    await H.gotoApp(page);
    await expect(S.panel(page)).toBeVisible();
    await S.panelToggle(page).click();
    await expect(S.panel(page)).toBeHidden();
    await page.reload();
    await page.waitForFunction('window.__mw && window.__mw.ready()', null, { timeout: 120_000 });
    await expect(S.panel(page)).toBeHidden();
    await S.panelToggle(page).click();
    await expect(S.panel(page)).toBeVisible();
  });

  test('globe click: compact card on the map and the same turn in the panel, tagged with where it was asked', async ({ page }) => {
    const log = H.collectErrors(page);
    await H.gotoApp(page);
    await H.clickStage(page, 0.5, 0.5);
    await expect(S.card(page)).toBeVisible();
    const box = await S.card(page).boundingBox();
    expect(Math.round(box!.width)).toBe(300);
    await expect(S.card(page).locator('table tr')).not.toHaveCount(0);
    await expect(S.cardAction(page, 'Landing check')).toBeVisible();
    await expect(S.lastTurn(page)).toContainText(/Asked on the map at \d+\.\d{4}[NS] \d+\.\d{4}[EW]/);
    await expect(S.lastTurn(page).locator('ol li').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(S.card(page)).toBeHidden();
    expect(allowed(log.errors), log.errors.join('\n')).toEqual([]);
  });

  test('landing check streams narration with elapsed times and a report card', async ({ page }) => {
    await H.gotoApp(page);
    await H.clickStage(page, 0.5, 0.45);
    const before = await H.turnCount(page);
    await S.cardAction(page, 'Landing check').click();
    await H.waitTurnDone(page, before);
    const turn = S.lastTurn(page);
    await expect(turn).toContainText('Could we land here?');
    await expect(turn.locator('ol li').first()).toContainText('Checked 8 landing criteria');
    // each line shows its OWN measured time, and none under 5 ms (instant work carries no number)
    const times = await turn.locator('ol[aria-label="What MarsAgent is doing"] li').evaluateAll((lis) => lis.map((li) => li.lastElementChild?.textContent ?? ''));
    // only the time cells (short "N ms" / "N.NN s" values); narration text without a time is skipped
    for (const t of times.map((x) => x.trim()).filter((x) => /^[\d.,]+ (ms|s)$/.test(x))) expect(t).toMatch(/^([5-9]|\d{2,}) ms$|^\d+(\.\d\d)? s$/);
    await expect(turn.getByText('Mission planning report')).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/fails-some|meets-all|insufficient-data/);
  });

  test('jezero: drag from the base plans a round trip; card verdict, formulas with real numbers, maths follow-up recomputes', async ({ page }) => {
    const log = H.collectErrors(page);
    await H.gotoApp(page);
    await H.enterJezero(page);
    const base = await H.baseScreen(page);
    await H.dragPlan(page, base, { x: base.x - 140, y: base.y - 35 });
    await expect(S.card(page)).toBeVisible();
    await expect(S.card(page).getByText(S.VERDICT)).toBeVisible();
    await expect(S.card(page).locator('table tr')).toHaveCount(6);
    const turn = S.lastTurn(page);
    await expect(turn).toContainText('Dragged on the map to');
    await turn.locator('summary', { hasText: 'How I worked it out' }).click();
    await expect(turn.getByText(/used = P × t ÷ C = 250 W × [\d.]+ h ÷ 2,000 Wh = [\d.]+ %/)).toBeVisible();
    await expect(turn.getByText(/curvature drop = d² ÷ 2R/)).toBeVisible();
    await turn.getByRole('button', { name: 'Raw JSON' }).first().click();
    await expect(turn.getByLabel('plan_round_trip raw JSON')).toContainText('"constraints"');
    // maths follow-up typed in the panel: deterministic recomputation, no model
    await S.composer(page).fill('What if the suit draws 300 W?');
    const before = await H.turnCount(page);
    await S.composer(page).press('Enter');
    await H.waitTurnDone(page, before);
    const f = S.lastTurn(page);
    await expect(f).toContainText('Asked in the panel');
    await expect(f).toContainText('Recomputed battery at 300 W');
    await expect(f).toContainText('fixed code');
    await expect(f.getByLabel('Recomputed battery at 300 W', { exact: true })).toContainText('used = P × t ÷ C = 300 W');
    expect(allowed(log.errors), log.errors.join('\n')).toEqual([]);
  });

  test('report: viewer scrolls inside its own container, the page is locked, and every export downloads a real file', async ({ page }) => {
    mkdirSync(SAMPLES, { recursive: true });
    await H.gotoApp(page);
    // a landing check and a landing simulation in the same session belong in the report too
    await H.clickStage(page, 0.5, 0.45);
    const before = await H.turnCount(page);
    await S.cardAction(page, 'Landing check').click();
    await H.waitTurnDone(page, before);
    await H.ask(page, 'Run landing simulation', 'tool', 120_000);
    await page.waitForFunction("window.__mw.playback.getState().t > 0", null, { timeout: 60_000 });
    await expect(S.clock(page)).not.toContainText('T+00:00:00'); // the mission clock runs with the simulation
    await H.enterJezero(page);
    await expect(S.clock(page)).toContainText('T+00:00:00'); // and resets once the simulation is gone (QA 1.7, 6.2)
    const base = await H.baseScreen(page);
    await H.dragPlan(page, base, { x: base.x - 140, y: base.y - 35 });
    await S.reportOpen(page).click();
    const viewer = S.reportViewer(page);
    await expect(viewer).toBeVisible();
    for (const t of ['Summary and verdict', 'Inputs and constraints', 'Route legs', 'Calculations', 'Go / no-go rules', 'Data sources and validation', 'Assumptions and limits', 'Agent trace']) {
      await expect(viewer.locator('nav').getByRole('button', { name: new RegExp(t) })).toBeVisible();
    }
    expect(await page.evaluate('getComputedStyle(document.documentElement).overflow')).toBe('hidden');
    const scroller = viewer.locator('[data-report-scroll]');
    await scroller.hover();
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(500);
    // the document scrolls inside the viewer (the paper's own container or a scrolling ancestor within the viewer), never the page
    await expect.poll(async () => viewer.evaluate((root) => Math.max(...[root, ...root.querySelectorAll('*')].map((el) => (el as HTMLElement).scrollTop))), { timeout: 3_000 }).toBeGreaterThan(300);
    expect(await page.evaluate('window.scrollY')).toBe(0);
    const toolbar = await viewer.getByRole('button', { name: 'Close' }).boundingBox();
    expect(toolbar!.y).toBeLessThan(52);
    await viewer.locator('nav').getByRole('button', { name: /Calculations/ }).click();
    await expect(viewer.locator('#rep-calculations')).toBeInViewport();

    const grab = async (name: string, file: string) => {
      const [d] = await Promise.all([page.waitForEvent('download'), viewer.getByRole('button', { name, exact: true }).click()]);
      const path = `${SAMPLES}/${file}`;
      await d.saveAs(path);
      return readFileSync(path, 'utf8');
    };
    const md = await grab('Markdown', 'heymars-report-sample.md');
    expect(md).toMatch(/## 4\. Calculations/);
    expect(md).toContain('used = P × t ÷ C');
    expect(md).toContain('| Landing criterion |');
    expect(md).toContain('| Landing simulation |');
    expect(md).toMatch(/7\.7 by 6\.6 km \(semi-axes 3\.85 and 3\.3 km\)/);
    expect(md).toContain('| Science at target |');
    // every trace row has a time: a clock time, a measured duration or "under 1 ms"
    const trace = md.split('## 8. Agent trace')[1].split('\n').filter((l) => /^\| \d+ \|/.test(l));
    expect(trace.length).toBeGreaterThan(5);
    for (const row of trace) expect(row.split('|').at(-2)!.trim(), row).not.toBe('');
    const json = JSON.parse(await grab('JSON', 'heymars-report-sample.json'));
    expect(json.schema).toBe('heymars.report.v1');
    expect(json.landingCheck).not.toBeNull();
    expect(json.landingScenario).not.toBeNull();
    expect(json.toolCalls.some((c: { name: string }) => c.name === 'plan_round_trip')).toBe(true);
    const geo = JSON.parse(await grab('GeoJSON route', 'heymars-route-sample.geojson'));
    const leg = geo.features.find((f: { properties: { leg?: string } }) => f.properties.leg === 'outbound');
    expect(leg.geometry.coordinates[0]).toHaveLength(3);

    // PDF: the print stylesheet prints the report alone
    await page.emulateMedia({ media: 'print' });
    expect(await page.evaluate("getComputedStyle(document.querySelector('main.app')).display")).toBe('none');
    expect(await page.evaluate("getComputedStyle(document.querySelector('[data-report-chrome]')).display")).toBe('none');
    await page.pdf({ path: `${SAMPLES}/heymars-report-sample.pdf`, format: 'A4', printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(viewer).toBeHidden();
    expect(await page.evaluate('document.querySelector("main.app").hasAttribute("inert")')).toBe(false);
  });

  test('walk: two astronauts on the route and the 46 px timeline; helmet view shows the helmet display', async ({ page }) => {
    await H.gotoApp(page);
    await H.enterJezero(page);
    const base = await H.baseScreen(page);
    await H.dragPlan(page, base, { x: base.x - 140, y: base.y - 35 });
    const meshes = () => page.evaluate('(() => { let n = 0; window.__mw.three.scene.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; })()') as Promise<number>;
    const before = await meshes();
    await S.railTool(page, 'walk').click();
    await page.waitForFunction('window.__mw.hud.getState().walkOn');
    await page.waitForTimeout(2000);
    const tl = page.getByRole('group', { name: 'Timeline' });
    await expect(tl).toBeVisible();
    expect(Math.round((await tl.boundingBox())!.height)).toBe(46);
    // two suited astronauts are real meshes in the scene (each body is a dozen or more parts); the lead carries a tag
    expect((await meshes()) - before).toBeGreaterThanOrEqual(20);
    await expect(page.getByText('Crew 1', { exact: true })).toBeAttached();
    await S.railTool(page, 'helmet').click();
    await expect(page.getByLabel('Helmet display')).toBeVisible();
    await page.getByRole('button', { name: 'Exit helmet view' }).click();
    await expect(page.getByLabel('Helmet display')).toBeHidden();
  });

  test('sources sheet lists NASA and USGS datasets with links, the 708 waypoint line and the AI disclosure', async ({ page }) => {
    await H.gotoApp(page);
    await S.railTool(page, 'sources').click();
    const dlg = S.sourcesDialog(page);
    await expect(dlg).toBeVisible();
    const hrefs = await dlg.locator('a[href^="http"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
    expect(hrefs.some((h) => /nasa\.gov/.test(h))).toBe(true);
    expect(hrefs.some((h) => /usgs\.gov/.test(h))).toBe(true);
    await expect(dlg).toContainText('708');
    await expect(dlg).toContainText('MarsAgent reticle and map symbols: drawn in code');
    await expect(dlg).toContainText('LLM via OpenRouter');
    await S.sourcesClose(page).click();
    await expect(dlg).toBeHidden();
  });

  test('limits popover from the rail changes a constraint and the mast assumption', async ({ page }) => {
    await H.gotoApp(page);
    await S.railTool(page, 'limits').click();
    await page.getByLabel('Max slope').fill('25');
    expect(await page.evaluate('window.__mw.world.getState().constraints.maxSlopeDeg')).toBe(25);
    await page.locator('summary', { hasText: 'Assumptions' }).click();
    await expect(S.mastField(page)).toHaveValue('10');
    await S.mastField(page).fill('20');
    expect(await page.evaluate('window.__mw.hud.getState().mastHeightM')).toBe(20);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Mission limits' })).toBeHidden();
  });
});
