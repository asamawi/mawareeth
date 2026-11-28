import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { directionOf, messages } from "../src/i18n/messages";
import { CASE, expect, fullCase, json, noCase, sessionAnonymous, sessionAuthenticated, test, type Api } from "./api";

const agree = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[] })
  .fixtures.find((item) => item.title === "Agree: wife, son and daughter in every school")!;

const ROW = { id: 7, name: "Mother's estate", updated_at: "2026-11-01T00:00:00Z", revision: 3, madhab: "hanafi", heir_count: 2, status: "draft" };
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
    await expect(page.getByText(messages[locale].interview.unsavedNotice)).toBeVisible();
    await expect(page.getByRole("link", { name: messages[locale].interview.unsavedLink })).toHaveAttribute("href", `/${locale}/results/`);
  });
}

test("an edit that cannot be saved stays in the Interview after the prompt is cancelled, and a reload still shows the notice", async ({ page, api }) => {
  const options = { blocked: [], invalid: {} };
  const base = fullCase(agree.case, { revision: 5, snapshot: { at: 5 }, saved: { revision: 5 } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const edited = { ...base, revision: 6, snapshot: { at: 6 }, heirs: [...base.heirs, { id: "new-son", relationship: "son", gender: "male", name: null, edit_options: options }] };
  let current: Record<string, unknown> = base;
  api.set({
    session: sessionAuthenticated,
    getCase: (route) => json(200, { case: current })(route),
    getPreview: json(200, agree.response),
    postHeir: (route) => { current = edited; return json(201, { case: edited })(route); },
    postAutosave: json(500, {}),
    getSavedCases: json(200, { cases: [ROW] }),
    getReceived: json(200, { received: [] }),
    postOpen: opened,
  });
  const notice = page.getByText(messages.en.interview.unsavedNotice);
  await page.goto("/en/interview/");
  await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor();
  await expect(notice).toHaveCount(0);
  await page.locator("[data-focus='add:son']").click();
  // The autosave fails (no automatic retry): the line says so and offers Retry, the family stays.
  await expect(page.getByText(messages.en.results.saveError)).toBeVisible();
  await expect(page.getByRole("button", { name: messages.en.results.saveRetry })).toBeVisible();
  expect(api.autosavePosts).toHaveLength(1);
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

for (const locale of ["en", "ar"] as const) {
  const text = messages[locale].cases;
  const rows = [
    { ...ROW, id: 1, name: "b", updated_at: "2026-11-01T00:00:00Z", revision: 2 },
    { ...ROW, id: 2, name: "a", updated_at: "2026-11-03T00:00:00Z", revision: 4 },
    { ...ROW, id: 3, name: "c", updated_at: "2026-11-02T00:00:00Z", revision: 1 },
  ];
  const names = (page: Page) => page.locator("li > div > span.font-semibold");
  const renameButton = (page: Page, name: string) => page.getByRole("button", { name: text.rename.replace("{name}", name), exact: true });

  test.describe(`Find and rename in ${locale}`, () => {
    test("sorts by last change by default and by name on request", async ({ page, api }) => {
      api.set({ session: sessionAuthenticated, getCase: json(200, { case: null }), getSavedCases: json(200, { cases: rows }), getReceived: json(200, { received: [] }) });
      await page.goto(`/${locale}/cases/`);
      await expect(names(page)).toHaveText(["a", "c", "b"]);
      await page.getByLabel(text.sortLabel).selectOption("name");
      const collated = ["a", "b", "c"].sort(new Intl.Collator(locale).compare);
      await expect(names(page)).toHaveText(collated);
    });

    test("renames a case and shows the new name", async ({ page, api }) => {
      api.set({
        session: sessionAuthenticated, getCase: json(200, { case: null }), getSavedCases: json(200, { cases: rows }), getReceived: json(200, { received: [] }),
        postRename: json(200, { id: 2, name: "Renamed", updated_at: "2026-11-09T00:00:00Z", revision: 5 }),
      });
      await page.goto(`/${locale}/cases/`);
      await renameButton(page, "a").click();
      await page.getByLabel(messages[locale].results.nameLabel).fill("Renamed");
      await page.getByRole("button", { name: text.renameSave, exact: true }).click();
      await expect(names(page).first()).toHaveText("Renamed");
      expect(api.renamePosts).toHaveLength(1);
      expect(api.renamePosts[0].url).toBe("/api/v1/saved-cases/2/rename/");
      expect(JSON.parse(api.renamePosts[0].body)).toEqual({ name: "Renamed", expected_revision: 4 });
      await expect(renameButton(page, "Renamed")).toBeFocused();
    });

    test("a conflict keeps the typed text and shows the conflict text", async ({ page, api }) => {
      api.set({
        session: sessionAuthenticated, getCase: json(200, { case: null }), getSavedCases: json(200, { cases: rows }), getReceived: json(200, { received: [] }),
        postRename: json(409, { error: "conflict", code: "rename_conflict", detail: "changed", revision: 9, name: "Elsewhere" }),
      });
      await page.goto(`/${locale}/cases/`);
      await renameButton(page, "a").click();
      const input = page.getByLabel(messages[locale].results.nameLabel);
      await input.fill("Mine");
      await page.getByRole("button", { name: text.renameSave, exact: true }).click();
      await expect(page.getByText(text.renameConflict)).toBeVisible();
      await expect(input).toHaveValue("Mine");
    });

    test("rename mode has no serious axe violation and 44px controls", async ({ page, api }) => {
      api.set({ session: sessionAuthenticated, getCase: json(200, { case: null }), getSavedCases: json(200, { cases: rows }), getReceived: json(200, { received: [] }) });
      await page.goto(`/${locale}/cases/`);
      await renameButton(page, "a").click();
      for (const button of [page.getByRole("button", { name: text.renameSave, exact: true }), page.getByRole("button", { name: text.renameCancel, exact: true }), page.getByLabel(text.sortLabel)]) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await serious(page)).toEqual([]);
    });

    test("at 320px Open and Rename stay visible without horizontal scroll", async ({ page, api }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      api.set({ session: sessionAuthenticated, getCase: json(200, { case: null }), getSavedCases: json(200, { cases: [rows[0]] }), getReceived: json(200, { received: [] }) });
      await page.goto(`/${locale}/cases/`);
      await expect(page.getByRole("button", { name: text.open, exact: true })).toBeVisible();
      await expect(renameButton(page, "b")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}

// ---- Story 10.3: Open directly, New Case, sign-in resume ----
for (const locale of ["en", "ar"] as const) {
  const text = messages[locale].cases;
  const interview = messages[locale].interview;
  const openButton = (page: Page) => page.getByRole("button", { name: text.open, exact: true });
  const newButton = (page: Page) => page.getByRole("button", { name: text.newCase, exact: true });
  const dialog = (page: Page) => page.locator("dialog[open]");
  const heirsScreen = (page: Page) => page.locator("section[aria-labelledby='add-relatives-heading']");

  test.describe(`Open and New Case in ${locale}`, () => {
    const HEIR = "Zainab Distinctive";
    const named = () => {
      const base = fullCase(agree.case, { saved: { revision: 1 } });
      const heirs = base.heirs as Record<string, unknown>[];
      return { ...base, heirs: [{ ...heirs[0], name: HEIR }, ...heirs.slice(1)] };
    };
    function statefulOpen(api: Api) {
      let isOpen = false;
      const stored = named();
      api.set({
        session: sessionAuthenticated,
        getCase: (route) => (isOpen ? json(200, { case: stored }) : noCase)(route),
        getPreview: json(200, agree.response),
        getSavedCases: json(200, { cases: [ROW] }),
        getReceived: json(200, { received: [] }),
        postOpen: (route) => { isOpen = true; return json(200, { case: stored })(route); },
      });
    }

    test("Open shows the stored family with no Resume prompt, and a reload keeps it", async ({ page, api }) => {
      statefulOpen(api);
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await page.waitForURL(`**/${locale}/interview/`);
      await expect(heirsScreen(page)).toBeVisible();
      await expect(page.getByText(HEIR).first()).toBeVisible();
      await expect(page.getByRole("button", { name: interview.resume })).toHaveCount(0);
      await page.reload();
      await expect(heirsScreen(page)).toBeVisible();
      await expect(page.getByText(HEIR).first()).toBeVisible();
      await expect(page.getByRole("button", { name: interview.resume })).toHaveCount(0);
      expect(api.casePosts).toHaveLength(0);
    });

    test("a different working copy than the opened one shows the notice, not a family, and starts nothing", async ({ page, api }) => {
      api.set({
        session: sessionAuthenticated,
        getCase: json(200, { case: fullCase(agree.case, { id: "someone-else", saved: { revision: 1 } }) }),
        getSavedCases: json(200, { cases: [ROW] }),
        getReceived: json(200, { received: [] }),
        postOpen: json(200, { case: fullCase(agree.case, { saved: { revision: 1 } }) }),
      });
      await page.goto(`/${locale}/cases/`);
      await openButton(page).click();
      await page.waitForURL(`**/${locale}/interview/`);
      await expect(page.getByRole("alert").filter({ hasText: interview.openFailed })).toBeVisible();
      await expect(page.getByRole("link", { name: interview.backToCases })).toHaveAttribute("href", `/${locale}/cases/`);
      await expect(heirsScreen(page)).toHaveCount(0);
      expect(api.casePosts).toHaveLength(0);
      expect(await serious(page)).toEqual([]);
    });

    test("New Case from an empty list starts a fresh Case and opens the Interview", async ({ page, api }) => {
      let started = false;
      api.set({
        session: sessionAuthenticated,
        getCase: (route) => (started ? json(200, { case: { ...CASE, id: "fresh-1" } }) : noCase)(route),
        postCase: (route) => { started = true; return json(201, { case: { ...CASE, id: "fresh-1" } })(route); },
        getSavedCases: json(200, { cases: [] }),
        getReceived: json(200, { received: [] }),
      });
      await page.goto(`/${locale}/cases/`);
      expect((await newButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await serious(page)).toEqual([]);
      await newButton(page).click();
      await page.waitForURL(`**/${locale}/interview/`);
      await expect(page.getByRole("heading", { name: interview.deceasedHeading })).toBeVisible();
      await expect(page.getByRole("button", { name: interview.resume })).toHaveCount(0);
      expect(api.casePosts.map((post) => JSON.parse(post.body))).toEqual([{}]);
    });

    test("New Case with an unsaved copy asks first and then replaces it", async ({ page, api }) => {
      let started = false;
      api.set({
        session: sessionAuthenticated,
        getCase: (route) => (started ? json(200, { case: { ...CASE, id: "fresh-1" } }) : working(null))(route),
        postCase: (route) => { started = true; return json(201, { case: { ...CASE, id: "fresh-1" } })(route); },
        getSavedCases: json(200, { cases: [ROW] }),
        getReceived: json(200, { received: [] }),
      });
      await page.goto(`/${locale}/cases/`);
      await newButton(page).click();
      await expect(dialog(page).getByRole("heading", { name: text.discardTitle })).toBeVisible();
      await expect(dialog(page).getByRole("button", { name: text.discardNo })).toBeFocused();
      expect(api.casePosts).toHaveLength(0);
      await dialog(page).getByRole("button", { name: text.discardConfirmNew }).click();
      await page.waitForURL(`**/${locale}/interview/`);
      await expect(page.getByRole("heading", { name: interview.deceasedHeading })).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: interview.openFailed })).toHaveCount(0);
      expect(api.casePosts.map((post) => JSON.parse(post.body))).toEqual([{ replace: true, case_id: "work-1", expected_revision: 3 }]);
    });

    test("?open= resumes the Open when signed in", async ({ page, api }) => {
      statefulOpen(api);
      await page.goto(`/${locale}/cases/?open=7`);
      await page.waitForURL(`**/${locale}/interview/`);
      expect(api.openPosts.map((post) => post.url)).toEqual(["/api/v1/saved-cases/7/open/"]);
    });

    test("?open= while signed out makes no Open call and keeps the parameter in the sign-in link", async ({ page, api }) => {
      api.set({ session: sessionAnonymous });
      await page.goto(`/${locale}/cases/?open=7`);
      const link = page.getByRole("link", { name: text.signIn });
      await expect(link).toHaveAttribute("href", `/${locale}/login/?next=${encodeURIComponent(`/${locale}/cases/?open=7`)}`);
      expect(api.openPosts).toHaveLength(0);
    });
    test("a refused Open goes through sign-in and lands on the opened case", async ({ page, api }) => {
      const state = { signedIn: true, opened: false };
      const stored = named();
      api.set({
        session: (route) => json(200, { authenticated: state.signedIn })(route),
        getCase: (route) => (state.opened ? json(200, { case: stored }) : noCase)(route),
        getPreview: json(200, agree.response),
        getSavedCases: json(200, { cases: [{ ...ROW, id: 7 }] }),
        getReceived: json(200, { received: [] }),
        postOpen: (route) => {
          if (!state.signedIn) return json(403, { detail: "auth" })(route);
          state.opened = true;
          return json(200, { case: stored })(route);
        },
      });
      await page.route("**/api/v1/auth/login/", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        state.signedIn = true;
        const next = JSON.parse(route.request().postData() ?? "{}").next;
        return json(200, { redirect: next })(route);
      });
      await page.goto(`/${locale}/cases/`);
      await expect(openButton(page)).toBeVisible();
      state.signedIn = false;
      await openButton(page).click();
      await page.waitForURL(`**/${locale}/login/**`);
      expect(new URL(page.url()).searchParams.get("next")).toBe(`/${locale}/cases/?open=7`);
      await page.locator("input[name=username]").fill("owner");
      await page.locator("input[name=password]").fill("secret-pass-1");
      await page.locator("input[name=password]").press("Enter");
      await page.waitForURL(`**/${locale}/interview/`);
      await expect(page.getByText(HEIR).first()).toBeVisible();
      await expect(page.getByRole("button", { name: interview.resume })).toHaveCount(0);
      expect(api.openPosts.map((post) => post.url)).toEqual(["/api/v1/saved-cases/7/open/", "/api/v1/saved-cases/7/open/"]);
    });

    test("a failed sign-in stays on the login page and makes no Open call", async ({ page, api }) => {
      const state = { signedIn: true };
      api.set({
        session: (route) => json(200, { authenticated: state.signedIn })(route),
        getCase: noCase,
        getSavedCases: json(200, { cases: [{ ...ROW, id: 7 }] }),
        getReceived: json(200, { received: [] }),
        postOpen: json(403, { detail: "auth" }),
      });
      await page.route("**/api/v1/auth/login/", (route) => (route.request().method() === "POST" ? json(400, { errors: { __all__: ["bad"] } })(route) : route.fallback()));
      await page.goto(`/${locale}/cases/`);
      await expect(openButton(page)).toBeVisible();
      state.signedIn = false;
      await openButton(page).click();
      await page.waitForURL(`**/${locale}/login/**`);
      expect(api.openPosts).toHaveLength(1);
      await page.locator("input[name=username]").fill("owner");
      await page.locator("input[name=password]").fill("wrong");
      await page.locator("input[name=password]").press("Enter");
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(new RegExp(`/${locale}/login/`));
      expect(api.openPosts).toHaveLength(1);
    });
  });
}

// ---- Story 10.5: autosave of an opened Saved case ----
for (const locale of ["en", "ar"] as const) {
  const text = messages[locale];
  const options = { blocked: [], invalid: {} };
  type Wire = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const family = (saved: unknown): Wire => fullCase(agree.case, { revision: 5, snapshot: { at: 5 }, ...(saved === undefined ? {} : { saved }) }) as Wire;
  const withSon = (from: Wire, revision: number): Wire => ({ ...from, revision, snapshot: { at: revision }, heirs: [...from.heirs, { id: `son-${revision}`, relationship: "son", gender: "male", name: null, edit_options: options }] });
  /** A signed-in Interview on a Case whose answers to adds go through revision 6, 7, ... */
  function interview(api: Api, saved: unknown) {
    const base = family(saved);
    let current = base;
    api.set({
      session: sessionAuthenticated,
      getCase: (route) => json(200, { case: current })(route),
      getPreview: json(200, agree.response),
      postHeir: (route) => { current = withSon(current, current.revision + 1); return json(201, { case: current })(route); },
      getSavedCases: json(200, { cases: [ROW] }),
      getReceived: json(200, { received: [] }),
      postOpen: opened,
    });
    return base;
  }
  const line = (page: Page) => page.locator("[data-autosave-state]");
  const addSon = (page: Page) => page.locator("[data-focus='add:son']").click();
  const ready = async (page: Page) => { await page.goto(`/${locale}/interview/`); await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor(); };
  const saved = (revision: number) => json(200, { id: 7, name: "Mother's estate", updated_at: "2026-11-02T00:00:00Z", revision: 4, case_revision: revision });
  const logoutButton = (page: Page) => page.getByRole("navigation", { name: text.nav.label }).getByRole("button", { name: text.auth.logout });
  async function stubLogout(page: Page, api: Api) {
    const posts: string[] = [];
    await page.route("**/api/v1/auth/logout/", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posts.push(route.request().postData() ?? "");
      api.set({ session: sessionAnonymous });
      return json(200, {})(route);
    });
    return posts;
  }

  test.describe(`Autosave in ${locale}`, () => {
    test("a linked edit shows Saving, then Saved to My cases after exactly one request", async ({ page, api }) => {
      const base = interview(api, { revision: 5 });
      api.set({ postAutosave: async (route) => { await new Promise((resolve) => setTimeout(resolve, 400)); await saved(6)(route); } });
      await ready(page);
      await expect(line(page)).toHaveAttribute("data-autosave-state", "idle");
      await addSon(page);
      await expect(line(page).getByText(text.results.saving, { exact: true })).toBeVisible();
      await expect(line(page).getByText(text.results.saved, { exact: true })).toBeVisible();
      await page.waitForTimeout(1500);
      expect(api.autosavePosts).toHaveLength(1);
      expect(JSON.parse(api.autosavePosts[0].body)).toEqual({ case_id: base.id, case_revision: 6 });
      expect(api.autosavePosts[0].csrf).toBe("e2e-token");
    });

    test("a conflict shows the two choices and editing still works without another request", async ({ page, api }) => {
      const base = interview(api, { revision: 5 });
      api.set({ postAutosave: json(409, { error: "conflict", code: "saved_case_conflict", detail: "x", revision: 9, saved_id: 7, saved_name: "Mother's estate", working_case_id: base.id, working_revision: 6 }) });
      await ready(page);
      await addSon(page);
      await expect(line(page).getByText(text.results.saveConflict, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: text.results.conflictOpenLatest })).toBeVisible();
      await expect(page.getByRole("button", { name: text.results.conflictSaveAsNew })).toBeVisible();
      await addSon(page);
      await expect(page.locator("[data-node='son-7']")).toBeVisible();
      await page.waitForTimeout(1500);
      expect(api.autosavePosts).toHaveLength(1);
    });

    test("a failure shows Retry and Retry succeeds", async ({ page, api }) => {
      interview(api, { revision: 5 });
      let calls = 0;
      api.set({ postAutosave: (route) => (++calls === 1 ? json(500, {})(route) : saved(6)(route)) });
      await ready(page);
      await addSon(page);
      await expect(line(page).getByText(text.results.saveError, { exact: true })).toBeVisible();
      await expect(page.locator("[data-node='son-6']")).toBeVisible();
      await page.getByRole("button", { name: text.results.saveRetry }).click();
      await expect(line(page).getByText(text.results.saved, { exact: true })).toBeVisible();
      expect(api.autosavePosts).toHaveLength(2);
    });

    test("sign-out after a failed autosave asks before discarding the family", async ({ page, api }) => {
      interview(api, { revision: 5 });
      api.set({ postAutosave: json(500, {}) });
      const logoutPosts = await stubLogout(page, api);
      await ready(page);
      await addSon(page);
      await expect(line(page).getByText(text.results.saveError, { exact: true })).toBeVisible();
      const dialog = page.locator("dialog[open]");
      const keep = dialog.getByRole("button", { name: text.cases.discardNo });
      await logoutButton(page).click();
      await expect(dialog.getByRole("heading", { name: text.cases.discardTitle })).toBeVisible();
      await expect(keep).toBeFocused();
      expect(logoutPosts).toHaveLength(0);
      await keep.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-node='son-6']")).toBeVisible();
      expect(logoutPosts).toHaveLength(0);

      await logoutButton(page).click();
      await expect(keep).toBeFocused();
      expect(logoutPosts).toHaveLength(0);
      await dialog.getByRole("button", { name: text.nav.discardAndSignOut }).click();
      await page.waitForURL(`**/${locale}/`);
      expect(logoutPosts).toHaveLength(1);
    });

    test("sign-out waits for a successful autosave and skips the discard prompt", async ({ page, api }) => {
      const base = interview(api, { revision: 5 });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => { release = resolve; });
      api.set({ postAutosave: async (route) => { await gate; await saved(6)(route); } });
      const logoutPosts = await stubLogout(page, api);
      await ready(page);
      await addSon(page);
      await expect(page.locator("[data-node='son-6']")).toBeVisible();
      try {
        await logoutButton(page).click();
        await expect.poll(() => api.autosavePosts.length).toBe(1);
        await expect(page.locator("dialog[open]")).toHaveCount(0);
        expect(logoutPosts).toHaveLength(0);
      } finally {
        release();
      }
      await page.waitForURL(`**/${locale}/`);
      expect(logoutPosts).toHaveLength(1);
      expect(api.autosavePosts.map((post) => JSON.parse(post.body))).toEqual([{ case_id: base.id, case_revision: 6 }]);
    });

    test("an expired session returns from sign-in and retries the same Case once", async ({ page, api }) => {
      const base = interview(api, { revision: 5 });
      const path = `/${locale}/interview/`;
      api.set({ postAutosave: (route) => {
        api.set({ session: sessionAnonymous });
        return json(403, { detail: "auth" })(route);
      } });
      await page.route("**/api/v1/auth/login/", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        api.set({ session: sessionAuthenticated, postAutosave: saved(6) });
        const next = JSON.parse(route.request().postData() ?? "{}").next;
        return json(200, { redirect: next })(route);
      });
      await ready(page);
      await addSon(page);
      await expect(line(page).getByText(text.results.saveError, { exact: true })).toBeVisible();
      const dialog = page.getByRole("dialog", { name: text.results.authTitle });
      await expect(dialog).toBeVisible();
      const signIn = dialog.getByRole("link", { name: text.results.signIn });
      await expect(signIn).toHaveAttribute("href", `/${locale}/login/?next=${encodeURIComponent(path)}`);
      expect(api.autosavePosts).toHaveLength(1);
      await signIn.click();
      await page.waitForURL(`**/${locale}/login/**`);
      await expect(page.getByRole("button", { name: text.auth.facebook })).toBeEnabled();
      await page.locator("input[name=username]").fill("owner");
      await page.locator("input[name=password]").fill("secret-pass-1");
      await page.locator("input[name=password]").press("Enter");
      await page.waitForURL(`**${path}`);
      await expect(line(page).getByText(text.results.saved, { exact: true })).toBeVisible();
      const marker = await page.evaluate(() => {
        try { return sessionStorage.getItem("mawareeth.autosave.resume"); } catch { return undefined; }
      });
      expect(marker).toBeNull();
      const request = { case_id: base.id, case_revision: 6 };
      expect(api.autosavePosts.map((post) => JSON.parse(post.body))).toEqual([request, request]);
      expect(api.heirPosts).toHaveLength(1);
    });

    test("a never-saved Case sends no autosave request", async ({ page, api }) => {
      interview(api, null);
      // A returning guest with a never-saved Case is asked first; continuing opens the same Interview.
      await page.goto(`/${locale}/interview/`);
      await page.getByRole("button", { name: text.interview.resume }).click();
      await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor();
      await addSon(page);
      await expect(page.locator("[data-node='son-6']")).toBeVisible();
      await page.waitForTimeout(1500);
      expect(api.autosavePosts).toHaveLength(0);
      await expect(line(page)).toHaveCount(0);
    });

    test("opening another Case with a failing save tries it once more and asks before discarding", async ({ page, api }) => {
      interview(api, { revision: 5 });
      api.set({ postAutosave: json(500, {}) });
      await ready(page);
      await addSon(page);
      await expect(line(page).getByText(text.results.saveError, { exact: true })).toBeVisible();
      expect(api.autosavePosts).toHaveLength(1);
      // The site navigation keeps the page (and the coordinator), so My cases flushes first.
      await page.getByRole("link", { name: text.nav.cases }).click();
      await page.getByRole("button", { name: text.cases.open, exact: true }).click();
      await expect(page.locator("dialog[open]").getByRole("heading", { name: text.cases.discardTitle })).toBeVisible();
      // Leaving the Interview sent it once more, and My cases tried the failed revision again before asking.
      expect(api.autosavePosts.length).toBeGreaterThanOrEqual(2);
      expect(api.openPosts).toHaveLength(0);
    });
  });
}
