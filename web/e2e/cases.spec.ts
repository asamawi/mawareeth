import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { directionOf, messages } from "../src/i18n/messages";
import { CASE, expect, fullCase, json, sessionAuthenticated, test, type Api } from "./api";

const agree = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[] })
  .fixtures.find((item) => item.title === "Agree: wife, son and daughter in every school")!;

const ROW = { id: 7, updated_at: "2026-11-01T00:00:00Z", madhab: "hanafi", heir_count: 2, status: "draft" };
const working = (saved: unknown, revision = 3) => json(200, { case: { ...CASE, id: "work-1", revision, deceased: { gender: "male", estate: null }, heirs: [], ...(saved === undefined ? {} : { saved }) } });
const opened = json(200, { case: { ...CASE, id: "opened-1", revision: 1, saved: { revision: 1 } } });

function stubCases(api: Api, getCase: Parameters<Api["set"]>[0]["getCase"], postOpen = opened) {
  api.set({
    session: sessionAuthenticated,
    getCase,
    getSavedCases: json(200, { cases: [ROW] }),
    getReceived: json(200, { received: [] }),
    postOpen,
  });
}

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

for (const locale of ["en", "ar"] as const) {
  const text = messages[locale].cases;
  const openButton = (page: Page) => page.getByRole("button", { name: text.open, exact: true });
  const dialog = (page: Page) => page.locator("dialog[open]");

  test.describe(`My cases discard prompt in ${locale}`, () => {
    test("asks with the safe choice focused, in order, at least 44px, in the page direction", async ({ page, api }) => {
      stubCases(api, working({ revision: 2 }));
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).getByRole("heading", { name: text.discardTitle })).toBeVisible();
      await expect(dialog(page).getByText(text.discardBody)).toBeVisible();
      const no = dialog(page).getByRole("button", { name: text.discardNo });
      const yes = dialog(page).getByRole("button", { name: text.discardYes });
      await expect(no).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(yes).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(no).toBeFocused();
      for (const button of [no, yes, openButton(page)]) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator("main")).toHaveAttribute("dir", directionOf(locale));
      expect(directionOf(locale) === "rtl").toBe(locale === "ar");
      // The safe choice is the first in reading order in both directions.
      const [a, b] = [(await no.boundingBox())!, (await yes.boundingBox())!];
      // Wrapped buttons stack, so the safe choice then comes first from the top.
      expect(a.y + 1 < b.y || (locale === "ar" ? a.x > b.x : a.x < b.x)).toBe(true);
      expect(api.openPosts).toHaveLength(0);
    });

    test("Cancel and Escape send no open request and return focus to the pressed Open button", async ({ page, api }) => {
      stubCases(api, working({ revision: null }));
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await dialog(page).getByRole("button", { name: text.discardNo }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(openButton(page)).toBeFocused();
      await openButton(page).click();
      await expect(dialog(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
      await expect(openButton(page)).toBeFocused();
      expect(api.openPosts).toHaveLength(0);
      expect(api.casePosts).toHaveLength(0);
    });

    test("opening the linked row again while unsaved asks the same", async ({ page, api }) => {
      stubCases(api, working({ revision: 2 }));
      await page.goto(`/${locale}/cases/`);
      for (let i = 0; i < 2; i += 1) {
        await openButton(page).click();
        await expect(dialog(page).getByRole("heading", { name: text.discardTitle })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog(page)).toHaveCount(0);
      }
      expect(api.openPosts).toHaveLength(0);
    });

    test("Confirm sends the revision it showed and opens the interview", async ({ page, api }) => {
      stubCases(api, working({ revision: 2 }));
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await dialog(page).getByRole("button", { name: text.discardYes }).click();
      await page.waitForURL(`**/${locale}/interview/`);
      expect(api.openPosts).toHaveLength(1);
      expect(JSON.parse(api.openPosts[0].body)).toEqual({ case_id: "work-1", expected_revision: 3 });
    });

    for (const refresh of ["clean", "absent", "dirty"] as const) {
      test(`a 409 on Confirm asks again after a ${refresh} refresh and opens only on the second Confirm`, async ({ page, api }) => {
        let reads = 0;
        let posts = 0;
        const refreshed = { clean: () => working({ revision: 9 }, 8), absent: () => json(200, { case: null }), dirty: () => working({ revision: 1 }, 8) }[refresh];
        stubCases(api, (route) => (++reads === 1 ? working({ revision: 1 }) : refreshed())(route), (route) => (++posts === 1 ? json(409, { error: "conflict", case: null }) : opened)(route));
        await page.goto(`/${locale}/cases/`);
        await openButton(page).click();
        await dialog(page).getByRole("button", { name: text.discardYes }).click();
        await expect.poll(() => reads).toBe(2);
        await expect(dialog(page).getByRole("heading", { name: text.discardTitle })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/${locale}/cases/`));
        expect(api.openPosts).toHaveLength(1);
        expect(JSON.parse(api.openPosts[0].body)).toEqual({ case_id: "work-1", expected_revision: 3 });
        await dialog(page).getByRole("button", { name: text.discardYes }).click();
        await page.waitForURL(`**/${locale}/interview/`);
        expect(api.openPosts).toHaveLength(2);
        expect(JSON.parse(api.openPosts[1].body)).toEqual(refresh === "absent" ? { case_id: null } : { case_id: "work-1", expected_revision: 8 });
      });
    }

    test("leaving the page while the state read is pending sends no open", async ({ page, api }) => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      stubCases(api, async (route) => { await gate; await working({ revision: 3 })(route); });
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await page.evaluate(() => { window.history.pushState({}, "", "/en/"); });
      await page.goto(`/${locale}/`).catch(() => undefined);
      release();
      await page.waitForTimeout(300);
      expect(api.openPosts).toHaveLength(0);
    });

    test("a failed open after Confirm shows the existing error and keeps the copy", async ({ page, api }) => {
      stubCases(api, working({ revision: 2 }), json(500, {}));
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await dialog(page).getByRole("button", { name: text.discardYes }).click();
      await expect(page.getByRole("alert").filter({ hasText: text.error })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/${locale}/cases/`));
      expect(api.openPosts).toHaveLength(1);
      expect(api.casePosts).toHaveLength(0);
      await expect(openButton(page)).toBeFocused();
      // The copy was only read, never written or replaced.
      expect(api.casePatches).toHaveLength(0);
    });

    test("a clean copy opens with no prompt", async ({ page, api }) => {
      stubCases(api, working({ revision: 3 }));
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await page.waitForURL(`**/${locale}/interview/`);
      expect(api.openPosts).toHaveLength(1);
      expect(JSON.parse(api.openPosts[0].body)).toEqual({ case_id: "work-1", expected_revision: 3 });
    });

    test("an unreadable state prompts and Confirm opens with the old body", async ({ page, api }) => {
      stubCases(api, json(500, {}));
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await expect(dialog(page).getByRole("heading", { name: text.discardTitle })).toBeVisible();
      expect(api.openPosts).toHaveLength(0);
      await dialog(page).getByRole("button", { name: text.discardYes }).click();
      await page.waitForURL(`**/${locale}/interview/`);
      expect(api.openPosts[0].body).toBe("{}");
    });

    for (const scheme of ["light", "dark"] as const) {
      test(`the open dialog has no serious or critical axe violation in ${scheme} mode`, async ({ page, api }) => {
        await page.emulateMedia({ colorScheme: scheme });
        stubCases(api, working({ revision: 2 }));
        await page.goto(`/${locale}/cases/`);
        await openButton(page).click();
        await expect(dialog(page)).toBeVisible();
        expect(await serious(page)).toEqual([]);
      });
    }
  });

  test(`the unsaved notice in ${locale} links to the localized Full results`, async ({ page, api }) => {
    api.set({ session: sessionAuthenticated, getCase: working({ revision: null }) });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await expect(page.getByText(messages[locale].interview.unsavedNotice)).toBeVisible();
    await expect(page.getByRole("link", { name: messages[locale].interview.unsavedLink })).toHaveAttribute("href", `/${locale}/results/`);
  });
}

