/**
 * Layout gate (plan gate 6) inside the Playwright run: drives the main app states at 1440x810 with scripts/qa-layout.mjs and
 * requires zero overlap / clipping / contrast / keyboard violations. The full matrix (all states x 4 viewports) is
 * `node scripts/qa-layout.mjs`; this keeps the gate in CI at a size the suite can afford. The live language model is never called.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 1_500_000 });

const MAIN_STATES = [
  // landing-check-streaming asks the landing check; without it landing-check-card would capture the map-click card again
  'intro', 'planet-idle', 'map-click-card', 'landing-check-streaming', 'landing-check-card', 'landing-sim-descent', 'landing-sky-crane', 'landing-touchdown-close', 'jezero-after-fall', 'route-nopath-card', 'route-nearest-card', 'drag-preview',
  'route-nogo-card', 'panel-formulas-expanded', 'maths-followup', 'route-go-card', 'walk-playback', 'helmet-view', 'sources', 'cuff-card', 'report-section-4', 'panel-collapsed',
].join(',');

test('layout: no overlaps, no clipping, contrast >= 4.5:1 and every control reachable by keyboard in the main states', async ({}, testInfo) => {
  const base = String(testInfo.project.use.baseURL ?? 'http://localhost:3000');
  // kept outside test-results (which every Playwright run empties) so the screenshots survive as review evidence
  const out = `deliverables/qa/e2e-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
  const code = await new Promise<number>((resolve) => {
    const p = execFile('node', ['scripts/qa-layout.mjs'], {
      env: { ...process.env, E2E_BASE_URL: base, QA_VIEWPORTS: '1440x810', QA_STATES: MAIN_STATES, QA_OUT: out, QA_NO_ANNOTATE: '1' },
      maxBuffer: 64 * 1024 * 1024, timeout: 1_400_000,
    }, (err, stdout) => { console.log(stdout.split('\n').filter((l) => /^\d+x\d+|report:|driver:/.test(l)).join('\n')); resolve(err ? ((err as { code?: number }).code ?? 1) : 0); });
    p.stdout?.resume();
  });
  const report = JSON.parse(readFileSync(`${out}/layout-report.json`, 'utf8')) as { passed: boolean; results: { state: string; viewport: string; violations: { type: string; a: string; b: string }[] }[] };
  const bad = report.results.flatMap((r) => r.violations.map((v) => `${r.viewport} ${r.state}: ${v.type} ${v.a} | ${v.b}`));
  expect(bad, bad.join('\n')).toEqual([]);
  expect(code).toBe(0);
});
