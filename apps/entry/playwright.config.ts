import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3003',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // NODE_ENV=test is load-bearing, not decoration: Next skips `.env.local` entirely
    // in test, which is the only way the suite's credentials survive on a machine that
    // has dev env configured. `@next/env` otherwise overwrites externally-set
    // `process.env` values, so `webServer.env` lost to a developer's `.env.local` and
    // login failed locally while CI — which has no `.env.local` — stayed green. The
    // credentials now live in the committed `.env.test` beside this config.
    // The build stays NODE_ENV=production; only the served process is test.
    // DISABLE_HTTPS_UPGRADE belongs on the BUILD, not the server: `next build`
    // serializes `headers()` into routes-manifest.json, so the CSP and HSTS values are
    // fixed at build time and setting the flag on `next start` has no effect at all.
    command: 'DISABLE_HTTPS_UPGRADE=true pnpm build && NODE_ENV=test pnpm start',
    url: 'http://localhost:3003',
    reuseExistingServer: !process.env.CI,
    // No AUTH_SESSION_PASSWORD / DEMO_AUTH_* here — the entry point is never
    // authenticated, so it has no auth gate to feed. The prod build is served over
    // plain HTTP, so the HTTPS-upgrade headers are disabled or WebKit rewrites the
    // CSS/JS to https://localhost and the page loads unstyled.
  },
});
