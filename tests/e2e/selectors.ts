/**
 * ONE place for every assumption the e2e suite makes about the app's markup (HeyMars shell, MarsAgent card and panel).
 * If a test fails with "locator not found", fix the locator here, not in the spec.
 * Pages are opened with ?qa=1, which exposes window.__mw (stores, projectors, ask, ready) from AppShell.tsx.
 */
import type { Locator, Page } from '@playwright/test';

export const INTRO_SEEN_KEY = 'marswalk-intro-seen';
export const PANEL_KEY = 'heymars-panel-open';
/** Intro.tsx: start card, role=dialog labelled by its h1. */
export const introDialog = (p: Page): Locator => p.getByRole('dialog', { name: /heymars/i });
export const introStart = (p: Page): Locator => p.getByRole('button', { name: 'Start', exact: true });

/** The map stage (data-stage) and its first WebGL canvas (the Cesium planet, or the Jezero scene). */
export const stage = (p: Page): Locator => p.locator('[data-stage]');
export const canvas = (p: Page): Locator => p.locator('[data-stage] canvas').first();

/** Top bar (HUD/TopBar.tsx). */
export const topBar = (p: Page): Locator => p.locator('header').first();
export const clock = (p: Page): Locator => p.getByRole('group', { name: 'Mission clock' });
export const panelToggle = (p: Page): Locator => p.getByRole('button', { name: 'MarsAgent panel', exact: true });

/** Tool rail (HUD/Rail.tsx): buttons have id rail-<tool>. */
export const rail = (p: Page): Locator => p.getByRole('navigation', { name: 'Tools' });
export const railTool = (p: Page, id: string): Locator => p.locator(`#rail-${id}`);
export const sourcesDialog = (p: Page): Locator => p.getByRole('dialog', { name: /where every number comes from/i });
export const sourcesClose = (p: Page): Locator => p.getByRole('button', { name: /close sources/i });

/** MarsAgent on the map (Companion/MapCard.tsx): role=dialog "MarsAgent". Action buttons are plain buttons inside it. */
export const card = (p: Page): Locator => p.getByRole('dialog', { name: 'MarsAgent', exact: true });
export const cardAction = (p: Page, name: string): Locator => card(p).getByRole('button', { name, exact: true });
/** MarsAgent panel (Companion/Panel.tsx). */
export const panel = (p: Page): Locator => p.locator('#marsagent-panel');
export const thread = (p: Page): Locator => panel(p).getByRole('log', { name: 'MarsAgent thread' });
export const lastTurn = (p: Page): Locator => thread(p).locator('article').last();
export const composer = (p: Page): Locator => p.getByRole('textbox', { name: 'Ask MarsAgent about the plan or the maths' });
export const reportOpen = (p: Page): Locator => lastTurn(p).getByRole('button', { name: 'Open', exact: true });
export const reportViewer = (p: Page): Locator => p.getByRole('dialog', { name: 'Mission planning report' });

export const VERDICT = /^(GO|HOLD|NO GO)$/;

/** Console messages that are not app errors. Keep this list short and justified. */
export const IGNORED_CONSOLE: RegExp[] = [
  /favicon/i,
  /Download the React DevTools/i,
  /GL Driver Message/i, // swiftshader performance notes
];

export const mastField = (p: Page): Locator => p.getByLabel('Comms mast height (m)');
