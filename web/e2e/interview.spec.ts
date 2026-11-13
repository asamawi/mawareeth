import type { Page } from "@playwright/test";

import { messages, locales, directionOf } from "../src/i18n/messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { abort, expect, fullCase, json, liveCase, noCase, sessionAnonymous, startedCase, test, watchErrors } from "./api";

const en = messages.en.interview;

/** Whether focus is inside the interview container and not on the page body. */
async function focusInScreen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-js-only]");
    const active = document.activeElement;
    return !!root && !!active && active !== document.body && root.contains(active);
  });
}

/** Presses Tab (or Shift+Tab) until the focused element has the name; never clicks. */
async function tabTo(page: Page, name: string, backwards = false): Promise<void> {
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    const text = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    if (text === name) return;
  }
  throw new Error(`Could not reach "${name}" with the keyboard`);
}

type PreviewFixture = { title: string; case: Record<string, unknown>; response: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fixtures = (
  JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: PreviewFixture[] }
).fixtures;
const fixture = (title: string) => fixtures.find((item) => item.title === title)!;

test.describe("hydration", () => {
  test("the interview hydrates with no error and shows its js-only content", async ({ page, api }) => {
    api.set({ session: sessionAnonymous, getCase: noCase, postCase: startedCase() });
    const errors = watchErrors(page);
    await page.goto("/en/interview/");
    const content = page.locator("[data-js-only]");
    await expect(content).toBeVisible();
    await expect(content.getByText(en.started, { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("rendered states", () => {
  test("a new visitor is started automatically into the first screen", async ({ page, api }) => {
    api.set({ session: sessionAnonymous, getCase: noCase, postCase: startedCase() });
    await page.goto("/en/interview/");
    await expect(page.getByRole("heading", { name: en.started })).toBeVisible();
    // A case with no school opens on the deceased screen: the school is asked only if it matters.
    await expect(page.getByRole("heading", { name: en.deceasedHeading })).toBeVisible();
    await expect(page.getByRole("radio", { name: en.madhabs.hanafi.name })).toHaveCount(0);
    expect(api.casePosts).toHaveLength(1);
    expect(api.casePosts[0].csrf).toBe("e2e-token");
    expect(JSON.parse(api.casePosts[0].body)).toEqual({});
  });

  test("an existing case offers resume and start over, and start over asks first", async ({ page, api }) => {
    api.set({ session: sessionAnonymous, getCase: liveCase(), postCase: startedCase("fedcba9876543210") });
    await page.goto("/en/interview/");
    await expect(page.getByText(en.existing)).toBeVisible();
    await expect(page.getByRole("button", { name: en.resume })).toBeVisible();
    await page.getByRole("button", { name: en.startOver }).click();
    await expect(page.getByText(en.startOverConfirm)).toBeVisible();
    expect(api.casePosts).toHaveLength(0);
    await page.getByRole("button", { name: en.startOverNo }).click();
    await expect(page.getByText(en.existing)).toBeVisible();
    expect(api.casePosts).toHaveLength(0);
    await page.getByRole("button", { name: en.startOver }).click();
    await page.getByRole("button", { name: en.startOverYes }).click();
    await expect(page.getByRole("heading", { name: en.started })).toBeVisible();
    expect(api.casePosts).toHaveLength(1);
    expect(JSON.parse(api.casePosts[0].body)).toEqual({ replace: true, case_id: "0123456789abcdef" });
  });

  test("an expired case shows the notice and waits for the visitor", async ({ page, api }) => {
    api.set({ session: sessionAnonymous, getCase: noCase, postCase: startedCase() });
    await page.addInitScript(() => localStorage.setItem("mawareeth.case-seen", "1"));
    await page.goto("/en/interview/");
    await expect(page.getByText(en.expired)).toBeVisible();
    await expect(page.getByRole("button", { name: en.start, exact: true })).toBeVisible();
    expect(api.casePosts).toHaveLength(0);
  });

  for (const locale of locales) {
    const text = messages[locale].interview;
    test(`throttled shows its message in ${locale}`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: noCase, postCase: json(429, {}) });
      await page.goto(`/${locale}/interview/`);
      await expect(page.getByRole("alert").filter({ hasText: text.throttled })).toBeVisible();
    });

    test(`a server error shows the failed message in ${locale}`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: noCase, postCase: json(500, {}) });
      await page.goto(`/${locale}/interview/`);
      await expect(page.getByRole("alert").filter({ hasText: text.failed })).toBeVisible();
    });

    test(`an aborted request shows the failed message in ${locale}`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: noCase, postCase: abort });
      await page.goto(`/${locale}/interview/`);
      await expect(page.getByRole("alert").filter({ hasText: text.failed })).toBeVisible();
    });
  }

  test("a failed case read shows the failed message", async ({ page, api }) => {
    api.set({ session: sessionAnonymous, getCase: json(500, {}) });
    await page.goto("/en/interview/");
    await expect(page.getByRole("alert").filter({ hasText: en.failed })).toBeVisible();
  });
});