test("an edit stays in the Interview after the prompt is cancelled, and a reload still shows the notice", async ({ page, api }) => {
  const options = { blocked: [], invalid: {} };
  const base = fullCase(agree.case, { revision: 5, snapshot: { at: 5 }, saved: { revision: 5 } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const edited = { ...base, revision: 6, snapshot: { at: 6 }, heirs: [...base.heirs, { id: "new-son", relationship: "son", gender: "male", name: null, edit_options: options }] };
  let current: Record<string, unknown> = base;
  api.set({
    session: sessionAuthenticated,
    getCase: (route) => json(200, { case: current })(route),
    getPreview: json(200, agree.response),
    postHeir: (route) => { current = edited; return json(201, { case: edited })(route); },
    getSavedCases: json(200, { cases: [ROW] }),
    getReceived: json(200, { received: [] }),
    postOpen: opened,
  });
  const notice = page.getByText(messages.en.interview.unsavedNotice);
  await page.goto("/en/interview/");
  await page.getByRole("button", { name: messages.en.interview.resume }).click();
  await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor();
  await expect(notice).toHaveCount(0);
  await page.locator("[data-focus='add:son']").click();
  await expect(notice).toBeVisible();
  // Leaving through My cases: the prompt appears and Cancel sends nothing.
  await page.goto("/en/cases/");
  await page.getByRole("button", { name: messages.en.cases.open, exact: true }).click();
  await page.locator("dialog[open]").getByRole("button", { name: messages.en.cases.discardNo }).click();
  expect(api.openPosts).toHaveLength(0);
  // Back in the Interview the edit is still there, and a reload keeps the notice.
  await page.goto("/en/interview/");
  await expect(notice).toBeVisible();
  await expect(page.locator("[data-node='new-son']")).toBeVisible();
  await page.reload();
  await expect(notice).toBeVisible();
  await expect(page.locator("[data-node='new-son']")).toBeVisible();
});
