import { messages, locales, directionOf } from "../src/i18n/messages";
import { expect, noCase, sessionAnonymous, sessionAuthenticated, startedCase, test, watchErrors } from "./api";

test.describe("hydration", () => {
  for (const locale of locales) {
    test(`landing /${locale}/ loads with no page or console error`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous });
      const errors = watchErrors(page);
      await page.goto(`/${locale}/`);
      await expect(page.getByRole("navigation", { name: messages[locale].nav.label })).toBeVisible();
      // The session probe is the first client effect: once it ran, the page hydrated.
      await expect.poll(() => api.sessionGets).toBeGreaterThan(0);
      await expect(page.getByRole("link", { name: messages[locale].nav.login })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test.describe("navbar", () => {
  test("anonymous visitors see login and signup", async ({ page, api }) => {
    api.set({ session: sessionAnonymous });
    await page.goto("/en/");
    const nav = page.getByRole("navigation", { name: messages.en.nav.label });
    await expect(nav.getByRole("link", { name: messages.en.nav.login })).toBeVisible();
    await expect(nav.getByRole("link", { name: messages.en.nav.signup })).toBeVisible();
    await expect(nav.getByRole("button", { name: messages.en.auth.logout })).toHaveCount(0);
  });

  test("signed-in visitors see their cases and logout instead", async ({ page, api }) => {
    // The landing page sends a signed-in visitor on, so the navbar is checked on the interview page.
    api.set({ session: sessionAuthenticated, getCase: noCase, postCase: startedCase() });
    await page.goto("/en/interview/");
    const nav = page.getByRole("navigation", { name: messages.en.nav.label });
    await expect(nav.getByRole("button", { name: messages.en.auth.logout })).toBeVisible();
    await expect(nav.getByRole("link", { name: messages.en.nav.cases })).toBeVisible();
    await expect(nav.getByRole("link", { name: messages.en.nav.login })).toHaveCount(0);
  });
});

test.describe("direction", () => {
  for (const locale of locales) {
    test(`/${locale}/ is ${directionOf(locale)}`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous });
      await page.goto(`/${locale}/`);
      const html = page.locator("html");
      await expect(html).toHaveAttribute("lang", locale);
      await expect(html).toHaveAttribute("dir", directionOf(locale));
      expect(await page.locator("main").evaluate((el) => getComputedStyle(el).direction)).toBe(directionOf(locale));
    });
  }
});

test.describe("reduced motion", () => {
  test.describe("reduce", () => {
    test.use({ reducedMotion: "reduce" });
    test("scroll-behavior is auto", async ({ page, api }) => {
      api.set({ session: sessionAnonymous });
      await page.goto("/en/");
      expect(await page.locator("html").evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("auto");
    });
  });
  test.describe("no-preference", () => {
    test.use({ reducedMotion: "no-preference" });
    test("scroll-behavior is smooth", async ({ page, api }) => {
      api.set({ session: sessionAnonymous });
      await page.goto("/en/");
      expect(await page.locator("html").evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("smooth");
    });
  });
});

test.describe("session probe", () => {
  test("a failed session GET is not requested again", async ({ page, api }) => {
    api.set({ session: (route) => route.fulfill({ status: 500, body: "" }) });
    await page.goto("/en/");
    await expect.poll(() => api.sessionGets).toBeGreaterThan(0);
    // Settled: the nav shows the anonymous links once the probe has failed.
    await expect(page.getByRole("link", { name: messages.en.nav.login })).toBeVisible();
    const after = api.sessionGets;
    await page.waitForTimeout(3000);
    expect(api.sessionGets).toBe(after);
  });
});