test.describe("no automatic retry", () => {
  test("a failed POST is not repeated; one click repeats it once", async ({ page, api }) => {
    api.set({ session: sessionAnonymous, getCase: noCase, postCase: json(500, {}) });
    await page.goto("/en/interview/");
    await expect(page.getByRole("alert").filter({ hasText: en.failed })).toBeVisible();
    expect(api.casePosts).toHaveLength(1);
    await page.waitForTimeout(3000);
    expect(api.casePosts).toHaveLength(1);

    await page.getByRole("button", { name: en.retry }).click();
    await expect.poll(() => api.casePosts.length).toBe(2);
    await expect(page.getByRole("alert").filter({ hasText: en.failed })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(api.casePosts).toHaveLength(2);
  });

  test("a failed session GET is not requested again by the same component", async ({ page, api }) => {
    api.set({ session: (route) => route.fulfill({ status: 500, body: "" }), getCase: noCase, postCase: json(500, {}) });
    await page.goto("/en/interview/");
    await expect(page.getByRole("alert").filter({ hasText: en.failed })).toBeVisible();
    const after = api.sessionGets;
    await page.waitForTimeout(3000);
    expect(api.sessionGets).toBe(after);
  });
});

test.describe("direction", () => {
  for (const locale of locales) {
    test(`/${locale}/interview/ direction`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: noCase, postCase: startedCase() });
      await page.goto(`/${locale}/interview/`);
      await expect(page.getByRole("heading", { name: messages[locale].interview.started })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("dir", directionOf(locale));
      expect(await page.locator("main").evaluate((el) => getComputedStyle(el).direction)).toBe(directionOf(locale));
    });
  }
});

test.describe("keyboard", () => {
  test("start over and its confirmation work from the keyboard, and focus follows each screen", async ({ page, api }) => {
    api.set({ session: sessionAnonymous, getCase: liveCase(), postCase: startedCase("fedcba9876543210") });
    await page.goto("/en/interview/");
    await expect(page.getByText(en.existing)).toBeVisible();

    await tabTo(page, en.startOver);
    await page.keyboard.press("Enter");
    await expect(page.getByText(en.startOverConfirm)).toBeVisible();
    await expect.poll(() => focusInScreen(page)).toBe(true);

    // Back out with the keyboard: Tab to the cancel control and press Space.
    await tabTo(page, en.startOverNo);
    await page.keyboard.press("Space");
    await expect(page.getByText(en.existing)).toBeVisible();
    await expect.poll(() => focusInScreen(page)).toBe(true);

    await tabTo(page, en.startOver);
    await page.keyboard.press("Enter");
    await expect(page.getByText(en.startOverConfirm)).toBeVisible();
    // Shift+Tab reaches the confirm control from the cancel one.
    await tabTo(page, en.startOverNo);
    await tabTo(page, en.startOverYes, true);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: en.started })).toBeVisible();
    await expect.poll(() => focusInScreen(page)).toBe(true);
    expect(api.casePosts).toHaveLength(1);
  });
});

