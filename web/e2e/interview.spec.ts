import type { Page } from "@playwright/test";

import { messages, locales, directionOf } from "../src/i18n/messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { openHeirsScreen } from "./family";
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
const contracts = join(process.cwd(), "..", "api", "contracts");
const served = JSON.parse(readFileSync(join(contracts, "preview-presented-fixtures.json"), "utf8")) as {
  presented: Record<string, unknown>;
  chosen: Record<string, Record<string, unknown>>;
};
// The shared preview fixtures as the server serves them: each legacy body with the PresentedResult beside it,
// and each school's body in a choice with that school's own PresentedResult.
const fixtures = (
  JSON.parse(readFileSync(join(contracts, "preview-fixtures.json"), "utf8")) as { fixtures: PreviewFixture[] }
).fixtures.map((fixture) => {
  const response: PreviewFixture["response"] = { ...fixture.response, presented: served.presented[fixture.title] };
  const chosen = served.chosen[fixture.title];
  if (chosen) {
    response.schools = Object.fromEntries(
      Object.entries(response.schools as Record<string, Record<string, unknown>>).map(([school, body]) => [school, { ...body, presented: chosen[school] }]),
    );
  }
  return { ...fixture, response };
});
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
    expect(JSON.parse(api.casePosts[0].body)).toEqual({ replace: true, case_id: "0123456789abcdef", expected_revision: 1 });
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
    // Each school's summary is the presented comparison's own text.
    for (const school of differ.response.presented.comparison.schools) {
      await expect(choice.getByText(school.label, { exact: true }).first()).toBeVisible();
      for (const share of school.shares.filter((item: { blocked: boolean }) => !item.blocked)) {
        await expect(choice.getByText(share.share.text, { exact: false }).first()).toBeVisible();
      }
    }
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
    expect(JSON.parse(api.casePatches[0].body)).toEqual({ madhab: "hanafi", case_id: differ.case.id, expected_revision: 1 });
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

test.describe("revisions and connection", () => {
  test("a preview computed for an older revision is never shown", async ({ page, api }) => {
    const agree = fixture("Agree: wife, son and daughter in every school");
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: fullCase(agree.case, { revision: 2 }) }),
      getPreview: json(200, { ...agree.response, revision: 1 }),
    });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await expect.poll(() => api.previewGets).toBeGreaterThan(0);
    await expect(page.getByText(en.previewWaiting)).toBeVisible();
    await expect(page.getByText(en.schoolsAgree)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: en.previewHeading })).toBeVisible();
    await expect(page.getByText(en.previewUpdated)).toHaveCount(0);
  });

  test("offline, editing is blocked with a notice and nothing is sent; online it comes back", async ({ page, context, api }) => {
    const agree = fixture("Agree: wife, son and daughter in every school");
    api.set({ session: sessionAnonymous, getCase: json(200, { case: fullCase(agree.case) }), getPreview: json(200, agree.response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const add = page.getByRole("button", { name: en.heirAdd, exact: true });
    await expect(add).toHaveAttribute("aria-disabled", "false");
    await expect(page.getByText(en.offlineEditing)).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByText(en.offlineEditing)).toBeVisible();
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await add.click({ force: true });
    // The family and the last preview stay visible, and no write was attempted (an unstubbed request fails the test).
    await expect(page.getByText(en.schoolsAgree)).toBeVisible();
    expect(api.casePosts).toHaveLength(0);

    await context.setOffline(false);
    await expect(page.getByText(en.offlineEditing)).toHaveCount(0);
    await expect(add).toHaveAttribute("aria-disabled", "false");
  });
});

