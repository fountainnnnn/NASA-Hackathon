import { defineConfig, devices } from '@playwright/test';

const externalBase = process.env.E2E_BASE_URL;
const baseURL = externalBase ?? 'http://localhost:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // one swiftshader WebGL context at a time keeps CPU rendering stable
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-report.json' }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 810 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Optional: run against an already-installed Chromium instead of the one Playwright downloads.
      executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
      // Software WebGL so the three.js terrain renders in headless Chromium.
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--ignore-gpu-blocklist',
        '--enable-webgl',
      ],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 810 } } }],
  // Only start our own server when no external URL is given (production / staging runs set E2E_BASE_URL).
  webServer: externalBase
    ? undefined
    : {
        command: 'npm run dev -- -p 3000',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