test.describe("reduced motion", () => {
  test.describe("reduce", () => {
    test.use({ reducedMotion: "reduce" });
    test("scroll-behavior is auto on the interview", async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: noCase, postCase: startedCase() });
      await page.goto("/en/interview/");
      expect(await page.locator("html").evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("auto");
    });
  });
  test.describe("no-preference", () => {
    test.use({ reducedMotion: "no-preference" });
    test("scroll-behavior is smooth on the interview", async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: noCase, postCase: startedCase() });
      await page.goto("/en/interview/");
      expect(await page.locator("html").evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe("smooth");
    });
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  for (const locale of ["ar", "en"] as const) {
    test(`/${locale}/interview/ shows the noscript message`, async ({ page }) => {
      await page.goto(`/${locale}/interview/`);
      await expect(page.locator("noscript p")).toHaveText(messages[locale].interview.noscript);
      await expect(page.locator("noscript p")).toBeVisible();
      await expect(page.locator("[data-js-only]")).toBeHidden();
    });
  }
});

test.describe("the school of law, asked only when it matters", () => {
  test("a family on which the four schools agree shows one result with no school", async ({ page, api }) => {
    const agree = fixture("Agree: wife, son and daughter in every school");
    api.set({ session: sessionAnonymous, getCase: json(200, { case: fullCase(agree.case) }), getPreview: json(200, agree.response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await expect(page.getByText(en.schoolsAgree)).toBeVisible();
    await expect(page.getByText(en.schoolsDiffer)).toHaveCount(0);
    await expect(page.getByRole("radio", { name: en.madhabs.hanafi.name })).toHaveCount(0);
    await expect(page.getByText(`${en.madhabLabel}:`)).toHaveCount(0);
    expect(api.casePatches).toHaveLength(0);
  });

  test("schools that differ show the rules and each result, and choosing one saves the school", async ({ page, api }) => {
    const differ = fixture("Differ: grandfather and full brother");
    const stored = fullCase(differ.case, { madhab: "hanafi" });
    let chosen = false;
    api.set({
      session: sessionAnonymous,
      getCase: (route) => json(200, { case: chosen ? stored : fullCase(differ.case) })(route),
      patchCase: (route) => {
        chosen = true;
        return json(200, { case: stored })(route);
      },
      getPreview: (route) => json(200, chosen ? differ.response.schools.hanafi : differ.response)(route),
    });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const choice = page.locator("[data-school-choice]");
    await expect(choice.getByText(en.schoolsDiffer)).toBeVisible();
    await expect(choice.getByText(en.schoolsDifferBecause)).toBeVisible();
    for (const rule of differ.response.rules) await expect(choice.getByText(rule.label, { exact: true })).toBeVisible();
    const group = page.getByRole("radiogroup", { name: en.chooseSchool });
    await expect(group.getByRole("radio")).toHaveCount(4);
    await expect(group.getByRole("radio", { name: en.madhabs.jafari.name })).toHaveCount(0);
    // Continue with nothing picked says what is needed and saves nothing.
    await page.getByRole("button", { name: en.madhabContinue }).click();
    await expect(choice.getByRole("alert")).toHaveText(en.chooseSchool);
    expect(api.casePatches).toHaveLength(0);
    await group.getByRole("radio", { name: en.madhabs.hanafi.name }).check();
    await expect(choice.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: en.madhabContinue }).click();
    await expect(page.getByText(en.schoolsDiffer)).toHaveCount(0);
    await expect(page.getByText(`${en.madhabLabel}:`)).toBeVisible();
    expect(api.casePatches).toHaveLength(1);
    expect(JSON.parse(api.casePatches[0].body)).toEqual({ madhab: "hanafi", case_id: differ.case.id });
  });

  test("a refusal in one school is shown in that school's summary", async ({ page, api }) => {
    const refusal = fixture("Refusal: Malikiyya makes the schools differ");
    api.set({ session: sessionAnonymous, getCase: json(200, { case: fullCase(refusal.case) }), getPreview: json(200, refusal.response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const choice = page.locator("[data-school-choice]");
    await expect(choice.getByText(en.schoolsDiffer)).toBeVisible();
    await expect(choice.getByText(en.previewReasons.malikiyya_disputed).first()).toBeVisible();
  });
});
