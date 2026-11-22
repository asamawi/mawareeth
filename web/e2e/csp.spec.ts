import { readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Loads every exported page under the production Content-Security-Policy (see serve.mjs, E2E_CSP=1).
const out = resolve(__dirname, "..", "out");

function pagesOf(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...pagesOf(join(dir, entry.name)));
    else if (entry.name === "index.html") {
      const rel = relative(out, dir).split(sep).join("/");
      found.push(rel === "" ? "/" : `/${rel}/`);
    }
  }
  return found;
}

const pages = pagesOf(out).sort();

type Violation = { directive: string; blocked: string };

async function watch(page: Page) {
  const consoleCsp: string[] = [];
  const pageErrors: string[] = [];
  let sessionRequests = 0;
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) consoleCsp.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: Violation[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session/") {
      sessionRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not found" }) });
  });
  const violations = () => page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations);
  return { consoleCsp, pageErrors, violations, sessionRequests: () => sessionRequests };
}

test("the export has pages", () => {
  expect(pages.length).toBeGreaterThan(0);
});

for (const path of pages) {
  test(`${path} hydrates under the production CSP`, async ({ page }) => {
    const seen = await watch(page);
    const response = await page.goto(path);
    const csp = response?.headers()["content-security-policy"] ?? "";
    const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src")) ?? "";
    expect(scriptSrc).toContain("'sha256-");
    await expect.poll(() => seen.sessionRequests()).toBeGreaterThan(0);
    expect(await seen.violations()).toEqual([]);
    expect(seen.consoleCsp).toEqual([]);
    expect(seen.pageErrors).toEqual([]);
  });
}

test("canary: an injected inline script is reported as a violation", async ({ page }) => {
  const seen = await watch(page);
  await page.goto("/en/");
  await expect.poll(() => seen.sessionRequests()).toBeGreaterThan(0);
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__canary = true;";
    document.body.appendChild(script);
  });
  await expect.poll(async () => (await seen.violations()).length).toBe(1);
  expect((await seen.violations())[0].directive).toMatch(/^script-src(-elem)?$/);
  // The violation means the script was blocked: it never ran.
  expect(await page.evaluate(() => (window as unknown as { __canary?: boolean }).__canary)).toBeUndefined();
});

test("the explicit /en/index.html URL is served with the CSP too", async ({ page }) => {
  const response = await page.request.get("/en/index.html");
  const csp = response.headers()["content-security-policy"] ?? "";
  const scriptSrc = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src")) ?? "";
  expect(scriptSrc).toContain("'sha256-");
});
