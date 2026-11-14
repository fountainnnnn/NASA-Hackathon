/**
 * Regression checks for QA round 2 (docs/QA_ROUND_2.md): a GO verdict is reachable end to end in the default demo
 * (drag from the base, NO GO for a radio shadow, "Raise mast to 20 m", GO), the default EVA start is 09:00 local solar
 * time, and blockers carry the same number on the card as on the map. Deterministic: verbs only, no language model.
 */
import { expect, test, type Page } from '@playwright/test';
import * as H from './helpers';
import * as S from './selectors';

test.describe.configure({ timeout: 300_000 });

/** Delta target 2.9 km ENE of the base: the 10 m mast leaves a 2.2 km radio shadow, a 20 m mast sees the whole route. */
const GO_TARGET = { lon: 77.49357, lat: 18.47162 };

const cardRows = (page: Page) => S.card(page).locator('table tr').evaluateAll((trs) => trs.map((tr) => ({
  label: tr.querySelector('th')?.textContent?.trim() ?? '',
  value: tr.querySelector('td')?.textContent?.trim() ?? '',
  tone: tr.querySelector('[role="img"]')?.getAttribute('aria-label') ?? 'none',
}))) as Promise<{ label: string; value: string; tone: string }[]>;

const verdict = (page: Page) => page.evaluate('(() => { const v = window.__mw.hud.getState().verdict; return v ? { word: v.word, reason: v.reason } : null; })()') as Promise<{ word: string; reason: string } | null>;

test.describe('QA round 2', () => {
  test('GO path: drag to the delta target, NO GO for comms, Raise mast to 20 m, GO', async ({ page }) => {
    await H.gotoApp(page);
    // the default EVA start is the next 09:00 local true solar time at the base (Mars24)
    const ltst = await page.evaluate("(() => { const m = window.__mw; return m.hud.getState().startUtcMs; })()") as number;
    expect(ltst).toBeGreaterThan(Date.now() - 60_000);
    await H.enterJezero(page);
    await S.railTool(page, 'limits').click();
    await expect(page.getByRole('group', { name: 'Mission limits' })).toContainText(/Start, local solar time\s*09:00:0\d/);
    await page.keyboard.press('Escape');

    // 1. drag from the base to the target (as a user would); the pointer lands within a few metres of it
    const base = await H.baseScreen(page);
    const to = await page.evaluate((t) => (window as unknown as { __mw: { projectJezero(p: unknown): { x: number; y: number; visible: boolean } } }).__mw.projectJezero(t), GO_TARGET);
    expect(to.visible).toBe(true);
    const before = await H.turnCount(page);
    await page.mouse.move(base.x, base.y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(base.x + ((to.x - base.x) * i) / 12, base.y + ((to.y - base.y) * i) / 12); await page.waitForTimeout(90); }
    await page.waitForTimeout(500);
    await page.mouse.up();
    await H.waitTurnDone(page, before);

    // 2. NO GO, and the only reason is the radio shadow from the 10 m mast; it is issue 1 on the card and on the map
    const v1 = await verdict(page);
    expect(v1?.word).toBe('NO GO');
    expect(v1?.reason).toMatch(/^Radio shadow of \d+\.\d km with no line of sight to base from a 10 m mast\.$/);
    await expect(S.card(page).getByText('NO GO', { exact: true })).toBeVisible();
    const r1 = await cardRows(page);
    const comms1 = r1.find((r) => /comms shadow/.test(r.label))!;
    expect(comms1.label).toBe('1. Longest comms shadow / limit');
    expect(comms1.tone).toBe('fails a limit');
    expect(r1.filter((r) => r.tone === 'fails a limit')).toHaveLength(1);
    const ann = await page.evaluate("window.__mw.world.getState().annotations.filter((a) => a.kind === 'highlight').map((a) => a.label)") as string[];
    expect(ann).toHaveLength(1);
    expect(ann[0]).toMatch(/^Radio shadow /);
    const mast = S.cardAction(page, 'Raise mast to 20 m');
    await expect(mast).toBeVisible();
    console.log('GO path, before:', JSON.stringify({ verdict: v1, rows: r1 }));

    // 3. Raise the mast: the replan is GO with every row inside its limit, no blocker numbers and no mast button
    const b2 = await H.turnCount(page);
    await mast.click();
    await H.waitTurnDone(page, b2);
    const v2 = await verdict(page);
    expect(v2).toEqual({ word: 'GO', reason: 'Every limit holds.' });
    expect(await page.evaluate('window.__mw.hud.getState().mastHeightM')).toBe(20);
    await expect(S.card(page).getByText('GO', { exact: true })).toBeVisible();
    await expect(S.card(page)).toContainText('Every limit holds');
    const r2 = await cardRows(page);
    expect(r2.some((r) => r.tone === 'fails a limit' || r.tone === 'caution')).toBe(false);
    expect(r2.some((r) => /^\d\. /.test(r.label))).toBe(false);
    await expect(S.card(page).getByRole('button', { name: /mast/i })).toHaveCount(0);
    await expect(S.lastTurn(page)).toContainText('GO.');
    console.log('GO path, after:', JSON.stringify({ verdict: v2, rows: r2 }));
  });
});
