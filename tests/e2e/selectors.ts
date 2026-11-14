/**
 * ONE place for every assumption the e2e suite makes about the app's markup.
 * If a test fails with "locator not found", fix the locator here, not in the spec.
 * Each entry says where in the app it comes from (src/components/HUD/*) so it can be re-checked.
 */
import type { Locator, Page } from '@playwright/test';

/** Set on <body> by SceneCanvas.tsx once the DEM is decoded and the Canvas is mounted. */
export const SCENE_READY_JS = "document.body.dataset.sceneReady === '1'";

/** Intro.tsx: first-visit welcome dialog (role=dialog, labelled "intro-title") dismissed by "Start exploring"; remembered in localStorage. */
export const INTRO_SEEN_KEY = 'marswalk-intro-seen';
export const introDialog = (p: Page): Locator => p.getByRole('dialog', { name: /marswalk copilot/i });
export const introStart = (p: Page): Locator => p.getByRole('button', { name: /start exploring/i });

/** The WebGL canvas (R3F <Canvas>, aria-label "3D terrain of Jezero Crater, Mars" is on its wrapper). */
export const canvas = (p: Page): Locator => p.locator('main canvas').first();

/** HUD root: HudRoot.tsx renders <div class={hud.module .hud}>; CSS-module class names are hashed so match on "hud". */
export const HUD_ROOT_CSS = 'main > [class*="hud"]';
export const hud = (p: Page): Locator => p.locator(HUD_ROOT_CSS).first();

/** TopBar.tsx: <button aria-haspopup="dialog">Sources</button> opens the SourcesPanel modal. */
export const sourcesButton = (p: Page): Locator => p.getByRole('button', { name: /^sources$/i });
/** SourcesPanel.tsx: <div role="dialog" aria-labelledby="src-title"> titled "Data sources". */
export const sourcesDialog = (p: Page): Locator => p.getByRole('dialog', { name: /data sources/i });
export const sourcesClose = (p: Page): Locator => p.getByRole('button', { name: /close sources/i });

/** AskBubble.tsx: <section aria-label="Ask the copilot"> (open) or an opener button of that name (closed). */
export const askPanel = (p: Page): Locator => p.getByRole('region', { name: /ask the copilot/i });
export const askOpener = (p: Page): Locator => p.getByRole('button', { name: /ask the copilot/i });
export const askInput = (p: Page): Locator => p.getByRole('textbox', { name: /question for the copilot/i });
export const askSend = (p: Page): Locator => p.getByRole('button', { name: /^send$/i });
/** AgentTrace.tsx: <ul aria-label="Tools the copilot called"><li>… */
export const traceSteps = (p: Page): Locator => p.getByRole('list', { name: /tools the copilot called/i }).getByRole('listitem');
/** AskBubble.tsx Message(): assistant bubbles carry the CSS-module class "msgBot" (no role/label exists). ASSUMPTION. */
export const botMessages = (p: Page): Locator => p.locator('[class*="msgBot"]');

/** Optional test hook. If the app adds data-testid="selected-readout" to the selected-point coordinate text it wins. */
export const selectedReadoutTestId = (p: Page): Locator => p.getByTestId('selected-readout');

/** Scene.Pins Marker for the user's pick renders a label "Selected" inside the Html overlay (not in the HUD). */
export const selectedPinLabel = (p: Page): Locator => p.locator('main').getByText('Selected', { exact: true });

/** MissionPanel.tsx */
export const planButton = (p: Page): Locator => p.getByRole('button', { name: /plan round trip/i });
export const steepestButton = (p: Page): Locator => p.getByRole('button', { name: /^show steepest stretch/i }); // not the drawer's "Steepest stretch"
export const whatsHereButton = (p: Page): Locator => p.getByRole('button', { name: /what.s here\?/i }).first();
/** Slider label is "Max slope <badge>"; a native <input type=range min=5 max=40>. */
export const maxSlope = (p: Page): Locator => p.getByLabel(/^max slope/i);
export const mapSectionHeader = (p: Page, name: RegExp): Locator => p.getByRole('button', { name, expanded: false });

/** RouteDrawer.tsx: <aside aria-label="Route details"> with <dl> of Length/Ascent/Max slope/Walking time/EVA/Battery/Climb. */
export const routeDrawer = (p: Page): Locator => p.getByRole('complementary', { name: /route details/i });
/** Verdict banner text inside the drawer when RouteResult.feasible === false. */
export const NOT_FEASIBLE = /not feasible under your limits|no path exists/i;
/** Hazard callout label from showSteepestStretch(): "Steep stretch 1: up to X° over Y m" (a pin label over the 3D scene). */
export const HAZARD_LABEL = /steep stretch \d/i;

/** LayerDock.tsx: Switch = <input type=checkbox role=switch aria-label="Show <title>"> */
export const layerSwitch = (p: Page, name: RegExp): Locator => p.getByRole('switch', { name });
export const LAYER_THEMIS = /themis day/i;
export const LAYER_GEOLOGY = /geology/i;
/** Text expected in the Sources dialog for each layer (layers.json titles / credits). */
export const SRC_THEMIS = /THEMIS/;
export const SRC_GEOLOGY = /USGS|geolog/i;

/** Console messages that are not app errors. Keep this list short and justified. */
export const IGNORED_CONSOLE: RegExp[] = [
  /favicon/i, // dev server favicon 404s are cosmetic
  /Download the React DevTools/i,
];
