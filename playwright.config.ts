import { defineConfig, devices } from '@playwright/test';

const PORT = 5314;

/**
 * These tests exist because the behaviour this library depends on — how `error`
 * events propagate, whether they cross a shadow boundary, what `currentSrc` holds
 * after a `<source>` fails, when the browser aborts an in-flight request — is
 * precisely what jsdom does not model. They run against the built bundle.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Rebuild first: the harness imports `/dist/index.js`, not `src/`.
    command: 'npm run build && node e2e/server.mjs',
    url: `http://localhost:${PORT}/ok.png`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