test.describe("interview shell", () => {
  const regions = (page: Page) => ({
    add: page.locator("section[aria-labelledby='heir-form-heading']"),
    tree: page.locator("section[data-tree]"),
    list: page.locator("section[aria-labelledby='heirs-heading']"),
  });
  const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;

  test("regions are named and in order, stacked on a phone with 16px gutters", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, "en");
    const { add, tree, list } = regions(page);
    await expect(page.getByRole("region", { name: en.heirAddHeading })).toBeVisible();
    await expect(page.getByRole("region", { name: en.treeHeading })).toBeVisible();
    const [a, t, l] = [await box(add), await box(tree), await box(list)];
    expect(a.y).toBeLessThan(t.y);
    expect(t.y).toBeLessThan(l.y);
    expect(a.x).toBeCloseTo(16, 0);
    expect(a.x + a.width).toBeCloseTo(375 - 16, 0);
    const order = await page.evaluate(() => {
      const sel = ["section[aria-labelledby='heir-form-heading']", "section[data-tree]", "section[aria-labelledby='heirs-heading']"];
      const nodes = sel.map((s) => document.querySelector(s)!);
      return nodes.every((n, i) => i === 0 || !!(nodes[i - 1].compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(order).toBe(true);
  });

  test("at 1100px a 380px column sits beside the tree; the preview spans below", async ({ page, api }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openHeirsScreen(page, api, "en");
    const { add, tree, list } = regions(page);
    const [a, t, l] = [await box(add), await box(tree), await box(list)];
    expect(a.width).toBeCloseTo(380, 0);
    expect(l.width).toBeCloseTo(380, 0);
    expect(t.x).toBeGreaterThan(a.x + a.width - 1);
    expect(l.y).toBeGreaterThan(a.y);
    expect(Math.abs(l.x - a.x)).toBeLessThan(1);
    const pv = await box(page.locator("section[aria-labelledby='preview-heading']"));
    expect(Math.abs(pv.x - a.x)).toBeLessThan(1);
    expect(pv.x + pv.width).toBeCloseTo(t.x + t.width, 0);
    expect(pv.y).toBeGreaterThanOrEqual(l.y + l.height - 1);
    expect(pv.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
  });

  test("at 1366px the shell is at most 1360px with a 340px preview column", async ({ page, api }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await openHeirsScreen(page, api, "en");
    const { add, tree } = regions(page);
    const grid = await box(page.locator("[data-wide]").filter({ has: add }).first());
    expect(grid.width).toBeLessThanOrEqual(1360);
    const [a, t] = [await box(add), await box(tree)];
    expect(a.width).toBeCloseTo(380, 0);
    expect(grid.x + grid.width - (t.x + t.width)).toBeGreaterThanOrEqual(340);
    const pv = await box(page.locator("section[aria-labelledby='preview-heading']"));
    expect(pv.width).toBeCloseTo(340, 0);
    expect(pv.x).toBeGreaterThanOrEqual(t.x + t.width - 1);
    expect(Math.abs(pv.y - t.y)).toBeLessThan(2);
  });

  test("in Arabic the 380px column is at the inline-start (right) side", async ({ page, api }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openHeirsScreen(page, api, "ar");
    const { add, tree } = regions(page);
    const [a, t] = [await box(add), await box(tree)];
    expect(a.width).toBeCloseTo(380, 0);
    expect(a.x).toBeGreaterThan(t.x);
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toContain("Noto Naskh Arabic");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`phase-2 tokens resolve in ${scheme} mode`, async ({ page, api }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openHeirsScreen(page, api, "en");
      const tokens = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return ["graphic", "accent-soft", "blocked-stripe", "toast-focus"].map((name) => style.getPropertyValue(`--${name}`).trim());
      });
      const full = tokens.map((hex) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex));
      expect(full).toEqual(scheme === "light" ? ["#76887f", "#e3f1ee", "#e8efec", "#ffffff"] : ["#5f7a6e", "#0f2a26", "#16231f", "#0a0a0a"]);
    });

    test(`controls are 44px and focus is a 2px outline in ${scheme} mode`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1366, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await openHeirsScreen(page, api, "en");
      const small = await page.evaluate(() => {
        const root = document.querySelector("[data-js-only]")!;
        const controls = [...root.querySelectorAll<HTMLElement>("button, input:not([type=radio]):not([type=hidden]), select, textarea, label:has(input[type=radio])")];
        return controls
          .filter((el) => el.getClientRects().length > 0 && !el.closest("[data-tree-area]") && !el.closest("table"))
          .map((el) => ({ text: (el.textContent ?? el.tagName).trim().slice(0, 30), height: el.getBoundingClientRect().height }))
          .filter((item) => item.height < 43.5);
      });
      expect(small).toEqual([]);
      let reached = false;
      for (let step = 0; step < 60 && !reached; step += 1) {
        await page.keyboard.press("Tab");
        reached = await page.evaluate(() => document.activeElement?.tagName === "BUTTON" && !!document.activeElement.closest("[data-js-only]"));
      }
      expect(reached).toBe(true);
      const ring = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement!);
        return [style.outlineStyle, style.outlineWidth, style.outlineOffset, style.boxShadow];
      });
      expect(ring).toEqual(["solid", "2px", "2px", "none"]);
    });
  }

  test("a layered case keeps the breadcrumb above the grid, before Add relatives", async ({ page, api }) => {
    const layered = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as {
      fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[];
    }).fixtures.find((item) => item.title === "Agree layered: wife and two sons, a son dies")!;
    const served = JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-presented-fixtures.json"), "utf8")) as {
      presented: Record<string, unknown>;
    };
    await page.setViewportSize({ width: 1100, height: 900 });
    api.set({
      session: sessionAnonymous,
      getCase: json(200, {
        case: fullCase(layered.case, {
          deaths: (layered.case.deaths as { heirs: Record<string, unknown>[] }[]).map((death) => ({
            ...death,
            heir_options: { blocked: [], invalid: {} },
            heirs: death.heirs.map((heir) => ({ ...heir, edit_options: { blocked: [], invalid: {} } })),
          })),
        }),
      }),
      getPreview: json(200, { ...layered.response, presented: served.presented[layered.title] }),
    });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const nav = page.getByRole("navigation", { name: en.deathsNavLabel });
    await expect(nav).toBeVisible();
    const gap = await page.evaluate(() => {
      const crumb = document.querySelector("nav[data-focus='breadcrumb']")!.getBoundingClientRect();
      const grid = document.querySelector("section[aria-labelledby='heir-form-heading']")!.closest("[data-wide]")!.getBoundingClientRect();
      return grid.top - crumb.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
    const precedes = await page.evaluate(() => {
      const crumb = document.querySelector("nav[data-focus='breadcrumb']")!;
      const form = document.querySelector("section[aria-labelledby='heir-form-heading']")!;
      return !!(crumb.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(precedes).toBe(true);
    await page.locator("[data-focus^='openLayer:']").first().click();
    const first = page.locator("button[data-focus='layer:first']");
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.locator("span[data-focus='layer:first'][aria-current]")).toBeVisible();
  });
});
