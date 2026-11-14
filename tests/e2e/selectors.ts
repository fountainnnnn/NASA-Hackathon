/**
 * ONE place for every assumption the e2e suite makes about the app's markup (Survey Reticle UI).
 * If a test fails with "locator not found", fix the locator here, not in the spec.
 * Pages are opened with ?qa=1, which exposes window.__mw = { hud, globe, world, projectJezero, projectGlobe } (AppShell.tsx).
 */
import type { Locator, Page } from '@playwright/test';

export const INTRO_SEEN_KEY = 'marswalk-intro-seen';
/** Intro.tsx: start card, role=dialog labelled by its h1. */
export const introDialog = (p: Page): Locator => p.getByRole('dialog', { name: /marswalk copilot/i });
export const introStart = (p: Page): Locator => p.getByRole('button', { name: 'Start', exact: true });

/** First WebGL canvas inside <main> (the globe, or the Jezero scene on top of it). */
export const canvas = (p: Page): Locator => p.locator('main canvas').first();

/** Top-right icon row (HUD/Chrome.tsx). */
export const sourcesButton = (p: Page): Locator => p.getByRole('button', { name: 'Sources', exact: true });
export const layersButton = (p: Page): Locator => p.getByRole('button', { name: 'Layers', exact: true });
export const limitsButton = (p: Page): Locator => p.getByRole('button', { name: 'Mission limits', exact: true });
export const sourcesDialog = (p: Page): Locator => p.getByRole('dialog', { name: /where every number comes from/i });
export const sourcesClose = (p: Page): Locator => p.getByRole('button', { name: /close sources/i });

/** Scout's bubble (Companion/Bubble.tsx): role=dialog, aria-label "Scout". Verbs are plain buttons inside it. */
export const bubble = (p: Page): Locator => p.getByRole('dialog', { name: 'Scout', exact: true });
export const verb = (p: Page, name: string): Locator => bubble(p).getByRole('button', { name, exact: true });
export const scoutInput = (p: Page): Locator => p.getByRole('textbox', { name: 'Ask Scout' });

/** Ops/Overlays.tsx VerdictWord: role=status containing GO, HOLD or NO GO. */
export const VERDICT = /^(GO|HOLD|NO GO)$/;
export const verdictWord = (p: Page): Locator => p.locator('[role=status]').getByText(VERDICT);

/** Console messages that are not app errors. Keep this list short and justified. */
export const IGNORED_CONSOLE: RegExp[] = [
  /favicon/i,
  /Download the React DevTools/i,
  /GL Driver Message/i, // swiftshader performance notes
];
