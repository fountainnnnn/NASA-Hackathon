/**
 * Regression checks for QA round 1 (docs/QA_ROUND_1.md): the half-route bug, the no-path card, red rows that must really
 * fail their limit, round-trip consistency between the solver, the card and the report, and the clock cells.
 * Deterministic: every question is a verb, so the language model is never called.
 */
import { expect, test, type Page } from '@playwright/test';
import * as H from './helpers';
import * as S from './selectors';

test.describe.configure({ timeout: 300_000 });

/** On a 24° planning cell west of the base: outbound used to fail while the return succeeded. */
const STEEP = { lon: 77.41088572, lat: 18.44062715 };

interface CardRow { label: string; value: string; fails: boolean }
const cardRows = (page: Page) => S.card(page).locator('table tr').evaluateAll((trs) => trs.map((tr) => ({
  label: tr.querySelector('th')?.textContent?.trim() ?? '',
  value: tr.querySelector('td')?.textContent?.trim() ?? '',
  fails: !!tr.querySelector('[aria-label="fails a limit"]'),
}))) as Promise<CardRow[]>;

/** A red row's value must be on the wrong side of its own limit ("value / limit"); battery fails below, the rest above. */
function assertRedRowsFail(rows: CardRow[]) {
  for (const r of rows.filter((x) => x.fails)) {
    const m = r.value.match(/(-?[\d,.]+)\s*(km|m|°|%|min)?\s*\/\s*(-?[\d,.]+)\s*(km|m|°|%|min)?/);
    if (!m) continue; // a red row without a limit pair (for example "none up to 45°") states the failure itself
    const toM = (v: string, u?: string) => Number(v.replace(/,/g, '')) * (u === 'km' ? 1000 : 1);
    const v = toM(m[1], m[2]), lim = toM(m[3], m[4] ?? m[2]);
    const fails = /battery/i.test(r.label) ? v < lim : v > lim;
    expect(fails, `red row "${r.label}: ${r.value}" is inside its limit`).toBe(true);
  }
}

const routeState = (page: Page) => page.evaluate(() => {
  const m = (window as unknown as { __mw: any }).__mw; // eslint-disable-line @typescript-eslint/no-explicit-any
  const id = m.hud.getState().activeRouteId;
  const r = id ? m.world.getState().routes[id] : null;
  return r ? { id, legs: r.legs.map((l: { lengthM: number }) => l.lengthM), total: r.totals.lengthM, drawn: m.world.getState().visibleRouteIds.includes(id), min: r.minFeasibleSlopeDeg ?? null, target: r.targetSlopeDeg ?? null } : null;
});

test.describe('QA round 1', () => {
  test('top bar: no local time without a place; mission time is T+00:00:00 with no simulation', async ({ page }) => {
    await H.gotoApp(page);
    await expect(S.clock(page)).toContainText('select a place');
    await expect(S.clock(page)).toContainText('T+00:00:00');
    await H.clickStage(page, 0.5, 0.5);
    await expect(S.clock(page)).not.toContainText('select a place');
    await expect(S.clock(page)).toContainText(/Local solar time, selected\s*\d\d:\d\d/);
  });

  test('a target on steep ground: no route, two rows, Replan and Nearest point; the nearest point plans a consistent round trip', async ({ page }) => {
    await H.gotoApp(page);
    await H.enterJezero(page);
    const before = await H.turnCount(page);
    await page.evaluate((p) => (window as unknown as { __mw: { plan(p: unknown): void } }).__mw.plan(p), STEEP);
    await H.waitTurnDone(page, before);

    const st = await routeState(page);
    expect(st!.legs).toEqual([]);
    expect(st!.total).toBe(0);
    expect(st!.drawn).toBe(false);
    expect(st!.min).toBe(25);
    await expect(S.card(page).getByText('NO GO', { exact: true })).toBeVisible();
    await expect(S.card(page)).toContainText('No path under 15° reaches this point');
    const rows = await cardRows(page);
    expect(rows.map((r) => r.label)).toEqual(['Target slope / limit', 'Smallest limit that works']);
    expect(rows[1].value).toBe('25°');
    assertRedRowsFail(rows);
    await expect(S.cardAction(page, 'Replan at 25°')).toBeVisible();
    await expect(S.cardAction(page, 'Pick nearest reachable point')).toBeVisible();
    for (const gone of ['Walk it', 'Helmet view', 'Cuff card', 'Rover assist']) await expect(S.cardAction(page, gone)).toHaveCount(0);
    await expect(S.card(page).getByRole('button', { name: /mast/i })).toHaveCount(0);
    const narr = await S.lastTurn(page).locator('ol li').allInnerTexts();
    expect(narr.join('\n')).not.toMatch(/Walking time|Suit battery|Line of sight/);

    const b2 = await H.turnCount(page);
    await S.cardAction(page, 'Pick nearest reachable point').click();
    await H.waitTurnDone(page, b2);
    const near = await routeState(page);
    expect(near!.legs).toHaveLength(2);
    expect(near!.total).toBeCloseTo(near!.legs[0] + near!.legs[1], 3);
    expect(near!.drawn).toBe(true);
    await expect(S.lastTurn(page)).toContainText(/Moved the target \d+ m/);
    const r2 = await cardRows(page);
    const trip = r2.find((r) => r.label === 'Round trip')!;
    expect(Number(trip.value.replace(/[^\d.]/g, ''))).toBeCloseTo(Math.round(near!.total / 10) / 100, 2);
    assertRedRowsFail(r2);
    await expect(S.card(page)).toContainText('Science at target');
  });

  test('every plan card: red rows fail their limit, the round trip is the sum of both legs, the mast is offered at most once', async ({ page }) => {
    await H.gotoApp(page);
    await H.enterJezero(page);
    const base = await H.baseScreen(page);
    await H.dragPlan(page, base, { x: base.x - 140, y: base.y - 35 });
    const st = await routeState(page);
    expect(st!.legs).toHaveLength(2);
    expect(st!.total).toBeCloseTo(st!.legs[0] + st!.legs[1], 3);
    assertRedRowsFail(await cardRows(page));
    expect(await S.card(page).getByRole('button', { name: /mast/i }).count()).toBeLessThanOrEqual(1);
    await expect(page.locator('#marsagent-panel').getByRole('button', { name: /mast/i })).toHaveCount(0);
    // the report and the GeoJSON carry the same round trip
    const rep = await page.evaluate(() => (window as unknown as { __mw: { reportInput(): { route: { totals: { lengthM: number }; legs: { lengthM: number }[] } } } }).__mw.reportInput());
    expect(rep.route.totals.lengthM).toBeCloseTo(st!.total, 6);
    expect(rep.route.legs.reduce((a, l) => a + l.lengthM, 0)).toBeCloseTo(st!.total, 6);
    // narration: each line its own time; no line reads as still running once the turn is done
    const states = await S.lastTurn(page).locator('ol[aria-label="What MarsAgent is doing"] li').evaluateAll((lis) => lis.map((li) => li.getAttribute('data-state')));
    expect(states.every((s) => s === 'done')).toBe(true);
  });
});
