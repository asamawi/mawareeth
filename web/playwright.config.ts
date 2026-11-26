import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const CSP_PORT = 4174;
// The local-only live run (story 9.12): `next dev` on 3000 in front of Django on 8000. It replaces
// the stubbed projects and their static servers, so neither `npm run test:e2e` nor CI ever starts it.
const LIVE = process.env.E2E_LIVE === "1";
// 3000 and 8000 unless something else already holds them (E2E_LIVE_WEB_PORT / E2E_LIVE_API_PORT).
const LIVE_WEB_PORT = process.env.E2E_LIVE_WEB_PORT ?? "3000";
const LIVE_API_PORT = process.env.E2E_LIVE_API_PORT ?? "8000";
const LIVE_WEB = `http://localhost:${LIVE_WEB_PORT}`;
const LIVE_API = `http://localhost:${LIVE_API_PORT}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: LIVE ? [
    {
      name: "live",
      testDir: "e2e-live",
      testMatch: "*.spec.ts",
      timeout: 180_000,
      use: { ...devices["Desktop Chrome"], baseURL: LIVE_WEB },
    },
  ] : [
    { name: "chromium", testIgnore: "csp.spec.ts", use: { ...devices["Desktop Chrome"] } },
    {
      name: "csp",
      testMatch: "csp.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${CSP_PORT}` },
    },
  ],
  workers: LIVE ? 1 : undefined,
  webServer: LIVE ? [
    // Django needs local PostgreSQL with `manage.py migrate` done; the live settings only lift the throttles.
    {
      command: `uv run python manage.py runserver localhost:${LIVE_API_PORT} --noreload`,
      cwd: "..",
      url: `${LIVE_API}/api/v1/session/`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { DJANGO_SETTINGS_MODULE: "mawareeth.settings_e2e_live", E2E_LIVE_WEB: LIVE_WEB },
    },
    {
      command: `npx next dev --port ${LIVE_WEB_PORT}`,
      url: `${LIVE_WEB}/en/`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { E2E_LIVE_DIST: ".next-e2e-live", E2E_LIVE_API: LIVE_API },
    },
  ] : [
    {
      command: "node e2e/serve.mjs",
      url: `http://127.0.0.1:${PORT}/en/`,
      reuseExistingServer: !process.env.CI,
      env: { E2E_PORT: String(PORT) },
    },
    {
      // Same export, but with the production Content-Security-Policy headers.
      command: "node e2e/serve.mjs",
      url: `http://127.0.0.1:${CSP_PORT}/en/`,
      reuseExistingServer: !process.env.CI,
      env: { E2E_PORT: String(CSP_PORT), E2E_CSP: "1" },
    },
  ],
});
