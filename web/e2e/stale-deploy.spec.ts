import type { Page } from "@playwright/test";

import { RELOAD_KEY } from "../src/app/chunk-recovery";
import { messages } from "../src/i18n/messages";
import { expect, noCase, sessionAnonymous, startedCase, test } from "./api";

// Simulates the failures a tab left open across a deploy meets: the next navigation's RSC payload
// or a script chunk it needs is gone (the server answers 404 or the request fails).

const stubs = { session: sessionAnonymous, getCase: noCase, postCase: startedCase() };

/** Tracks script chunk requests; `loaded()` snapshots them so later requests count as "not yet loaded". */
function trackChunks(page: Page): () => Set<string> {
  const seen = new Set<string>();
  page.on("request", (request) => {
    if (/\/_next\/static\/.*\.js(\?|$)/.test(request.url())) seen.add(new URL(request.url()).pathname);
  });
  return () => new Set(seen);
}

async function hydrated(page: Page, api: { sessionGets: number }) {
  await expect.poll(() => api.sessionGets).toBeGreaterThan(0);
  await expect(page.getByRole("navigation", { name: messages.en.nav.label })).toBeVisible();
}

test("a failed RSC payload falls back to a full navigation", async ({ page, api }) => {
  api.set(stubs);
  await page.goto("/en/");
  await hydrated(page, api);
  let failed = 0;
  await page.route("**/*.txt*", (route) => {
    if (route.request().url().includes("/interview/") && failed === 0) {
      failed += 1;
      return route.fulfill({ status: 404, contentType: "text/plain", body: "Not found" });
    }
    return route.fallback();
  });
  await page.getByRole("navigation").getByRole("link", { name: messages.en.nav.interview }).click();
  await expect(page).toHaveURL(/\/en\/interview\/$/);
  await expect(page.getByRole("heading", { level: 1, name: messages.en.interview.heading })).toBeVisible();
  expect(failed).toBe(1);
});

test("a script chunk that fails is recovered by one automatic reload and does not leave a blank page", async ({ page, api }) => {
  api.set(stubs);
  const loadedChunks = trackChunks(page);
  await page.goto("/en/");
  await hydrated(page, api);
  const seen = loadedChunks();
  await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));
  let aborted = 0;
  const attempts = new Map<string, number>();
  await page.route("**/_next/static/**/*.js*", (route) => {
    const { pathname } = new URL(route.request().url());
    // The first two requests per chunk fail: Next re-requests a failed chunk once on its own, so a
    // single abort would be absorbed without ever reaching the error boundary.
    const failures = (attempts.get(pathname) ?? 0) + 1;
    attempts.set(pathname, failures);
    if (!seen.has(pathname) && failures <= 2) {
      aborted += 1;
      return route.abort("failed");
    }
    return route.fallback();
  });
  await page.getByRole("navigation").getByRole("link", { name: messages.en.nav.interview }).click();
  await expect(page).toHaveURL(/\/en\/interview\/$/);
  await expect(page.getByRole("heading", { level: 1, name: messages.en.interview.heading })).toBeVisible();
  expect(aborted).toBeGreaterThan(0);
  // The marker lives only in the old document: its absence proves the automatic full reload happened.
  expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBeUndefined();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), RELOAD_KEY)).not.toBeNull();
});

for (const locale of ["ar", "en", "fr"] as const) {
  test(`/${locale}/ shows the localized fallback when a chunk fails after a reload`, async ({ page, api }) => {
    api.set(stubs);
    const loadedChunks = trackChunks(page);
    await page.goto(`/${locale}/`);
    await expect.poll(() => api.sessionGets).toBeGreaterThan(0);
    await expect(page.getByRole("navigation", { name: messages[locale].nav.label })).toBeVisible();
    const seen = loadedChunks();
    // From now on any chunk the page has not already loaded is gone, as after a deploy.
    await page.route("**/_next/static/**/*.js*", (route) => {
      const { pathname } = new URL(route.request().url());
      return seen.has(pathname) ? route.fallback() : route.abort("failed");
    });
    const interviewLink = () =>
      page.getByRole("navigation").getByRole("link", { name: messages[locale].nav.interview });
    const text = messages[locale].pageError;
    const fallback = page.getByRole("heading", { level: 1, name: text.title });

    // An automatic reload already happened a moment ago, so this failure must not reload again.
    await page.evaluate((key) => {
      sessionStorage.setItem(key, String(Date.now()));
      (window as unknown as { sameDocument: boolean }).sameDocument = true;
    }, RELOAD_KEY);
    await interviewLink().click();
    await expect(fallback).toBeVisible();
    await expect(fallback).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBe(true);
    await expect(page.locator("main[dir]")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect(page.locator("main[dir]")).toHaveAttribute("lang", locale);
    await expect(page.getByText(text.body)).toBeVisible();
    await expect(page.getByRole("link", { name: text.interview })).toHaveAttribute("href", `/${locale}/interview/`);

    // The reload button reloads the page; the chunks are reachable again.
    await page.unroute("**/_next/static/**/*.js*");
    await page.getByRole("button", { name: text.reload }).click();
    await expect(page.getByRole("navigation", { name: messages[locale].nav.label })).toBeVisible();
    await expect(fallback).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)).toBeUndefined();
  });
}
