import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
const CSP_PORT = 4174;

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
  projects: [
    { name: "chromium", testIgnore: "csp.spec.ts", use: { ...devices["Desktop Chrome"] } },
    {
      name: "csp",
      testMatch: "csp.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${CSP_PORT}` },
    },
  ],
  webServer: [
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
