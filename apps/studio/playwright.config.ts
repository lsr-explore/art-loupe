import { ACK_COOKIE_NAME } from '@artloupe/auth/ack';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    /**
     * Arrive already acknowledged.
     *
     * This app's middleware bounces an unacknowledged visitor to the entry point
     * on **every** route, including the login screen — so without this seed the
     * whole suite redirects to :3003, which this config never starts. Seeding the
     * cookie is not a bypass: it is the state of every real visitor, who reached
     * this app by ticking the box on the apex.
     *
     * The gate's own behaviour — the unacknowledged path, the error banner, the
     * `next=` resume — is tested against the entry point that owns it.
     *
     * `expires: -1` keeps it session-scoped, matching what the entry point writes.
     */
    storageState: {
      cookies: [
        {
          name: ACK_COOKIE_NAME,
          value: '1',
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
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
    // A metadata route, not `/`. The acknowledgement gate redirects `/` to
    // the entry point on :3003, which this config never starts — the acknowledgement
    // probe carries no cookies, so it cannot satisfy the gate and would follow the
    // redirect to a dead port until it timed out. `robots.txt` contains a dot, so
    // the proxy matcher excludes it and it is served directly: a clean liveness
    // signal that does not depend on auth or acknowledgement state.
    url: 'http://localhost:3001/robots.txt',
    reuseExistingServer: !process.env.CI,
    // `DISABLE_HTTPS_UPGRADE` lives in `.env.test`: the prod build is served over
    // plain HTTP, and WebKit otherwise upgrades the CSS/JS to https://localhost and
    // renders the page unstyled.
  },
});
