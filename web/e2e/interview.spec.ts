import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { messages, locales, directionOf } from "../src/i18n/messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { closePreview, lineageFixture, openCanvasFixture, openHeirsScreen, openPreview, openPreviewAnywhere, sheetOf } from "./family";
import { abort, CASE, expect, expiredCase, fullCase, json, liveCase, noCase, sessionAnonymous, startedCase, test, watchErrors, type Stubs } from "./api";

const en = messages.en.interview;

/** A restore POST body with its `snapshot_gz` (gzipped+base64) decoded back to `snapshot`, so an
 * assertion reads the snapshot the Undo sent. A body that still carries a plain `snapshot` is
 * returned unchanged. */
function restoreBody(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.snapshot_gz === "string") {
    const { snapshot_gz, ...rest } = parsed;
    return { ...rest, snapshot: JSON.parse(gunzipSync(Buffer.from(snapshot_gz, "base64")).toString("utf8")) };
  }
  return parsed;
}

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

  test("a Saved case ahead of its save shows the notice, and start over warns and focuses the safe choice", async ({ page, api }) => {
    const ahead = (saved: unknown) => json(200, { case: { ...CASE, saved } });
    api.set({ session: sessionAnonymous, getCase: ahead({ revision: 1 }), postCase: startedCase("fedcba9876543210") });
    await page.goto("/en/interview/");
    // A linked working copy opens directly: no resume prompt, and no notice while it is saved.
    await expect(page.getByRole("button", { name: en.resume })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: en.started })).toBeVisible();
    await expect(page.getByText(en.unsavedNotice)).toHaveCount(0);
    // Start over tries the unsaved revision first; here the save fails, so the question names what would be lost.
    api.set({ getCase: ahead({ revision: null }), postAutosave: json(500, {}) });
    await page.goto("/en/interview/");
    await expect(page.getByText(en.unsavedNotice)).toBeVisible();
    await expect(page.getByRole("link", { name: en.unsavedLink })).toHaveAttribute("href", "/en/results/");
    await page.getByRole("button", { name: en.startOver }).click();
    await expect(page.getByText(en.startOverUnsaved)).toBeVisible();
    await expect(page.getByRole("button", { name: en.startOverNo })).toBeFocused();
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
    test(`a server-coded expiry shows the title, the lifetime and one Start action in ${locale}`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: expiredCase, postCase: startedCase() });
      await page.goto(`/${locale}/interview/`);
      await expect(page.getByRole("heading", { name: text.expiredTitle })).toBeVisible();
      await expect(page.getByText(text.expiredLifetime)).toBeVisible();
      await expect(page.getByRole("button", { name: text.start, exact: true })).toHaveCount(1);
      await expect(page.getByRole("button", { name: text.resume })).toHaveCount(0);
      expect(api.casePosts).toHaveLength(0);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    });
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
    // The agreement line is the presented one, above the rows, and no School is named.
    await expect(page.locator("[data-summary-bar]")).toBeVisible();
    const sheet = await openPreview(page);
    await expect(sheet.locator("[data-school-agreement]")).toHaveText(agree.response.presented.school_line.text);
    await expect(sheet.locator("ul > li").first()).toBeVisible();
    await expect(sheet.locator("[data-school-choice]")).toHaveCount(0);
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
    const sheet = await openPreview(page);
    const choice = sheet.locator("[data-school-choice]");
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
    const group = sheet.getByRole("radiogroup", { name: en.chooseSchool });
    await expect(group.getByRole("radio")).toHaveCount(4);
    await expect(group.getByRole("radio", { name: en.madhabs.jafari.name })).toHaveCount(0);
    // Continue with nothing picked says what is needed and saves nothing.
    await sheet.getByRole("button", { name: en.madhabContinue }).click();
    await expect(choice.getByRole("alert")).toHaveText(en.chooseSchool);
    expect(api.casePatches).toHaveLength(0);
    await group.getByRole("radio", { name: en.madhabs.hanafi.name }).check();
    await expect(choice.getByRole("alert")).toHaveCount(0);
    await sheet.getByRole("button", { name: en.madhabContinue }).click();
    await expect(page.getByText(en.schoolsDiffer)).toHaveCount(0);
    await expect(page.getByText(`${en.madhabLabel}:`)).toBeVisible();
    expect(api.casePatches).toHaveLength(1);
    expect(JSON.parse(api.casePatches[0].body)).toEqual({ madhab: "hanafi", case_id: differ.case.id, expected_revision: 1 });
    // The refreshed Share preview names the chosen School and shows its rows: Hanafi blocks the brother.
    const chosenPresented = differ.response.schools.hanafi.presented;
    await expect(sheet.getByText(en.previewSchool.split("{school}").join(chosenPresented.school_line.text))).toBeVisible();
    await expect(sheet.getByText(en.treeNoShare)).toHaveCount(1);
    await expect(sheet.getByText("1/1").first()).toBeVisible();
    // Full results names the same School and lists the brother with no share.
    await sheet.getByRole("link", { name: en.previewResultsLink }).click();
    await expect(page).toHaveURL(/\/en\/results\//);
    await expect(page.getByText(messages.en.results.school.split("{school}").join(chosenPresented.school_line.text))).toBeVisible();
    await expect(page.getByText(chosenPresented.rows[1].relationship.translated.text).first()).toBeVisible();
  });

  test("a refusal in one school is shown in that school's summary", async ({ page, api }) => {
    const refusal = fixture("Refusal: Malikiyya makes the schools differ");
    api.set({ session: sessionAnonymous, getCase: json(200, { case: fullCase(refusal.case) }), getPreview: json(200, refusal.response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const sheet = await openPreview(page);
    const choice = sheet.locator("[data-school-choice]");
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
    // Nothing of the older answer is shown: no summary bar, no sheet, and the signal stays pending.
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "pending");
    await expect(page.locator("[data-summary-bar]")).toHaveCount(0);
    await expect(sheetOf(page).locator("ul > li")).toHaveCount(0);
    await expect(page.getByText(en.previewUpdated)).toHaveCount(0);
  });

  test("offline, editing is blocked with a notice and nothing is sent; online it comes back", async ({ page, context, api }) => {
    const agree = fixture("Agree: wife, son and daughter in every school");
    api.set({ session: sessionAnonymous, getCase: json(200, { case: fullCase(agree.case) }), getPreview: json(200, agree.response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const add = page.getByRole("button", { name: "Add Son", exact: true });
    await expect(add).toHaveAttribute("aria-disabled", "false");
    await expect(page.getByText(en.offlineEditing)).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByText(en.offlineEditing)).toBeVisible();
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await add.click({ force: true });
    // The family stays visible, and no write was attempted (an unstubbed request fails the test).
    expect(api.casePosts).toHaveLength(0);
    // The last preview stays reachable: the bar stays, and the sheet shows its rows.
    await expect(page.locator("[data-summary-bar]")).toBeVisible();
    const sheet = await openPreview(page);
    await expect(sheet.locator("ul > li").first()).toBeVisible();
    await closePreview(page);

    await context.setOffline(false);
    await expect(page.getByText(en.offlineEditing)).toHaveCount(0);
    await expect(add).toHaveAttribute("aria-disabled", "false");
  });
});

test.describe("add relatives", () => {
  const agree = fixture("Agree: wife, son and daughter in every school");
  const base = () => fullCase(agree.case) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const open = async (page: Page, api: Parameters<typeof openHeirsScreen>[1], kase: Record<string, unknown>, getPreview: Stubs["getPreview"] = json(200, agree.response)) => {
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await page.locator("#add-relatives-heading").waitFor();
  };
  const son = (id: string) => ({ id, relationship: "son", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } });

  test("one press posts one add with no name, shows the returned case and keeps focus on the button", async ({ page, api }) => {
    const kase = base();
    const sons = kase.heirs.filter((h: { relationship: string }) => h.relationship === "son");
    expect(sons).toHaveLength(1);
    await open(page, api, kase);
    const returned = { ...kase, revision: (kase.revision as number) + 1, heirs: [...kase.heirs, son("new-son")] };
    api.set({ postHeir: json(201, { case: returned }) });
    const button = page.getByRole("button", { name: "Add Son", exact: true });
    await button.click();
    await expect(page.locator("section[aria-labelledby='heirs-heading']").getByText("Son 2", { exact: true }).first()).toBeVisible();
    await expect(page.locator("section[data-tree]").getByText("Son 2", { exact: true }).first()).toBeVisible();
    expect(api.heirPosts).toHaveLength(1);
    const body = JSON.parse(api.heirPosts[0].body);
    expect(body.relationship).toBe("son");
    expect(body.name ?? null).toBeNull();
    expect(body.expected_revision).toBe(kase.revision);
    await expect(button).toBeFocused();
    await expect(page.locator("[aria-live='polite'], [role='status']").filter({ hasText: "Son 2 added." }).first()).toBeAttached();
  });

  test("adding four daughters sends one bulk command, updates the tree, list and preview, and announces the group", async ({ page, api }) => {
    const kase = base();
    kase.deceased = { ...kase.deceased, estate: null };
    kase.heirs = kase.heirs.filter((h: { relationship: string }) => h.relationship !== "daughter");
    const daughters = Array.from({ length: 4 }, (_, i) => ({
      ...son(`daughter-${i + 1}`), relationship: "daughter", gender: "female",
    }));
    const returned = { ...kase, revision: kase.revision + 1, heirs: [...kase.heirs, ...daughters] };
    const previewFor = (revision: number, heirs: { id: string; relationship: string }[], total: number, fractions: [number, number][]) => {
      const { response } = agree;
      const rows = heirs.map(({ id, relationship }, index) => {
        const template = ["wife", "son", "daughter"].indexOf(relationship);
        const [numerator, denominator] = fractions[index];
        const fraction = { numerator, denominator };
        const value = total * numerator / denominator;
        const presented = response.presented.rows[template];
        return {
          share: { heir_id: id, ...fraction, blocked: false, amount: null },
          proof: { ...response.proof.heirs.find((entry: { heir: string }) => entry.heir === presented.person), heir: id, share: fraction },
          cell: { heir: id, blocked: false, prescribed: relationship === "wife" ? fraction : null, group_span: 1, cells: [{ value, span: 1 }] },
          presented: {
            ...presented, person: id, amount: null,
            share: { fraction, text: `${fraction.numerator}/${fraction.denominator}`, dir: "ltr" },
            percent: { ...presented.percent, text: `${(100 * value / total).toFixed(1)}%` },
            kirat: { ...presented.kirat, text: (24 * value / total).toFixed(2) },
          },
        };
      });
      return json(200, {
        ...response, revision,
        basis: { ...response.basis, estate: null, heirs: heirs.map(({ id, relationship }) => ({ id, relationship })) },
        shares: rows.map((row) => row.share),
        proof: { ...response.proof, heirs: rows.map((row) => row.proof), steps: [{ ...response.proof.steps[0], value: total }] },
        table: { columns: [{ ...response.table.columns[0], total }], rows: rows.map((row) => row.cell) },
        presented: { ...response.presented, rows: rows.map((row) => row.presented), evidence: [], table: null },
      });
    };
    let revision = kase.revision;
    const before = previewFor(kase.revision, kase.heirs, 8, [[1, 8], [7, 8]]);
    const after = previewFor(returned.revision, returned.heirs, 48, [[1, 8], [7, 24], ...daughters.map((): [number, number] => [7, 48])]);
    api.set({ postBulk: (route) => {
      revision = returned.revision;
      return json(201, { case: returned })(route);
    } });
    await open(page, api, kase, (route) => (revision === returned.revision ? after : before)(route));
    const settled = page.locator("[data-preview-state]");
    await expect(settled).toHaveAttribute("data-preview-state", "ready");
    await expect(settled).toHaveAttribute("data-preview-revision", String(kase.revision));
    // Before the add the sheet shows 7/8 for the son.
    let sheet = await openPreview(page);
    await expect(sheet.getByText("7/8", { exact: true }).first()).toBeVisible();
    await closePreview(page);
    const more = page.getByRole("button", { name: "One more Daughter", exact: true });
    const count = page.getByLabel("Number of Daughter to add", { exact: true });
    const list = page.locator("section[aria-labelledby='heirs-heading']");
    for (let press = 0; press < 3; press++) await more.click();
    await expect(count).toHaveText("4");
    await expect(page.locator("[role='status'][aria-atomic='true']")).toBeEmpty();
    expect(api.bulkPosts).toHaveLength(0);
    const add = page.getByRole("button", { name: "Add Daughter", exact: true });
    await expect(add).toHaveAccessibleDescription(/\b4$/);
    await add.click();
    await expect(page.locator("[role='status'][aria-atomic='true']")).toHaveText(/^4 × Daughter added\./);
    for (const [index, daughter] of daughters.entries()) {
      const label = `Daughter ${index + 1}`;
      await expect(list.getByText(label, { exact: true }).first()).toBeVisible();
      await expect(page.locator(`[data-node="${daughter.id}"]`)).toContainText(label);
    }
    await expect(settled).toHaveAttribute("data-preview-state", "ready");
    await expect(settled).toHaveAttribute("data-preview-revision", String(returned.revision));
    await expect(count).toHaveText("1");
    await expect(add).toBeFocused();
    expect(api.bulkPosts).toHaveLength(1);
    expect(JSON.parse(api.bulkPosts[0].body)).toEqual({
      case_id: kase.id, expected_revision: kase.revision,
      heirs: Array(4).fill({ relationship: "daughter", name: null }),
    });
    expect(api.heirPosts).toHaveLength(0);
    // After the add the sheet shows the 7/48 row for Daughter 4 and no 7/8.
    sheet = await openPreview(page);
    await expect(sheet.locator("ul > li").filter({ hasText: "Daughter 4" })).toContainText("7/48");
    await expect(sheet.getByText("7/8", { exact: true })).toHaveCount(0);
    await closePreview(page);
  });

  test("a refused pair of fathers keeps the count, focus and accepted family", async ({ page, api }) => {
    const kase = base();
    await open(page, api, kase);
    const nodes = page.locator("[data-node]");
    const rows = page.locator("section[aria-labelledby='heirs-heading'] ul > li:visible");
    await expect(nodes).toHaveCount(kase.heirs.length + 1);
    await expect(rows).toHaveCount(kase.heirs.length + 1);
    const nodeIds = () => nodes.evaluateAll((cards) => cards.map((card) => card.getAttribute("data-node")));
    const beforeNodes = await nodeIds();
    const beforeRows = await rows.allInnerTexts();
    const reads = api.caseGets;
    api.set({ postBulk: json(400, { error: "invalid_input", errors: { "1": { relationship: "second_father" } } }) });
    await page.getByRole("button", { name: "One more Father", exact: true }).click();
    const add = page.getByRole("button", { name: "Add Father", exact: true });
    await add.click();
    await expect(page.getByRole("alert").filter({ hasText: en.fieldErrors.relationship.second_father })).toHaveText(en.fieldErrors.relationship.second_father);
    await expect(page.getByLabel("Number of Father to add")).toHaveText("2");
    await expect(add).toBeFocused();
    expect(await nodeIds()).toEqual(beforeNodes);
    expect(await rows.allInnerTexts()).toEqual(beforeRows);
    expect(api.bulkPosts).toHaveLength(1);
    expect(api.heirPosts).toHaveLength(0);
    expect(api.caseGets).toBe(reads + 1);
  });

  test("the plus button stays focused at remaining capacity", async ({ page, api }) => {
    const kase = { ...base(), heirs: Array.from({ length: 47 }, (_, i) => son(`son${i}`)) };
    await open(page, api, kase);
    const more = page.getByRole("button", { name: "One more Son", exact: true });
    await more.click();
    await more.click();
    await expect(more).toHaveAttribute("aria-disabled", "true");
    await more.press("Enter");
    await expect(more).toBeFocused();
    await expect(page.getByLabel("Number of Son to add")).toHaveText("3");
    expect(api.bulkPosts).toHaveLength(0);
    expect(api.heirPosts).toHaveLength(0);
  });

  test("switching estates resets the count and uses the active estate's remaining capacity", async ({ page, api }) => {
    const heirs = Array.from({ length: 47 }, (_, i) => son(`first-son-${i}`));
    const kase = {
      ...base(),
      heirs,
      deaths: [{
        heir_id: heirs[0].id, order: 2, gender: "male", heir_options: { blocked: [], invalid: {} },
        heirs: Array.from({ length: 48 }, (_, i) => son(`later-son-${i}`)),
      }],
    };
    await open(page, api, kase, json(200, { status: "not_ready" }));
    const more = page.getByRole("button", { name: "One more Son", exact: true });
    const count = page.getByLabel("Number of Son to add", { exact: true });
    await more.click();
    await more.click();
    await expect(count).toHaveText("3");
    await expect(more).toHaveAttribute("aria-disabled", "true");

    await page.locator(`[data-focus="openLayer:${heirs[0].id}"]`).click();
    await expect(count).toHaveText("1");
    await expect(more).toHaveAttribute("aria-disabled", "false");
    await more.click();
    await expect(count).toHaveText("2");
    await expect(more).toHaveAttribute("aria-disabled", "true");
  });

  test("a stale revision with the same case id shows the returned case and an alert", async ({ page, api }) => {
    const kase = base();
    await open(page, api, kase);
    const live = { ...kase, revision: (kase.revision as number) + 4, heirs: [...kase.heirs, son("other-tab")] };
    api.set({ postHeir: json(409, { case: live }) });
    const button = page.getByRole("button", { name: "Add Son", exact: true });
    await button.click();
    await expect(page.getByRole("alert").filter({ hasText: en.conflictNotice })).toBeVisible();
    await expect(page.locator("#add-relatives-heading")).toBeVisible();
    await expect(button).toBeFocused();
    expect(api.heirPosts).toHaveLength(1);
  });

  test("a stale revision on the deceased form keeps the form and typed value and shows an alert", async ({ page, api }) => {
    const kase = base();
    await open(page, api, kase);
    const live = { ...kase, revision: (kase.revision as number) + 4, heirs: [...kase.heirs, son("other-tab")] };
    api.set({ putDeceased: json(409, { error: "conflict", case: live }) });
    await page.getByRole("button", { name: en.deceasedEdit }).click();
    const estate = page.getByLabel(en.estateLabel);
    await estate.fill("4321");
    await page.getByRole("button", { name: en.deceasedSave }).click();
    await expect(page.getByRole("alert").filter({ hasText: en.conflictNotice })).toBeVisible();
    await expect(page.getByRole("heading", { name: en.deceasedHeading })).toBeVisible();
    await expect(estate).toHaveValue("4321");
    await expect(page.getByText(en.existing)).toHaveCount(0);
    expect(api.deceasedPuts).toHaveLength(1);

    api.set({ putDeceased: json(200, { case: { ...live, revision: live.revision + 1, deceased: { ...kase.deceased, estate: "4321" } } }) });
    await page.getByRole("button", { name: en.deceasedSave }).click();
    await expect(page.getByRole("heading", { name: en.deceasedHeading })).toHaveCount(0);
    expect(api.deceasedPuts).toHaveLength(2);
    expect(JSON.parse(api.deceasedPuts[1].body)).toMatchObject({ expected_revision: live.revision, estate: "4321" });
    await expect(page.getByRole("alert").filter({ hasText: en.conflictNotice })).toHaveCount(0);
  });

  test("a stale revision on the school choice keeps the selector and the pick and shows an alert", async ({ page, api }) => {
    const kase = { ...base(), madhab: "hanafi" } as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    await open(page, api, kase);
    const live = { ...kase, revision: (kase.revision as number) + 4 };
    api.set({ patchCase: json(409, { error: "conflict", case: live }) });
    await page.getByRole("button", { name: en.madhabChange }).click();
    const group = page.getByRole("radiogroup", { name: en.madhabLegend });
    await group.getByRole("radio", { name: en.madhabs.maliki.name }).check();
    await page.getByRole("button", { name: en.madhabContinue }).click();
    await expect(page.getByRole("alert").filter({ hasText: en.conflictNotice })).toBeVisible();
    await expect(group.getByRole("radio", { name: en.madhabs.maliki.name })).toBeChecked();
    await expect(page.getByText(en.existing)).toHaveCount(0);
    expect(api.casePatches).toHaveLength(1);

    api.set({ patchCase: json(200, { case: { ...live, revision: live.revision + 1, madhab: "maliki" } }) });
    await page.getByRole("button", { name: en.madhabContinue }).click();
    await expect(group).toHaveCount(0);
    expect(api.casePatches).toHaveLength(2);
    expect(JSON.parse(api.casePatches[1].body)).toMatchObject({ expected_revision: live.revision, madhab: "maliki" });
    await expect(page.getByRole("alert").filter({ hasText: en.conflictNotice })).toHaveCount(0);
  });

  test("at 50 heirs the limit shows and every add button is aria-disabled", async ({ page, api }) => {
    const kase = { ...base(), heirs: Array.from({ length: 50 }, (_, i) => son(`m${i}`)) };
    await open(page, api, kase);
    await expect(page.getByText(en.fieldErrors.heirs.limit).first()).toBeVisible();
    const buttons = page.locator("section[aria-labelledby='add-relatives-heading'] button[data-focus^='add:']");
    expect(await buttons.count()).toBeGreaterThan(4);
    for (const button of await buttons.all()) await expect(button).toHaveAttribute("aria-disabled", "true");
    await buttons.first().click({ force: true });
    expect(api.heirPosts).toHaveLength(0);
  });

  test("after adding a father his button is gone and focus lands on the panel heading", async ({ page, api }) => {
    const parents = [{ relationship: "father", link: "parent", blocked: false }, { relationship: "mother", link: "parent", blocked: false }];
    const kase = base();
    kase.placement = { root: parents };
    await open(page, api, kase);
    const father = { id: "new-father", relationship: "father", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } };
    const returned = { ...kase, revision: (kase.revision as number) + 1, heirs: [...kase.heirs, father], placement: { root: parents.slice(1) } };
    api.set({ postHeir: json(201, { case: returned }) });
    await page.getByRole("button", { name: "Add Father", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add Father", exact: true })).toHaveCount(0);
    await expect(page.locator("#add-relatives-heading")).toBeFocused();
    expect(api.heirPosts).toHaveLength(1);
  });

  test("row Edit opens the edit sheet and Close restores focus", async ({ page, api }) => {
    await open(page, api, base());
    const form = page.locator("[data-edit-sheet]");
    await expect(page.locator("#heir-form-heading")).toHaveCount(0);
    await page.locator("[data-focus^='editHeir:']").first().click();
    await expect(form).toBeVisible();
    await expect(form.getByLabel(en.heirNameLabel)).toBeFocused();
    await form.getByRole("button", { name: en.editClose }).click();
    await expect(page.locator("[data-focus^='editHeir:']").first()).toBeFocused();
  });

  test("desktop card Enter opens a panel, blur renames once, and Tab leaves the panel", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = { ...base(), heirs: [son("a"), son("b")] };
    await open(page, api, kase);
    api.set({ putHeir: json(200, { case: { ...kase, revision: 2, heirs: [{ ...son("a"), name: "Ali" }, son("b")] } }) });
    const card = page.locator('[data-node="a"]');
    await card.focus();
    await card.press("Enter");
    const panel = page.locator("section[data-edit-sheet]");
    const name = panel.getByLabel(en.heirNameLabel);
    await expect(name).toBeFocused();
    await name.fill("  Ali  ");
    await name.press("Tab");
    await expect(card).toContainText("Ali");
    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Ali");
    await panel.getByRole("button", { name: "Remove Ali" }).focus();
    await page.keyboard.press("Tab");
    expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(false);
    expect(api.heirPuts.map(body => JSON.parse(body))).toEqual([
      { case_id: agree.case.id, expected_revision: 1, relationship: "son", name: "Ali" },
    ]);
  });

  test("phone sheet is modal and Escape returns focus to the opening card", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page, api, { ...base(), heirs: [son("a")] });
    const card = page.locator('[data-node="a"]');
    await card.click();
    const sheet = page.locator("dialog[data-edit-sheet]:modal");
    await expect(sheet.getByLabel(en.heirNameLabel)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(card).toBeFocused();
    expect(api.heirPuts).toHaveLength(0);
  });

  test("row Remove lists the returned impact and Yes confirms its revision", async ({ page, api }) => {
    const row = { ...son("owner"), name: "Ali" };
    const child = { ...son("child"), name: "Omar" };
    const kase = { ...base(), heirs: [row], deaths: [
      { heir_id: row.id, order: 2, gender: "male", heir_options: row.edit_options, heirs: [child] },
    ] };
    await open(page, api, kase);
    api.set({ deleteHeir: json(409, { error: "cascade_unconfirmed", impact: { persons: ["child"], estates: [2] },
      case: { ...kase, revision: 3 } }) });
    const remove = page.locator('[data-focus="remove:owner"]');
    await remove.click();
    const sheet = page.locator("[data-edit-sheet]");
    await expect(sheet.locator("li")).toHaveText(["Son · Omar", "The estate of Son · Ali"]);
    const keep = sheet.getByRole("button", { name: en.heirRemoveNo });
    await expect(keep).toBeFocused();
    await keep.click();
    await expect(remove).toBeFocused();
    expect(api.heirDeletes).toHaveLength(1);
    expect(api.heirDeletes[0].searchParams.has("confirm_cascade")).toBe(false);
    await remove.click();
    await expect(keep).toBeFocused();
    api.set({ deleteHeir: json(200, { case: { ...kase, revision: 4, heirs: [], deaths: [] } }) });
    await sheet.getByRole("button", { name: en.heirRemoveYes }).click();
    await expect(page.locator('[data-node="root"]')).toBeFocused();
    expect(api.heirDeletes).toHaveLength(3);
    expect(api.heirDeletes[2].searchParams.get("confirm_cascade")).toBe("true");
    expect(api.heirDeletes[2].searchParams.get("expected_revision")).toBe("3");
  });

  test("Delete asks before sending and simple Remove focuses the next sibling", async ({ page, api }) => {
    const kase = { ...base(), heirs: [son("a"), son("b"), son("c")] };
    await open(page, api, kase);
    await page.locator('[data-node="b"]').press("Delete");
    const sheet = page.locator("[data-edit-sheet]");
    await expect(sheet.getByRole("button", { name: en.heirRemoveNo })).toBeFocused();
    await expect(sheet.locator("li")).toHaveCount(0);
    expect(api.heirDeletes).toHaveLength(0);
    await page.keyboard.press("Escape");
    api.set({ deleteHeir: json(200, { case: { ...kase, revision: 2, heirs: [son("a"), son("c")] } }) });
    await sheet.getByRole("button", { name: "Remove Son 2" }).click();
    await expect(page.locator('[data-node="c"]')).toBeFocused();
    expect(api.heirDeletes).toHaveLength(1);
    expect(api.heirDeletes[0].searchParams.has("confirm_cascade")).toBe(false);
  });

  test("no Father button when the case already has a father", async ({ page, api }) => {
    const kase = { ...base(), placement: { root: [{ relationship: "mother", link: "parent", blocked: false }, { relationship: "wife", link: "spouse", blocked: false }] } };
    await open(page, api, kase);
    await expect(page.getByRole("button", { name: "Add Mother", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Father", exact: true })).toHaveCount(0);
  });
});

test.describe("undo", () => {
  const agree = fixture("Agree: wife, son and daughter in every school");
  const stamp = (kase: Record<string, any>, revision: number): Record<string, any> => ({ ...kase, revision, snapshot: { at: revision } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const start = () => stamp(fullCase(agree.case) as Record<string, any>, 5); // eslint-disable-line @typescript-eslint/no-explicit-any
  const son = (id: string) => ({ id, relationship: "son", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } });
  const open = async (page: Page, api: Parameters<typeof openHeirsScreen>[1], kase: Record<string, unknown>) => {
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, agree.response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await page.locator("#add-relatives-heading").waitFor();
  };
  const added = (kase: Record<string, any>) => stamp({ ...kase, heirs: [...kase.heirs, son("new-son")] }, kase.revision + 1); // eslint-disable-line @typescript-eslint/no-explicit-any
  const headerUndo = (page: Page) => page.getByRole("button", { name: en.undoLastChange, exact: true });

  test("no Undo control before a change, and none after a reload", async ({ page, api }) => {
    const kase = start();
    await open(page, api, kase);
    await expect(headerUndo(page)).toHaveCount(0);
    const after = added(kase);
    api.set({ getCase: json(200, { case: after }), postHeir: json(201, { case: after }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(headerUndo(page)).toHaveCount(2);
    await page.reload();
    await page.locator("#add-relatives-heading").waitFor();
    await expect(headerUndo(page)).toHaveCount(0);
  });

  test("header Undo sends one restore with the prior snapshot at the current revision", async ({ page, api }) => {
    const kase = start();
    await open(page, api, kase);
    const after = added(kase);
    api.set({ postHeir: json(201, { case: after }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.locator("[data-node='new-son']")).toBeVisible();
    api.set({ postRestore: json(200, { case: stamp(kase, after.revision + 1) }) });
    await headerUndo(page).first().click();
    await expect(page.locator("[data-node='new-son']")).toHaveCount(0);
    expect(api.restorePosts).toHaveLength(1);
    expect(restoreBody(api.restorePosts[0].body)).toEqual({
      case_id: kase.id, expected_revision: after.revision, snapshot: kase.snapshot,
    });
    await expect(page.locator("[data-focus='card:root']")).toBeFocused();
    await expect(headerUndo(page)).toHaveCount(0);
  });

  test("two changes then two Ctrl+Z presses outside inputs walk back both", async ({ page, api }) => {
    const kase = start();
    await open(page, api, kase);
    const one = added(kase);
    const two = stamp({ ...one, heirs: [...one.heirs, son("second-son")] }, one.revision + 1);
    api.set({ postHeir: json(201, { case: one }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.locator("[data-node='new-son']")).toBeVisible();
    api.set({ postHeir: json(201, { case: two }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.locator("[data-node='second-son']")).toBeVisible();
    api.set({ postRestore: json(200, { case: stamp(one, two.revision + 1) }) });
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-node='second-son']")).toHaveCount(0);
    api.set({ postRestore: json(200, { case: stamp(kase, two.revision + 2) }) });
    await page.keyboard.press("Control+z");
    await expect(page.locator("[data-node='new-son']")).toHaveCount(0);
    expect(api.restorePosts.map((post) => restoreBody(post.body).snapshot)).toEqual([one.snapshot, kase.snapshot]);
    await expect(headerUndo(page)).toHaveCount(0);
  });

  test("Ctrl+Z inside a text input is the browser's own undo and sends no restore", async ({ page, api }) => {
    const kase = start();
    await open(page, api, kase);
    api.set({ postHeir: json(201, { case: added(kase) }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(headerUndo(page).first()).toBeVisible();
    await page.locator("[data-focus^='editHeir:']").first().click();
    const sheet = page.locator("[data-edit-sheet]");
    await expect(sheet).toBeVisible();
    await sheet.getByLabel(en.heirNameLabel).focus();
    await page.keyboard.press("Control+z");
    expect(api.restorePosts).toHaveLength(0);
    await expect(headerUndo(page)).toHaveCount(2);
  });

  test("a failed restore keeps Undo and shows the alert", async ({ page, api }) => {
    const kase = start();
    await open(page, api, kase);
    api.set({ postHeir: json(201, { case: added(kase) }), postRestore: json(400, { error: "invalid_snapshot" }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await headerUndo(page).first().click();
    await expect(page.getByRole("alert").filter({ hasText: en.undoFailed })).toBeVisible();
    await expect(headerUndo(page)).toHaveCount(2);
    await expect(page.locator("[data-node='new-son']")).toBeVisible();
  });

  test("a restore conflict shows the notice, adopts the live case and hides Undo", async ({ page, api }) => {
    const kase = start();
    await open(page, api, kase);
    const live = stamp({ ...kase, heirs: [son("other")] }, 20);
    api.set({ postHeir: json(201, { case: added(kase) }), postRestore: json(409, { error: "conflict", case: live }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await headerUndo(page).first().click();
    await expect(page.getByRole("alert").filter({ hasText: en.conflictNotice })).toBeVisible();
    await expect(page.locator("[data-node='other']")).toBeVisible();
    await expect(headerUndo(page)).toHaveCount(0);
    expect(api.restorePosts).toHaveLength(1);
  });

  test("offline, both Undo controls and Ctrl+Z do nothing and the offline line shows", async ({ page, context, api }) => {
    const kase = start();
    await open(page, api, kase);
    api.set({ postHeir: json(201, { case: added(kase) }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(headerUndo(page)).toHaveCount(2);
    await context.setOffline(true);
    await expect(page.getByText(en.offlineEditing)).toBeVisible();
    for (const button of await headerUndo(page).all()) await expect(button).toHaveAttribute("aria-disabled", "true");
    await headerUndo(page).first().click({ force: true });
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Control+z");
    expect(api.restorePosts).toHaveLength(0);
    await expect(headerUndo(page)).toHaveCount(2);
  });

  test("undoing a removal restores the heir, focuses its card and announces it politely", async ({ page, api }) => {
    const kase = stamp({ ...start(), heirs: [son("a"), son("b"), son("c")] }, 5);
    await open(page, api, kase);
    const removed = stamp({ ...kase, heirs: [son("a"), son("c")] }, 6);
    api.set({ deleteHeir: json(200, { case: removed }) });
    await page.locator('[data-node="b"]').press("Delete");
    await page.locator("[data-edit-sheet]").getByRole("button", { name: en.heirRemoveYes }).click();
    await expect(page.locator("[data-node='b']")).toHaveCount(0);
    api.set({ postRestore: json(200, { case: stamp(kase, 7) }) });
    await headerUndo(page).first().click();
    await expect(page.locator("[data-node='b']")).toBeVisible();
    expect(api.restorePosts).toHaveLength(1);
    expect(restoreBody(api.restorePosts[0].body)).toEqual({ case_id: kase.id, expected_revision: 6, snapshot: kase.snapshot });
    await expect(page.locator("[data-focus='card:b']")).toBeFocused();
    await expect(page.locator("[role='status'][aria-atomic='true']")).toHaveText(new RegExp(`^${en.undoDone}`));
  });

  test("the toast follows the Heirs list, is not a live region, and Undo outlives it", async ({ page, api }) => {
    await page.clock.install();
    const kase = start();
    await open(page, api, kase);
    api.set({ postHeir: json(201, { case: added(kase) }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    const toast = page.locator("[data-undo-toast]");
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button", { name: en.undoAction, exact: true })).toBeVisible();
    expect(await toast.evaluate((el) => !el.closest("[role],[aria-live]") && !el.querySelector("[role],[aria-live]"))).toBe(true);
    expect(await toast.evaluate((el) => {
      const list = document.querySelector("section[aria-labelledby='heirs-heading']")!;
      return !!(list.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await page.clock.fastForward(10_500);
    await expect(toast).toHaveCount(0);
    await expect(headerUndo(page)).toHaveCount(2);
  });
});

test.describe("interview shell", () => {
  const regions = (page: Page) => ({
    add: page.locator("section[aria-labelledby='add-relatives-heading']"),
    tree: page.locator("section[data-tree]"),
    list: page.locator("section[aria-labelledby='heirs-heading']"),
  });
  const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;

  test("regions are named and in order, stacked on a phone with 16px gutters", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, "en");
    const { add, tree, list } = regions(page);
    await expect(page.getByRole("region", { name: en.addRelativesHeading })).toBeVisible();
    await expect(page.getByRole("region", { name: en.treeHeading })).toBeVisible();
    const [a, t, l] = [await box(add), await box(tree), await box(list)];
    expect(a.y).toBeLessThan(t.y);
    expect(t.y).toBeLessThan(l.y);
    expect(a.x).toBeCloseTo(16, 0);
    expect(a.x + a.width).toBeCloseTo(375 - 16, 0);
    const order = await page.evaluate(() => {
      const sel = ["section[aria-labelledby='add-relatives-heading']", "section[data-tree]", "section[aria-labelledby='heirs-heading']"];
      const nodes = sel.map((s) => document.querySelector(s)!);
      return nodes.every((n, i) => i === 0 || !!(nodes[i - 1].compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(order).toBe(true);
  });

  test("at 1100px a 380px column sits beside the tree, with no Share preview", async ({ page, api }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await openHeirsScreen(page, api, "en");
    const { add, tree, list } = regions(page);
    const [a, t, l] = [await box(add), await box(tree), await box(list)];
    expect(a.width).toBeCloseTo(380, 0);
    // The column is 380px; the list sits inside its 16px inline-end padding.
    expect(l.width).toBeCloseTo(364, 0);
    expect(t.x).toBeGreaterThan(a.x + a.width - 1);
    expect(l.y).toBeGreaterThan(a.y);
    expect(Math.abs(l.x - a.x)).toBeLessThan(1);
    await expect(page.locator("section[aria-labelledby='preview-heading']")).toHaveCount(0);
  });

  test("at 1366px the shell is at most 1360px: a 380px column and a flexible tree, with no Share preview", async ({ page, api }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await openHeirsScreen(page, api, "en");
    const { add, tree } = regions(page);
    const grid = await box(page.locator("[data-wide]").filter({ has: add }).first());
    expect(grid.width).toBeLessThanOrEqual(1360);
    const [a, t] = [await box(add), await box(tree)];
    expect(a.width).toBeCloseTo(380, 0);
    // The tree takes the rest of the shell: no third column.
    expect(Math.abs(grid.x + grid.width - (t.x + t.width))).toBeLessThan(2);
    await expect(page.locator("section[aria-labelledby='preview-heading']")).toHaveCount(0);
  });

  for (const locale of ["en", "ar"] as const) for (const width of [375, 1100, 1366]) {
    test(`no Share preview region is on the Interview at ${width}px in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHeirsScreen(page, api, locale);
      await expect(page.locator("section[aria-labelledby='preview-heading'], #preview-heading, [data-preview-body]")).toHaveCount(0);
      await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "ready");
      // Names and terms on the tree cards keep their own direction markup.
      expect(await page.locator("[data-node] bdi").count()).toBeGreaterThan(0);
    });
  }

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
          .filter((el) => el.getClientRects().length > 0 && !el.closest("table"))
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

  test("a layered case shows no breadcrumb at the root and opens a later estate from its row", async ({ page, api }) => {
    const layered = fixture("Agree layered: wife and two sons, a son dies");
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
      getPreview: json(200, layered.response),
    });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const nav = page.getByRole("navigation", { name: en.estateLevel });
    await expect(nav).toHaveCount(0);
    await page.locator("[data-focus^='openLayer:']").first().click();
    await expect(nav).toBeVisible();
    await expect(page.locator("[data-focus='treeHeading']")).toBeFocused();
    const inTree = await page.evaluate(() => {
      const crumb = document.querySelector("nav[data-breadcrumb]")!;
      const area = document.querySelector("[data-tree-area]")!;
      return !!crumb.closest("[data-tree]") && !!(crumb.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(inTree).toBe(true);
    await expect(nav.locator('[aria-current="page"]')).toBeVisible();
    await nav.getByRole("link").first().click();
    await expect(nav).toHaveCount(0);
    await expect(page.locator("[data-focus='treeHeading']")).toBeFocused();
    await expect(page.locator("[data-focus='treeHeading']")).toHaveText(en.treeHeading);
  });
});

test.describe("later-death estates", () => {
  const agree = fixture("Agree: wife, son and daughter in every school");
  const layered = fixture("Agree layered: wife and two sons, a son dies");
  const options = { blocked: [], invalid: {} };
  const rows = (kase: Record<string, any>) => kase.heirs as { id: string; relationship: string }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const layeredCase = () => fullCase(layered.case, {
    deaths: (layered.case.deaths as { heirs: Record<string, unknown>[] }[]).map((death) => ({
      ...death, heir_options: options, heirs: death.heirs.map((heir) => ({ ...heir, edit_options: options })),
    })),
  }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const open = async (page: Page, api: Parameters<typeof openHeirsScreen>[1], kase: Record<string, unknown>, response: Record<string, unknown>) => {
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await page.locator("section[data-tree] [data-tree-area]").waitFor();
  };

  test("the sheet's later-death radio posts the death without an empty flag, keeps the sheet and focuses Open own estate", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = fullCase(agree.case, { snapshot: { at: 1 } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const son = rows(kase).find((row) => row.relationship === "son")!;
    await open(page, api, kase, agree.response);
    const marked = { ...kase, revision: 2, snapshot: { at: 2 }, deaths: [{ heir_id: son.id, order: 2, gender: "male", heir_options: options, heirs: [] }] };
    api.set({ postDeath: json(201, { case: marked }), getCase: json(200, { case: marked }), getPreview: json(200, { status: "not_ready", revision: 2 }) });
    const card = page.locator(`[data-node="${son.id}"]`);
    await card.focus();
    await card.press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await sheet.getByRole("radio", { name: en.statusDiedLater }).click();
    await expect(sheet.locator('[data-focus="openEstate"]')).toBeFocused();
    expect(api.deathPosts).toHaveLength(1);
    expect(JSON.parse(api.deathPosts[0].body)).toEqual({ heir_id: son.id, case_id: kase.id, expected_revision: kase.revision });
    await expect(page.locator("[role='status']").filter({ hasText: /died later\. Open own estate to add his heirs\./ }).first()).toBeAttached();
    await expect(page.locator(`[data-node="${son.id}"]`)).toHaveAttribute("data-state", "died_later");
    await expect(page.locator("[data-breadcrumb]")).toHaveCount(0);
  });

  test("a typed name survives choosing the later-death radio: the name is saved before the death", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = fullCase(agree.case, { snapshot: { at: 1 } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const son = rows(kase).find((row) => row.relationship === "son")!;
    await open(page, api, kase, agree.response);
    const named = { ...kase, revision: 2, snapshot: { at: 2 }, heirs: rows(kase).map((row) => row.id === son.id ? { ...row, name: "Karim" } : row) };
    const marked = { ...named, revision: 3, snapshot: { at: 3 }, deaths: [{ heir_id: son.id, order: 2, gender: "male", heir_options: options, heirs: [] }] };
    api.set({ putHeir: json(200, { case: named }), postDeath: json(201, { case: marked }), getCase: json(200, { case: marked }), getPreview: json(200, { status: "not_ready", revision: 3 }) });
    const card = page.locator(`[data-node="${son.id}"]`);
    await card.focus();
    await card.press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await sheet.locator("#edit-name").fill("Karim");
    await sheet.getByRole("radio", { name: en.statusDiedLater }).click();
    await expect(sheet.locator('[data-focus="openEstate"]')).toBeFocused();
    expect(api.writes).toEqual(["put heir", "post death"]);
    expect(JSON.parse(api.heirPuts[0]).name).toBe("Karim");
    expect(JSON.parse(api.deathPosts[0].body)).toMatchObject({ heir_id: son.id, expected_revision: 2 });
    await expect(page.locator(`[data-node="${son.id}"]`)).toContainText("Karim");
  });

  test("Enter on a died-later card opens the estate with the breadcrumb and a focused heading, and the preview is gone until the root returns", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = layeredCase();
    await open(page, api, kase, layered.response);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    await expect(page.locator("[data-summary-bar]")).toBeVisible();
    const card = page.locator('[data-node="s1"]');
    await card.focus();
    await card.press("Enter");
    const heading = page.locator("[data-focus='treeHeading']");
    await expect(heading).toBeFocused();
    await expect(heading).toContainText(en.deathSecond);
    const nav = page.getByRole("navigation", { name: en.estateLevel });
    await expect(nav.getByRole("link")).toHaveCount(1);
    await expect(nav.locator("[aria-current='page']")).toContainText(en.deathSecond);
    await expect(page.locator("#preview-heading")).toHaveCount(0);
    await expect(page.locator("[data-summary-bar], dialog[data-summary-sheet]")).toHaveCount(0);
    // The first wife is the later deceased's mother here, never "Wife".
    const mother = page.locator('[data-node="r1"]');
    await expect(mother).toContainText(en.relationships.mother);
    await expect(mother).not.toContainText(en.relationships.wife);
    await nav.getByRole("link").click();
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(en.treeHeading);
    await expect(nav).toHaveCount(0);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    await expect(page.locator("[data-summary-bar]")).toBeVisible();
    await expect(page.locator('[data-node="w"]')).toContainText(en.relationships.wife);
  });

  test("a blocked heir in an open later estate keeps its blocked state after an edit there", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = layeredCase();
    const presented = structuredClone(served.presented[layered.title]) as { evidence: { order: number; heirs: { person: string; rule: { code: string } }[] }[] };
    const second = presented.evidence.find((entry) => entry.order === 2)!;
    second.heirs.find((heir) => heir.person === "s2")!.rule.code = "blocked";
    await open(page, api, kase, { ...layered.response, presented });
    await page.locator('[data-node="s1"]').press("Enter");
    await expect(page.locator("[data-focus='treeHeading']")).toBeFocused();
    await expect(page.locator('[data-node="r2"]')).toHaveAttribute("data-state", "blocked");
    const renamed = { ...kase, revision: 2, deaths: kase.deaths.map((death: Record<string, any>) => ({ ...death, heirs: death.heirs.map((row: Record<string, any>) => row.id === "r2" ? { ...row, name: "Omar" } : row) })) }; // eslint-disable-line @typescript-eslint/no-explicit-any
    api.set({ putHeir: json(200, { case: renamed }), getCase: json(200, { case: renamed }), getPreview: json(200, { ...layered.response, revision: 2, presented }) });
    await page.locator('[data-node="r2"]').press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await sheet.locator("#edit-name").fill("Omar");
    await sheet.locator("#edit-name").press("Enter");
    await expect(page.locator('[data-node="r2"]')).toContainText("Omar");
    await expect(page.locator('[data-node="r2"]')).toHaveAttribute("data-state", "blocked");
  });

  test("the sheet's order question resends first and ends on Open own estate", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = layeredCase();
    await open(page, api, kase, layered.response);
    const marked = { ...kase, revision: 2, deaths: [...kase.deaths, { heir_id: "s2", order: 3, gender: "male", heir_options: options, heirs: [] }] };
    api.set({ postDeath: json(400, { errors: { death: "order_required" } }) });
    await page.locator('[data-node="s2"]').press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await sheet.getByRole("radio", { name: en.statusDiedLater }).click();
    await expect(sheet.locator('[data-focus="death-order"]').first()).toBeVisible();
    api.set({ postDeath: json(201, { case: marked }), getCase: json(200, { case: marked }) });
    await sheet.locator('[data-focus="orderFirst:s1"]').click();
    await expect(sheet.locator('[data-focus="openEstate"]')).toBeFocused();
    expect(api.deathPosts).toHaveLength(2);
    expect(JSON.parse(api.deathPosts[1].body)).toMatchObject({ heir_id: "s2", first: "s1" });
    expect(JSON.parse(api.deathPosts[1].body)).not.toHaveProperty("empty");
  });

  test("the sheet asks the relatives question inside itself, and the answer posts again and brings the derived heir", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = fullCase(agree.case, { snapshot: { at: 1 } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const son = rows(kase).find((row) => row.relationship === "son")!;
    const wife = rows(kase).find((row) => row.relationship === "wife")!;
    await open(page, api, kase, agree.response);
    const derived = { id: "d1", relationship: "mother", gender: "female", name: null, same_as: wife.id, edit_options: options };
    const marked = { ...kase, revision: 2, snapshot: { at: 2 }, deaths: [{ heir_id: son.id, order: 2, gender: "male", heir_options: options, heirs: [derived] }] };
    const questions = [{ id: wife.id, person: wife.id, kind: "relative", options: ["mother", "none"], suggested: "mother" }];
    api.set({ postDeath: json(400, { errors: { relatives: "required" }, questions }) });
    await page.locator(`[data-node="${son.id}"]`).press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await sheet.getByRole("radio", { name: en.statusDiedLater }).click();
    await expect(sheet.locator('[data-focus="relatives"]')).toBeVisible();
    await expect(sheet.locator('[data-focus="relatives"]')).toBeFocused();
    api.set({ postDeath: json(201, { case: marked }), getCase: json(200, { case: marked }), getPreview: json(200, { status: "not_ready", revision: 2 }) });
    await sheet.locator('[data-focus="relativesSubmit"]').click();
    await expect(sheet.locator('[data-focus="openEstate"]')).toBeFocused();
    expect(api.deathPosts).toHaveLength(2);
    const second = JSON.parse(api.deathPosts[1].body);
    expect(second).toMatchObject({ heir_id: son.id, relatives: { [wife.id]: "mother" } });
    expect(second).not.toHaveProperty("empty");
    await sheet.locator('[data-focus="openEstate"]').click();
    await expect(page.locator('[data-node="d1"]')).toBeVisible();
  });

  test("cancelling the sheet's relatives question writes nothing and focuses the later-death radio", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = fullCase(agree.case, { snapshot: { at: 1 } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const son = rows(kase).find((row) => row.relationship === "son")!;
    const wife = rows(kase).find((row) => row.relationship === "wife")!;
    await open(page, api, kase, agree.response);
    const questions = [{ id: wife.id, person: wife.id, kind: "relative", options: ["mother", "none"], suggested: "mother" }];
    api.set({ postDeath: json(400, { errors: { relatives: "required" }, questions }) });
    await page.locator(`[data-node="${son.id}"]`).press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await sheet.getByRole("radio", { name: en.statusDiedLater }).click();
    await sheet.locator('[data-focus="relativesCancel"]').click();
    await expect(sheet.locator('[data-focus="relatives"]')).toHaveCount(0);
    await expect(sheet.locator('[data-focus="editStatus:died_later"]')).toBeFocused();
    expect(api.deathPosts).toHaveLength(1);
  });

  test("at two later deaths the radio is replaced by the limit text and the Also died row action is hidden", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = fullCase(agree.case) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const [a, b] = rows(kase).filter((row) => row.relationship !== "wife");
    const wife = rows(kase).find((row) => row.relationship === "wife")!;
    const death = (id: string, order: number, gender: string) => ({ heir_id: id, order, gender, heir_options: options, heirs: [] });
    kase.deaths = [death(a.id, 2, "female"), death(b.id, 3, "male")];
    await open(page, api, kase, agree.response);
    await page.locator(`[data-node="${wife.id}"]`).press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await expect(sheet.getByRole("radio", { name: en.statusDiedLater })).toHaveCount(0);
    await expect(sheet).toContainText(en.laterDeathLimit);
    await expect(page.locator(`[data-focus="alsoDied:${wife.id}"]`)).toHaveCount(0);
  });

  test("removing the linked person lists the later estate's people by name and cancel changes nothing", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = layeredCase();
    kase.deaths[0].heirs.push({ id: "r3", relationship: "wife", gender: "female", name: "Layla", edit_options: options });
    await open(page, api, kase, layered.response);
    api.set({ deleteHeir: json(409, { error: "cascade_unconfirmed", impact: { persons: ["r3"], estates: [2] }, case: kase }) });
    await page.locator('[data-focus="remove:s1"]').click();
    const sheet = page.locator("[data-edit-sheet]");
    await expect(sheet.locator("li")).toHaveCount(2);
    await expect(sheet.locator("li").first()).toContainText("Layla");
    await expect(sheet).not.toContainText("r3");
    await sheet.getByRole("button", { name: en.heirRemoveNo }).click();
    await expect(page.locator('[data-node="s1"]')).toHaveAttribute("data-state", "died_later");
    expect(api.heirDeletes).toHaveLength(1);
  });
});

test.describe("lineage canvas", () => {
  for (const width of [375, 1280]) test(`legacy cards retain normal styles at ${width}`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHeirsScreen(page, api, "en");
    const card = page.locator('[data-state="normal"]').first();
    // Chromium snaps a computed 1.5px border to whole device pixels, so the declaration is checked.
    expect(await card.evaluate(el => (el as HTMLElement).style.border)).toBe("1.5px solid var(--graphic)");
    await expect(card).toHaveCSS("border-style", "solid");
    const b = (await card.boundingBox())!;
    expect(b.width).toBeCloseTo(width === 375 ? 108 : 136, 0);
    expect(b.height).toBeGreaterThanOrEqual(76);
    // Matrix "legacy case": the list is the deceased row, then one row per heir.
    const rows = page.locator("section[aria-labelledby='heirs-heading'] ul > li");
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toHaveText(en.treeDeceased);
    expect(await card.evaluate(el => {
      const plate = document.createElement("span"); plate.style.backgroundColor = "var(--background)"; el.append(plate);
      const equal = getComputedStyle(el).backgroundColor === getComputedStyle(plate).backgroundColor; plate.remove(); return equal;
    })).toBe(true);
  });

  for (const locale of ["en", "ar"] as const) for (const width of [375, 1280]) {
    test(`card states and canvas in ${locale} at ${width}`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      await openCanvasFixture(page, api, locale);
      const t = messages[locale].interview;
      const group = page.getByRole("group", { name: t.treeHeading });
      await expect(group).toHaveCSS("touch-action", "pan-y pinch-zoom");
      const canvas = await group.evaluate(el => { const s = getComputedStyle(el); return { background: s.backgroundImage, padding: s.paddingInlineStart }; });
      expect(canvas.background).toContain("radial-gradient"); expect(parseFloat(canvas.padding)).toBeGreaterThanOrEqual(6);
      const cards = group.locator("button");
      for (const card of await cards.all()) {
        const b = (await card.boundingBox())!;
        expect(b.width).toBeCloseTo(width === 375 ? 108 : 136, 0); expect(b.height).toBeGreaterThanOrEqual(76);
        expect(await card.evaluate(el => getComputedStyle(el).transform)).toBe("none");
      }
      await expect(group.locator('[data-state="blocked"]')).toContainText(t.treeNoShare);
      await expect(group.locator('[data-node="w"]')).toContainText(t.treeDiedLater.female);
      await expect(group.locator('[data-state="died_before"]')).toContainText(t.treeDiedBefore.male);
      await expect(group.locator('[data-state="died_later"]').first()).toHaveCSS("border-width", "2px");
      await expect(group.locator('[data-state="died_later"]').first()).toHaveCSS("border-style", "solid");
      expect(await group.locator('[data-state="blocked"]').evaluate(el => (el as HTMLElement).style.border)).toBe("1.5px solid var(--graphic)");
      await expect(group.locator('[data-state="blocked"]')).toHaveCSS("border-style", "solid");
      expect(await group.locator('[data-state="blocked"]').evaluate(el => getComputedStyle(el).backgroundImage)).toContain("repeating-linear-gradient");
      await expect(group.locator('[data-state="died_before"] rect')).toHaveAttribute("stroke-dasharray", "4 3");
      await expect(group.locator('[data-state="died_before"] rect')).toHaveAttribute("stroke-width", "2");
      // Tailwind's -scale-x-100 sets the `scale` property; only the connector layer is mirrored.
      expect(await group.locator("svg").first().evaluate(el => getComputedStyle(el).scale)).toBe(locale === "ar" ? "-1 1" : "none");
      for (const card of await cards.all()) expect(await card.evaluate(el => getComputedStyle(el).scale)).toBe("none");
      await expect(page.locator("section[aria-labelledby='heirs-heading']")).toContainText(t.treeNoShare);
      // Matrix "lineage": the died-before person has a list row with its badge and edit/remove actions.
      const before = page.locator("section[aria-labelledby='heirs-heading'] ul > li").filter({ hasText: t.treeDiedBefore.male });
      await expect(before).toHaveCount(1);
      await expect(before.locator("button")).toHaveCount(2);
      await page.getByRole("button", { name: t.treeZoomIn, exact: true }).click();
      await expect(page.locator("[role='status'][aria-atomic='true']")).toHaveText(t.treeZoomStatus.replace("{percent}", new Intl.NumberFormat(locale, { style: "percent" }).format(1.25)));
    });
  }
  for (const locale of ["en", "ar"] as const) {
    test(`empty estate placeholders in ${locale}`, async ({ page, api }) => {
      await openCanvasFixture(page, api, locale, "empty"); const t = messages[locale].interview;
      const group = page.getByRole("group", { name: t.treeHeading });
      await expect(group.getByText(t.treeAddParent, { exact: true })).toBeVisible();
      await expect(group.getByText(t.treeAddSpouse, { exact: true })).toBeVisible();
      await expect(group.locator("button")).toHaveCount(3);
      await expect(page.getByText(t.heirsEmpty, { exact: true })).toBeVisible();
      // No bar while the estate is empty: there are no shares to summarize.
      await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "idle");
      await expect(page.locator("[data-summary-bar], dialog[data-summary-sheet], [data-preview-body]")).toHaveCount(0);
    });
    for (const width of [375, 1280]) test(`50 heirs stay reachable and deceased stays inside in ${locale} at ${width}`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 }); await openCanvasFixture(page, api, locale, "many");
      const t = messages[locale].interview, canvas = page.getByRole("group", { name: t.treeHeading });
      await canvas.scrollIntoViewIfNeeded();
      const pinned = async () => {
        const outer = (await canvas.boundingBox())!, root = (await canvas.locator('[data-node="root"]').boundingBox())!;
        expect(root.x).toBeGreaterThanOrEqual(outer.x + 5); expect(root.y).toBeGreaterThanOrEqual(outer.y + 5);
        expect(root.x + root.width).toBeLessThanOrEqual(outer.x + outer.width - 5);
        expect(root.y + root.height).toBeLessThanOrEqual(outer.y + outer.height - 5);
      };
      await pinned();
      for (const name of [t.treeZoomIn, t.treeZoomIn, t.treeZoomOut, t.treeZoomOut, t.treeZoomOut, t.treeZoomOut, t.treeFit]) {
        await page.getByRole("button", { name, exact: true }).click(); await pinned();
        await canvas.scrollIntoViewIfNeeded();
        const b = (await canvas.boundingBox())!;
        for (const direction of [-1, 1]) {
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
          await page.mouse.move(b.x + b.width / 2 + direction * 10000, b.y + b.height / 2 + direction * 10000, { steps: 5 }); await page.mouse.up();
          await pinned();
        }
      }
      // Story 9.14: the 50 sons are one row, so the last one is reached at the inline end.
      await canvas.evaluate((el, rtl) => { el.scrollTop = el.scrollHeight; const max = el.scrollWidth - el.clientWidth; el.scrollLeft = rtl ? -max : max; }, locale === "ar");
      await expect(canvas.locator('[data-node="many49"]')).toBeInViewport(); await pinned();
    });
  }

  // Story 9.9: lineage keyboard navigation along the drawn tree, mirrored in Arabic.
  for (const locale of ["en", "ar"] as const) {
    test(`arrows, Home and End follow the drawn tree in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openCanvasFixture(page, api, locale);
      const t = messages[locale].interview, ar = locale === "ar";
      const next = ar ? "ArrowLeft" : "ArrowRight", prev = ar ? "ArrowRight" : "ArrowLeft";
      const group = page.getByRole("group", { name: t.treeHeading });
      const area = page.locator("[data-tree-area]");
      const press = async (key: string, expected: string) => {
        await page.keyboard.press(key);
        await expect(page.locator(`[data-node="${expected}"]`)).toBeFocused();
        await expect(group.locator('[aria-current="true"]')).toHaveAttribute("data-node", expected);
        await expect(group.locator('[data-node][tabindex="0"]')).toHaveCount(1);
      };
      await page.locator('[data-node="root"]').focus();
      await press("ArrowUp", "root");
      await press("ArrowDown", "w");
      await press(next, "s1");
      await press(next, "before");
      await press(next, "before");
      await press("ArrowDown", "s2");
      await press("ArrowDown", "s2");
      await press("ArrowUp", "before");
      await press(prev, "s1");
      await press("End", "s2");
      await press("Home", "root");
      // An absent neighbour neither moves focus nor scrolls the page or the canvas.
      const before = await area.evaluate(el => [el.scrollLeft, el.scrollTop, window.scrollX, window.scrollY]);
      await page.keyboard.press("ArrowUp"); await page.keyboard.press(next);
      expect(await area.evaluate(el => [el.scrollLeft, el.scrollTop, window.scrollX, window.scrollY])).toEqual(before);
      // Zoom keys behave like the toolbar and are ignored beyond the limits.
      const status = page.locator("[role='status'][aria-atomic='true']");
      const percent = (z: number) => t.treeZoomStatus.replace("{percent}", new Intl.NumberFormat(locale, { style: "percent" }).format(z));
      const canvasWidth = () => page.locator("[data-tree-area] > div").first().evaluate(el => el.getBoundingClientRect().width);
      const startingWidth = await canvasWidth();
      await page.keyboard.press("+"); await expect(status).toHaveText(percent(1.25));
      expect(await canvasWidth()).toBeGreaterThan(startingWidth);
      await page.keyboard.press("=");
      await expect(status).toHaveText(percent(1.5));
      await expect(page.getByRole("button", { name: t.treeZoomIn, exact: true })).toBeDisabled();
      await page.keyboard.press("+"); await expect(status).toHaveText(percent(1.5));
      for (const key of ["-", "_", "-", "-", "-"]) await page.keyboard.press(key);
      await expect(status).toHaveText(percent(0.6));
      expect(await canvasWidth()).toBeLessThan(startingWidth);
      await expect(page.getByRole("button", { name: t.treeZoomOut, exact: true })).toBeDisabled();
      await page.keyboard.press("-"); await expect(status).toHaveText(percent(0.6));
    });

    test(`text inputs keep their keystrokes while editing in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openCanvasFixture(page, api, locale);
      const card = page.locator('[data-node="before"]');
      await card.focus();
      await page.keyboard.press("Enter");
      const sheet = page.locator("[data-edit-sheet]");
      const input = sheet.getByLabel(messages[locale].interview.heirNameLabel);
      const status = page.locator("[role='status'][aria-atomic='true']");
      const zoomStatus = await status.textContent();
      await input.focus();
      await input.pressSequentially("ab+-=_");
      for (const key of ["Home", "ArrowRight", "ArrowUp", "ArrowDown", "End"]) await page.keyboard.press(key);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("ab+-=_");
      expect(await status.textContent()).toBe(zoomStatus);
      await expect(card).not.toBeFocused();
    });

    test(`a card reached by arrow keys keeps its focus ring inside the canvas in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 375, height: 700 });
      await openCanvasFixture(page, api, locale);
      const area = page.locator("[data-tree-area]");
      const canvas = await area.elementHandle();
      const next = locale === "ar" ? "ArrowLeft" : "ArrowRight";
      await area.locator('[data-node="root"]').focus();
      for (const [key, id] of [["ArrowDown", "w"], [next, "s1"], [next, "before"], ["ArrowDown", "s2"]]) {
        const card = area.locator(`[data-node="${id}"]`);
        const ringInside = () => card.evaluate((el, canvas) => {
          const c = canvas.getBoundingClientRect(), r = el.getBoundingClientRect();
          const left = c.x + canvas.clientLeft, top = c.y + canvas.clientTop;
          return r.left - 4 >= left - 0.5 && r.top - 4 >= top - 0.5 && r.right + 4 <= left + canvas.clientWidth + 0.5 && r.bottom + 4 <= top + canvas.clientHeight + 0.5;
        }, canvas);
        if (id === "s2") {
          const panAway = () => card.evaluate((el, canvas) => {
            const c = canvas.getBoundingClientRect(), r = el.getBoundingClientRect();
            const rtl = getComputedStyle(canvas).direction === "rtl";
            const middle = c.left + canvas.clientLeft + canvas.clientWidth / 2;
            const center = r.left + r.width / 2;
            const atInlineStart = rtl ? center >= middle : center <= middle;
            canvas.scrollTop = 0;
            canvas.scrollLeft = atInlineStart ? (rtl ? -canvas.scrollWidth : canvas.scrollWidth) : 0;
          }, canvas);
          await panAway();
          if (await ringInside()) {
            await page.keyboard.press("+");
            await page.keyboard.press("+");
            await panAway();
          }
          expect(await ringInside()).toBe(false);
        }
        await page.keyboard.press(key);
        await expect(card).toBeFocused();
        // Scrolling may still be settling; the ring (2px plus a 2px offset) must end inside the canvas client box.
        await expect.poll(ringInside).toBe(true);
      }
    });

    test(`Tab leaves the tree group and Delete on a died-later card asks first in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openCanvasFixture(page, api, locale);
      const t = messages[locale].interview, group = page.getByRole("group", { name: t.treeHeading });
      await page.locator('[data-node="root"]').focus();
      await page.keyboard.press("Tab");
      expect(await group.evaluate(el => el.contains(document.activeElement))).toBe(false);
      await page.keyboard.press("Shift+Tab");
      await expect(group.locator('[data-node="root"]')).toBeFocused();
      const kase = (await lineageFixture()).kase as Record<string, unknown>;
      api.set({ deleteHeir: json(409, { error: "cascade_unconfirmed", impact: { persons: [], estates: [2] }, case: kase }) });
      await page.locator('[data-node="w"]').focus();
      await page.keyboard.press("Delete");
      const sheet = page.locator("[data-edit-sheet]");
      await expect(sheet.getByRole("button", { name: t.heirRemoveNo })).toBeFocused();
      expect(api.heirDeletes.every(d => !d.searchParams.has("confirm_cascade"))).toBe(true);
      await sheet.getByRole("button", { name: t.heirRemoveNo }).click();
      await expect(page.locator('[data-focus="remove:w"]')).toBeFocused();
      await expect(page.locator('[data-node="w"]')).toHaveAttribute("data-state", "died_later");
      expect(api.heirDeletes.every(d => !d.searchParams.has("confirm_cascade"))).toBe(true);
    });

    test(`each tree card has the same relationship and state text as its Heirs outline row in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openCanvasFixture(page, api, locale);
      const area = page.locator("[data-tree-area]");
      const outline = page.getByRole("list", { name: messages[locale].interview.heirsListLabel, exact: true });
      const items = outline.locator("li");
      const deceased = (await area.locator('[data-node="root"] strong').textContent())!.trim();
      expect(deceased).toBeTruthy();
      await expect(items.first()).toContainText(deceased);
      const rows = await items.allTextContents();
      for (const card of await area.locator('[data-node]:not([data-node="root"])').all()) {
        const relationship = (await card.locator("strong").textContent())!.trim();
        const badge = await card.evaluate(el => el.querySelector("span.rounded-full")?.textContent?.replace(/\s*›\s*$/, "").trim() ?? "");
        expect(rows.some(row => relationship && row.includes(relationship) && row.includes(badge))).toBe(true);
      }
    });
  }
});

// Story 9.7: add relatives at a chosen node by touch, keyboard or drag
test.describe("add relative here", () => {
  const agree = fixture("Agree: wife, son and daughter in every school");
  const options = { blocked: [], invalid: {} };
  const entry = (relationship: string, link: string, gender: string) => ({ relationship, link, blocked: false, gender });
  const placed = () => {
    const kase = fullCase(agree.case) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    kase.placement = {
      root: [entry("father", "parent", "male"), entry("son", "child", "male"), entry("daughter", "child", "female")],
      h2: [entry("son_of_son", "child", "male"), entry("daughter_of_son", "child", "female")],
      h3: [],
    };
    return kase;
  };
  const grandson = { id: "g1", relationship: "son_of_son", gender: "male", name: null, edit_options: options };
  const open = async (page: Page, api: Parameters<typeof openHeirsScreen>[1], kase: Record<string, unknown>) => {
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, agree.response) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await page.locator("section[data-tree] [data-tree-area]").waitFor();
  };
  const accepted = (api: Parameters<typeof openHeirsScreen>[1], kase: Record<string, any>) => // eslint-disable-line @typescript-eslint/no-explicit-any
    api.set({ postHeir: json(201, { case: { ...kase, revision: kase.revision + 1, heirs: [...kase.heirs, grandson] } }) });
  const expectedBody = (kase: Record<string, any>) => ({ relationship: "son_of_son", name: null, anchor: "h2", case_id: kase.id, expected_revision: kase.revision }); // eslint-disable-line @typescript-eslint/no-explicit-any

  test("keyboard: Tab from a card reaches Add relative here, Enter opens it and a choice posts one anchored add", async ({ page, api }) => {
    const kase = placed();
    await open(page, api, kase);
    accepted(api, kase);
    await page.locator('[data-node="h2"]').focus();
    await page.keyboard.press("Tab");
    const toggle = page.getByRole("button", { name: en.addRelativeHere });
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("group", { name: en.addHereGroup.replace("{person}", "Son") })).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect.poll(() => api.heirPosts.length).toBe(1);
    expect(JSON.parse(api.heirPosts[0].body)).toEqual(expectedBody(kase));
    await expect(page.locator('[data-node="g1"]')).toBeFocused();
  });

  test.describe("touch", () => {
    test.use({ hasTouch: true });
    test("a tap path sends the same body", async ({ page, api }) => {
      const kase = placed();
      await open(page, api, kase);
      accepted(api, kase);
      // A tap on a card opens its edit sheet, which holds the chooser for that person.
      await page.locator('[data-node="h2"]').tap();
      const sheet = page.locator("[data-edit-sheet]");
      await sheet.getByRole("button", { name: en.addRelativeHere }).tap();
      await sheet.getByRole("button", { name: en.addRelative.replace("{relationship}", en.relationships.son_of_son) }).tap();
      await expect.poll(() => api.heirPosts.length).toBe(1);
      expect(JSON.parse(api.heirPosts[0].body)).toEqual(expectedBody(kase));
    });
  });

  const drag = async (page: Page, to: string) => {
    // Let the calculation settle first (it can still update the tree), then press the chip.
    await page.locator("[data-preview-state='ready']").waitFor();
    await expect(page.locator('[data-focus="add:son"]')).toHaveAttribute("aria-disabled", "false");
    // hover() waits for the chip to hold still, so the press lands on it and not on a neighbour.
    await page.locator('[data-focus="add:son"]').hover();
    const chip = (await page.locator('[data-focus="add:son"]').boundingBox())!;
    const target = (await page.locator(to).boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(chip.x + chip.width / 2 + 12, chip.y + chip.height / 2 + 12, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    return { release: () => page.mouse.up() };
  };

  test("mouse: a Son chip dropped on a legal card sends the same body", async ({ page, api }) => {
    // Chip and target must both show: a drag does not scroll the page.
    await page.setViewportSize({ width: 1280, height: 1400 });
    const kase = placed();
    await open(page, api, kase);
    accepted(api, kase);
    const held = await drag(page, '[data-node="h2"]');
    await expect(page.locator('[data-node="h2"]')).toContainText(en.dropHere);
    await expect(page.locator('[data-node="h3"]')).toContainText(en.dropNotHere);
    await held.release();
    await expect.poll(() => api.heirPosts.length).toBe(1);
    expect(JSON.parse(api.heirPosts[0].body)).toEqual(expectedBody(kase));
    expect(api.bulkPosts).toHaveLength(0);
  });

  test("mouse: an illegal drop sends nothing, shows the alert and keeps focus", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
    const kase = placed();
    await open(page, api, kase);
    await page.locator('[data-node="h1"]').focus();
    const held = await drag(page, '[data-node="h3"]');
    await held.release();
    await expect(page.locator("[data-add-row] [role='alert']")).toHaveText(
      en.notAllowedHere.replace("{reason}", en.positionNotAllowed.replace("{relationship}", en.relationships.son)));
    expect(api.heirPosts).toHaveLength(0);
    await expect(page.locator('[data-node="h1"]')).toBeFocused();
  });

  test("a placeholder opens the chooser for the root and posts anchor root", async ({ page, api }) => {
    const kase = placed();
    kase.heirs = [];
    kase.placement = { root: [entry("father", "parent", "male"), entry("wife", "spouse", "female")] };
    await open(page, api, kase);
    api.set({ postHeir: json(201, { case: { ...kase, revision: kase.revision + 1, heirs: [{ id: "f1", relationship: "father", gender: "male", name: null, edit_options: options }] } }) });
    await page.locator('[data-focus="placeholder:parent"]').click();
    const group = page.locator("[data-add-row]").getByRole("group");
    await expect(group.getByRole("button")).toHaveCount(1);
    await group.getByRole("button", { name: /Father/ }).click();
    await expect.poll(() => api.heirPosts.length).toBe(1);
    expect(JSON.parse(api.heirPosts[0].body)).toMatchObject({ relationship: "father", anchor: "root" });
    await expect(page.locator('[data-node="f1"]')).toBeFocused();
  });

  test("the edit sheet shows Add relative here for the edited person", async ({ page, api }) => {
    const kase = placed();
    await open(page, api, kase);
    await page.locator('[data-node="h2"]').click();
    const sheet = page.locator("[data-edit-sheet]");
    await expect(sheet.getByRole("button", { name: en.addRelativeHere })).toBeVisible();
    accepted(api, kase);
    await sheet.getByRole("button", { name: en.addRelativeHere }).click();
    await sheet.getByRole("button", { name: en.addRelative.replace("{relationship}", en.relationships.son_of_son) }).click();
    await expect.poll(() => api.heirPosts.length).toBe(1);
    expect(JSON.parse(api.heirPosts[0].body)).toEqual(expectedBody(kase));
  });

  test("died-before son: keyboard choice and a Son chip drop send the same single add", async ({ page, api }) => {
    // Cards slide for 300ms after the first add; measure the drop target only once it is still.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 1400 });
    const kase = placed();
    kase.heirs = kase.heirs.filter((h: { id: string }) => h.id !== "h2");
    kase.persons = [{ id: "h2", relationship: "son", gender: "male", name: null, status: "died_before_or_with", death_order: null }];
    await open(page, api, kase);
    accepted(api, kase);
    await page.locator('[data-node="h2"]').focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect.poll(() => api.heirPosts.length).toBe(1);
    const keyboard = JSON.parse(api.heirPosts[0].body);
    expect(keyboard).toEqual(expectedBody(kase));
    await expect(page.locator('[data-node="g1"]')).toBeFocused();
    await page.locator('[data-focus="add:son"]').hover();
    const chip = (await page.locator('[data-focus="add:son"]').boundingBox())!;
    const target = (await page.locator('[data-node="h2"]').boundingBox())!;
    await page.mouse.down();
    await page.mouse.move(chip.x + chip.width / 2 + 12, chip.y + chip.height / 2 + 12, { steps: 3 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => api.heirPosts.length).toBe(2);
    expect(JSON.parse(api.heirPosts[1].body)).toEqual({ ...keyboard, expected_revision: keyboard.expected_revision + 1 });
  });

  test("a server anchor refusal shows the localized alert and keeps focus on the choice", async ({ page, api }) => {
    const kase = placed();
    await open(page, api, kase);
    api.set({ postHeir: json(400, { errors: { anchor: "not_allowed" } }) });
    await page.locator('[data-node="h2"]').focus();
    await page.getByRole("button", { name: en.addRelativeHere }).click();
    const choice = page.locator("[data-add-row]").getByRole("button", { name: en.addRelative.replace("{relationship}", en.relationships.son_of_son) });
    await choice.click();
    await expect(page.locator("[data-add-row] [role='alert']")).toHaveText(en.fieldErrors.anchor.not_allowed);
    await expect(choice).toBeFocused();
  });
});

test.describe("one status and pending shares (story 9.10)", () => {
  const agree = fixture("Agree: wife, son and daughter in every school");
  const base = () => fullCase(agree.case) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const status = (page: Page) => page.locator("[role='status'][aria-atomic='true']");
  const heirsOf = (kase: Record<string, any>) => kase.heirs.map(({ id, relationship }: { id: string; relationship: string }) => ({ id, relationship })); // eslint-disable-line @typescript-eslint/no-explicit-any
  /** The agree preview as the server would answer for `kase`: same rows, its own revision and family. */
  const previewOf = (kase: Record<string, any>) => ({ ...agree.response, revision: kase.revision, basis: { ...agree.response.basis, heirs: heirsOf(kase) } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Revision 2's answer: the same rows with a different percent for the first heir, so old and new shares can be told apart. */
  const distinct = (kase: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const body = previewOf(kase) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { ...body, presented: { ...body.presented, rows: body.presented.rows.map((row: Record<string, any>, i: number) => (i === 0 ? { ...row, percent: { ...row.percent, text: "77.7%" } } : row)) } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const grown = (kase: Record<string, any>) => ({ ...kase, revision: kase.revision + 1, heirs: [...kase.heirs, { id: "new-son", relationship: "son", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } }] }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const delayed = (ms: number, body: unknown): NonNullable<Stubs["getPreview"]> => async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    try { await json(200, body)(route); } catch {}
  };
  const resume = async (page: Page) => {
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await page.locator("#add-relatives-heading").waitFor();
  };
  const rowsOf = (page: Page) => sheetOf(page).locator("section[aria-labelledby='preview-heading']").locator("tbody tr, ul > li");

  test("a fast add is spoken as one sentence by the one status region", async ({ page, api }) => {
    const kase = base();
    const returned = grown(kase);
    let added = false;
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: (route) => json(200, previewOf(added ? returned : kase))(route),
      postHeir: (route) => { added = true; return json(201, { case: returned })(route); },
    });
    await resume(page);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(status(page)).toHaveText(`Son 2 added. ${en.previewReadyCount.replace("{count}", String(returned.heirs.length))}`);
    await expect(page.locator("[role='status'][aria-atomic='true']")).toHaveCount(1);
    await expect(page.locator("section[aria-labelledby='preview-heading'] [role='status'], section[aria-labelledby='heirs-heading'] [role='status']")).toHaveCount(0);
  });

  test("a slow preview keeps the old shares muted and busy, shows the box after 3s, then swaps", async ({ page, api }) => {
    const kase = base();
    const returned = grown(kase);
    let added = false;
    const slow = delayed(4500, distinct(returned));
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: (route) => (added ? slow(route) : json(200, previewOf(kase))(route)),
      postHeir: (route) => { added = true; return json(201, { case: returned })(route); },
    });
    await resume(page);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    // The bar keeps the family's summary and says it is waiting, never "ready".
    await expect(page.locator("[data-summary-bar] [data-summary-text]")).toHaveText(en.previewWaiting);
    await openPreview(page);
    const section = sheetOf(page).locator("section[aria-labelledby='preview-heading']");
    await expect(rowsOf(page).first()).toBeVisible();
    await expect(section).toHaveAttribute("aria-busy", "true");
    const body = section.locator("[data-preview-body]");
    await expect(body).toHaveAttribute("data-pending", "");
    await expect(rowsOf(page).first()).toBeVisible();
    await expect(section.getByText("12.5%", { exact: true }).first()).toBeVisible();
    await expect(section.getByText("77.7%", { exact: true })).toHaveCount(0);
    await expect(body).toHaveClass(/text-muted/);
    await expect(body).not.toHaveClass(/opacity/);
    expect(await body.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
    await expect(section.locator("[data-slow]")).toHaveCount(0);
    await expect(section.locator("[data-slow]")).toHaveText(en.previewWaiting, { timeout: 5000 });
    await expect(section.locator("[data-slow]")).toHaveClass(/bg-surface/);
    await expect(status(page)).toHaveText(new RegExp(en.previewWaiting));
    await expect(section).toHaveAttribute("aria-busy", "false", { timeout: 8000 });
    await expect(section.locator("[data-slow]")).toHaveCount(0);
    await expect(body).not.toHaveAttribute("data-pending", "");
    await expect(section.getByText("77.7%", { exact: true }).first()).toBeVisible();
    await expect(status(page)).toHaveText(en.previewReadyCount.replace("{count}", String(returned.heirs.length)));
    await expect(page.locator("[data-summary-bar] [data-summary-text]")).toHaveText(en.previewReadyCount.replace("{count}", String(returned.heirs.length)));
  });

  test("a response for an older revision never becomes the shown answer", async ({ page, api }) => {
    const kase = base();
    const returned = grown(kase);
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: json(200, previewOf(kase)),
      postHeir: json(201, { case: returned }),
    });
    await resume(page);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    const gets = api.previewGets;
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect.poll(() => api.previewGets).toBeGreaterThan(gets);
    await page.waitForTimeout(500);
    await openPreview(page);
    const section = sheetOf(page).locator("section[aria-labelledby='preview-heading']");
    await expect(rowsOf(page).first()).toBeVisible();
    await expect(section).toHaveAttribute("aria-busy", "true");
    await expect(section.locator("[data-preview-body]")).toHaveAttribute("data-pending", "");
  });

  test("a rename is busy until its preview settles", async ({ page, api }) => {
    const kase = base();
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, previewOf(kase)) });
    await resume(page);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    const section = sheetOf(page).locator("section[aria-labelledby='preview-heading']");
    await openPreview(page);
    await expect(section).toHaveAttribute("aria-busy", "false");
    await closePreview(page);
    const named = { ...kase, revision: kase.revision + 1, heirs: kase.heirs.map((h: Record<string, unknown>, i: number) => (i === 0 ? { ...h, name: "Zaid" } : h)) };
    api.set({ putHeir: json(200, { case: named }), getPreview: delayed(2500, previewOf(named)) });
    await page.locator("[data-node]").nth(1).click();
    const sheet = page.locator("[data-edit-sheet]");
    await sheet.getByLabel(en.heirNameLabel).fill("Zaid");
    await sheet.getByLabel(en.heirNameLabel).press("Enter");
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "pending");
    await openPreview(page);
    await expect(section).toHaveAttribute("aria-busy", "true");
    await expect(section).toHaveAttribute("aria-busy", "false", { timeout: 6000 });
  });

  test("a failed first preview keeps the family, says so once in the status, and the bar shows the failure with a working Retry", async ({ page, api }) => {
    const kase = base();
    let fail = true;
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: (route) => json(fail ? 500 : 200, fail ? {} : previewOf(kase))(route) });
    await resume(page);
    await expect(status(page)).toHaveText(en.previewFailed);
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "error");
    await expect(page.locator("section[aria-labelledby='heirs-heading'] ul > li").first()).toBeVisible();
    // The failure is visible, not only announced: the bar says so and offers Retry in place of Full results.
    const bar = page.locator("[data-summary-bar]");
    await expect(bar.locator("[data-summary-text]")).toHaveText(en.previewFailed);
    await expect(bar.getByRole("link", { name: en.previewResultsLink })).toHaveCount(0);
    fail = false;
    await bar.getByRole("button", { name: en.previewRetry }).click();
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "ready");
    await expect(bar.locator("[data-summary-text]")).toHaveText(en.previewReadyCount.replace("{count}", String(kase.heirs.length)));
    await expect(bar.getByRole("link", { name: en.previewResultsLink })).toBeVisible();
    await expect(bar.locator("[data-summary-expand]")).toBeFocused();
  });

  test("a delayed case shows a busy skeleton, then the Interview", async ({ page, api }) => {
    const kase = base();
    api.set({
      session: sessionAnonymous,
      getCase: async (route) => { await new Promise((resolve) => setTimeout(resolve, 1500)); await json(200, { case: kase })(route); },
      getPreview: json(200, previewOf(kase)),
    });
    await page.goto("/en/interview/");
    const skeleton = page.locator("[data-skeleton]");
    await expect(skeleton).toHaveAttribute("aria-busy", "true");
    await expect(skeleton.getByText(en.loading)).toHaveCount(1);
    expect(await skeleton.locator("div.h-3").first().evaluate((el) => getComputedStyle(el).height)).toBe("12px");
    await expect(page.getByRole("button", { name: en.resume })).toBeVisible();
    await expect(skeleton).toHaveCount(0);
  });

  test("offline mid-refresh keeps the old shares muted after the request fails, and reconnecting asks again", async ({ page, context, api }) => {
    const kase = base();
    const returned = grown(kase);
    let added = false;
    let reconnected = false;
    const slow = delayed(6000, distinct(returned));
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: (route) => (!added ? json(200, previewOf(kase))(route) : reconnected ? json(200, distinct(returned))(route) : slow(route)),
      postHeir: (route) => { added = true; return json(201, { case: returned })(route); },
    });
    await resume(page);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "pending");
    await context.setOffline(true);
    await expect(page.getByText(en.offlineEditing)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Son", exact: true })).toHaveAttribute("aria-disabled", "true");
    // Long enough for the slow box and the five-second request limit: the request has failed by now.
    await page.waitForTimeout(5500);
    // The failure is known offline, so the status says nothing of it; the bar and the sheet show it.
    await expect(status(page)).not.toHaveText(new RegExp(en.previewFailed));
    await expect(page.locator("[data-summary-bar] [data-summary-text]")).toHaveText(en.previewFailed);
    await openPreview(page);
    const section = sheetOf(page).locator("section[aria-labelledby='preview-heading']");
    await expect(section.locator("[data-slow]")).toHaveCount(0);
    await expect(section.getByText(en.previewFailed)).toBeVisible();
    await expect(section.getByRole("button", { name: en.previewRetry })).toBeVisible();
    await expect(section.getByText("12.5%", { exact: true }).first()).toBeVisible();
    await expect(section.locator("[data-preview-body]")).toHaveClass(/text-muted/);
    const gets = api.previewGets;
    reconnected = true;
    await context.setOffline(false);
    await expect.poll(() => api.previewGets).toBeGreaterThan(gets);
    await expect(section.getByText("77.7%", { exact: true }).first()).toBeVisible();
    await expect(section).toHaveAttribute("aria-busy", "false");
  });

  test("the first heir added to an empty estate is spoken with its shares summary", async ({ page, api }) => {
    const kase = fullCase(agree.case, { heirs: [] }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const returned = { ...kase, revision: kase.revision + 1, heirs: base().heirs };
    let added = false;
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: (route) => json(200, previewOf(added ? returned : kase))(route),
      postHeir: (route) => { added = true; return json(201, { case: returned })(route); },
    });
    await resume(page);
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(status(page)).toHaveText(new RegExp(`^[A-Za-z]+ added[.] ${en.previewReadyCount.replace("{count}", String(base().heirs.length)).replace(".", "[.]")}$`));
  });

  test("a failed preview after an add keeps the family and reaches the one status", async ({ page, api }) => {
    const kase = base();
    const returned = grown(kase);
    let added = false;
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: (route) => (added ? json(500, {})(route) : json(200, previewOf(kase))(route)),
      postHeir: (route) => { added = true; return json(201, { case: returned })(route); },
    });
    await resume(page);
    await expect(page.locator("[data-preview-state='ready']")).toBeAttached();
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.locator("section[aria-labelledby='heirs-heading']").getByText("Son 2", { exact: true }).first()).toBeVisible();
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "error", { timeout: 10000 });
    await expect(status(page)).toContainText(en.previewFailed);
  });

  test("a refusal stays an alert and never reaches the status", async ({ page, api }) => {
    const kase = base();
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, previewOf(kase)), postHeir: json(422, { code: "invalid", errors: { relationship: "not_allowed" } }) });
    await resume(page);
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(status(page)).not.toContainText(/not allowed|added/i);
  });
});

test.describe("Story 9.11: responsive, RTL and reduced-motion tree interactions", () => {
  const agree = fixture("Agree: wife, son and daughter in every school");
  const stamp = (kase: Record<string, any>, revision: number): Record<string, any> => ({ ...kase, revision, snapshot: { at: revision } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const start = () => stamp(fullCase(agree.case) as Record<string, any>, 5); // eslint-disable-line @typescript-eslint/no-explicit-any
  const added = (kase: Record<string, any>) => stamp({ ...kase, heirs: [...kase.heirs, { id: "new-son", relationship: "son", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } }] }, kase.revision + 1); // eslint-disable-line @typescript-eslint/no-explicit-any
  const openAgree = async (page: Page, api: Parameters<typeof openHeirsScreen>[1], locale: "en" | "ar", kase = start()) => {
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, agree.response) });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("#add-relatives-heading").waitFor();
  };
  const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
  /**
   * The obstruction the Interview should register now (9.11, 11.4), capped at a quarter of the viewport:
   * the bar plus a floating toast, the bar alone when the toast flows, or the toast alone with no bar.
   */
  const expectedObstruction = async (page: Page) => {
    const bar = await page.locator("[data-summary-bar]").boundingBox();
    const toast = page.locator("[data-undo-toast]");
    const toastHeight = (await toast.count()) > 0 ? (await box(toast)).height : 0;
    const floats = (await toast.count()) > 0 && (await toast.getAttribute("data-toast-placement")) === "float";
    const raw = bar === null ? toastHeight : floats ? bar.height + 8 + toastHeight : bar.height;
    return Math.min(raw, page.viewportSize()!.height / 4);
  };
  /** A preview that stays pending, so the bar keeps its accepted shares (and its height) through the test. */
  const pendingPreview: NonNullable<Stubs["getPreview"]> = async (route) => { await new Promise((resolve) => setTimeout(resolve, 20_000)); try { await json(200, agree.response)(route); } catch {} };
  const rtlLocales = locales.filter((locale) => directionOf(locale) === "rtl");
  /** WCAG 1.4.12 text-spacing overrides. */
  const spacing = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";
  const treeColumn = (page: Page) => page.locator("section[data-tree]").locator("xpath=ancestor::div[contains(@class,'lg:col-start-2')][1]");
  const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  // Story 9.14: a generation line is one row at every width and the deceased does not jump.
  for (const locale of ["en", "ar"] as const) {
    test(`six sons: one row, sideways scroll, centred and steady deceased on add and shrink in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 375, height: 900 });
      const sons = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `row${i}`, relationship: "son", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } }));
      const kase = stamp(fullCase(agree.case, { deaths: [], heirs: sons(6) }) as Record<string, any>, 5); // eslint-disable-line @typescript-eslint/no-explicit-any
      await openAgree(page, api, locale, kase);
      const t = messages[locale].interview, canvas = page.getByRole("group", { name: t.treeHeading });
      const root = canvas.locator('[data-node="root"]');
      await canvas.scrollIntoViewIfNeeded();
      const tops = async () => Promise.all(Array.from({ length: 6 }, async (_, i) => Math.round((await box(canvas.locator(`[data-node="row${i}"]`))).y)));
      await expect.poll(async () => new Set(await tops()).size).toBe(1);
      expect(await canvas.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      const centred = async () => {
        const c = await canvas.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left + el.clientLeft + el.clientWidth / 2; });
        const r = await box(root);
        return Math.abs(r.x + r.width / 2 - c);
      };
      const settled = async () => {
        let last = (await box(root)).x;
        await expect.poll(async () => { await page.waitForTimeout(200); const x = (await box(root)).x; const same = x === last; last = x; return same; }).toBe(true);
        return last;
      };
      const inside = async () => {
        const outer = (await box(canvas)), r = await box(root);
        expect(r.x).toBeGreaterThanOrEqual(outer.x + 5); expect(r.x + r.width).toBeLessThanOrEqual(outer.x + outer.width - 5);
      };
      // Centred on entry, and again after Fit tree from a panned position.
      await expect.poll(centred).toBeLessThanOrEqual(2);
      await canvas.evaluate((el) => { el.scrollLeft += el.scrollLeft < 100 ? 100 : -100; });
      await page.getByRole("button", { name: t.treeFit, exact: true }).click();
      await expect.poll(centred).toBeLessThanOrEqual(2);
      // Adding a seventh son: once the reveal has finished, the deceased is still inside the canvas.
      const after = stamp({ ...kase, heirs: sons(7) }, 6);
      api.set({ postHeir: json(201, { case: after }) });
      await page.getByRole("button", { name: t.addRelative.replace("{relationship}", t.relationships.son), exact: true }).click();
      await expect(canvas.locator('[data-node="row6"]')).toBeInViewport();
      await settled();
      await inside();
      // Shrink without a reveal: pan 40px toward inline start, remove the son next to the spine (focus then stays in view), the deceased does not move.
      await canvas.evaluate((el) => { el.scrollLeft += el.scrollLeft < 0 || el.clientWidth < 0 ? 40 : (getComputedStyle(el).direction === "rtl" ? 40 : -40); });
      const before = await settled();
      api.set({ deleteHeir: json(200, { case: stamp({ ...kase, heirs: sons(7).filter((h) => h.id !== "row3") }, 7) }) });
      await canvas.locator('[data-node="row3"]').press("Delete");
      await page.locator("[data-edit-sheet]").getByRole("button", { name: t.heirRemoveYes }).click();
      await expect(canvas.locator('[data-node="row3"]')).toHaveCount(0);
      expect(Math.abs((await settled()) - before)).toBeLessThanOrEqual(1);
    });
  }

  for (const locale of ["en", "ar"] as const) {
    const t = messages[locale].interview;
    for (const width of [320, 639, 640, 1023, 1024, 1279, 1280]) {
      test(`geometry at ${width}px in ${locale}`, async ({ page, api }) => {
        await page.setViewportSize({ width, height: 900 });
        await openCanvasFixture(page, api, locale);
        const rtl = locale === "ar";
        const add = page.locator("section[aria-labelledby='add-relatives-heading']");
        const tree = page.locator("section[data-tree]");
        const list = page.locator("section[aria-labelledby='heirs-heading']");
        // The Share preview is not on the Interview at any width (story 11.2).
        await expect(page.locator("section[aria-labelledby='preview-heading']")).toHaveCount(0);
        expect(await noOverflow(page)).toBe(true);
        const [a, tr, l] = [await box(add), await box(tree), await box(list)];
        // Cards are 108px below 640px and 136px from there.
        const card = page.locator('[data-node]:not([data-node="root"])').first();
        expect((await box(card)).width).toBeCloseTo(width < 640 ? 108 : 136, 0);
        const edge = (b: { x: number; width: number }) => (rtl ? width - (b.x + b.width) : b.x);
        if (width < 1024) {
          expect(edge(a)).toBeCloseTo(16, 0);
          expect(a.y).toBeLessThan(tr.y);
          expect(tr.y).toBeLessThan(l.y);
        } else {
          expect(edge(a)).toBeCloseTo(24, 0);
          expect(a.width).toBeCloseTo(380, 0);
          const column = treeColumn(page);
          const cb = await box(column);
          if (width === 1024) expect(cb.width).toBeGreaterThanOrEqual(596);
          // Two columns from 1024px, the tree flexible to the shell's edge: no third column at 1280px.
          expect(await column.evaluate((el) => getComputedStyle(el).borderInlineStartWidth + " " + getComputedStyle(el).borderInlineStartStyle)).toBe("1px solid");
          expect(Math.abs(edge(cb) - (edge(a) + 380))).toBeLessThan(1);
        }
        // The edit surface: a bottom sheet below 640px, a non-modal panel from there.
        const editable = page.locator('[data-node]:not([data-node="root"]):not([data-state="died_later"])').first();
        await editable.focus();
        await editable.press("Enter");
        if (width < 640) {
          await expect(page.locator("dialog[data-edit-sheet]:modal")).toBeVisible();
        } else {
          const panel = page.locator("section[data-edit-sheet]");
          await expect(panel).toBeVisible();
          const pn = await box(panel);
          // The panel sits below the tree, inside its column, at every width from 640px.
          const tb = await box(tree);
          expect(pn.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1);
          expect(pn.x).toBeGreaterThanOrEqual(tb.x - 1);
          expect(pn.x + pn.width).toBeLessThanOrEqual(tb.x + tb.width + 1);
          expect(await panel.evaluate((el) => !el.matches(":modal"))).toBe(true);
          // Escape closes it and returns focus to the opening card.
          await panel.getByLabel(t.heirNameLabel).press("Escape");
          await expect(panel).toHaveCount(0);
          await expect(editable).toBeFocused();
        }
      });
    }
  }

  test("1280px in a later estate: the panel stays in the tree column", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCanvasFixture(page, api, "en");
    const later = page.locator('[data-node][data-state="died_later"]').first();
    await later.focus();
    await later.press("Enter");
    await expect(page.locator("[data-breadcrumb]")).toBeVisible();
    await expect(page.locator("section[aria-labelledby='preview-heading']")).toHaveCount(0);
    const editable = page.locator('[data-node][data-state="normal"], [data-node][data-state="blocked"], [data-node][data-state="died_before"]').first();
    await editable.focus();
    await editable.press("Enter");
    const panel = page.locator("section[data-edit-sheet]");
    await expect(panel).toBeVisible();
    // Both boxes in one frame: the page may still be finishing its smooth focus scroll.
    const [tree, pn] = await page.evaluate(() => ["section[data-tree]", "section[data-edit-sheet]"].map((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(pn.x).toBeGreaterThanOrEqual(tree.x - 1);
    expect(pn.x + pn.width).toBeLessThanOrEqual(tree.x + tree.width + 1);
    expect(pn.y).toBeGreaterThanOrEqual(tree.y + tree.height - 1);
  });

  for (const locale of ["en", "ar"] as const) {
    test(`320px with text spacing in ${locale}: reflow, one 2D scroller, focus inside, no clipped cards, edit`, async ({ page, api }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await openCanvasFixture(page, api, locale, "many");
      await page.addStyleTag({ content: spacing });
      const t = messages[locale].interview;
      expect(await noOverflow(page)).toBe(true);
      const group = page.getByRole("group", { name: t.treeHeading });
      await expect(group).toBeVisible();
      const scrollers = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
        const s = getComputedStyle(el);
        return /auto|scroll/.test(s.overflowX) && /auto|scroll/.test(s.overflowY);
      }).map((el) => el.hasAttribute("data-tree-area")));
      expect(scrollers).toEqual([true]);
      expect(await group.evaluate((el) => parseFloat(getComputedStyle(el).paddingInlineStart))).toBeGreaterThanOrEqual(6);
      const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-tree-area] [data-node]")].filter((el) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth).map((el) => el.dataset.node));
      expect(clipped).toEqual([]);
      // Reaching each card keeps its outline inside the canvas's visible box.
      await page.locator('[data-node="root"]').focus();
      for (const key of ["ArrowDown", "End", "Home"]) {
        await page.keyboard.press(key);
        // Focus re-renders the selection and scrolls; check once the canvas has settled.
        await expect.poll(() => page.evaluate(() => {
          const area = document.querySelector<HTMLElement>("[data-tree-area]")!;
          const a = area.getBoundingClientRect();
          const focused = document.activeElement as HTMLElement;
          const r = focused.getBoundingClientRect();
          const style = getComputedStyle(focused);
          const grow = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0);
          return r.left - grow >= a.left - 0.5 && r.right + grow <= a.left + area.clientWidth + 0.5 && r.top - grow >= a.top - 0.5 && r.bottom + grow <= a.top + area.clientHeight + 0.5;
        })).toBe(true);
      }
      const editable = page.locator('[data-node]:not([data-node="root"]):not([data-state="died_later"])').first();
      await editable.focus();
      await editable.press("Enter");
      const sheet = page.locator("dialog[data-edit-sheet]:modal");
      await expect(sheet).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(editable).toBeFocused();
    });

    test(`320px with text spacing in ${locale}: add, toast obstruction and Undo`, async ({ page, api }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      const kase = start();
      await openAgree(page, api, locale, kase);
      await page.addStyleTag({ content: spacing });
      // The next preview stays pending, so the bar is present with its accepted shares throughout.
      api.set({ postHeir: json(201, { case: added(kase) }), getPreview: pendingPreview });
      await page.locator('[data-focus="add:son"]').click();
      const toast = page.locator("[data-undo-toast]");
      await expect(toast).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      const padding = () => page.evaluate(() => ({ variable: document.documentElement.style.getPropertyValue("--interview-obstruction"), computed: getComputedStyle(document.documentElement).scrollPaddingBlockEnd }));
      await expect.poll(async () => parseFloat((await padding()).computed) - (await expectedObstruction(page))).toBeCloseTo(0, 0);
      const now = await padding();
      expect(now.variable).toBe(now.computed);
      const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-tree-area] [data-node]")].filter((el) => el.scrollHeight > el.clientHeight).map((el) => el.dataset.node));
      expect(clipped).toEqual([]);
      api.set({ postRestore: json(200, { case: stamp(kase, 7) }) });
      await toast.getByRole("button", { name: messages[locale].interview.undoAction, exact: true }).click();
      await expect(page.locator("[data-node='new-son']")).toHaveCount(0);
      expect(api.restorePosts).toHaveLength(1);
    });
  }

  test("the obstruction follows the mounted toast when its height changes", async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const kase = start();
    await openAgree(page, api, "en", kase);
    api.set({ postHeir: json(201, { case: added(kase) }), getPreview: pendingPreview });
    await page.locator('[data-focus="add:son"]').click();
    const toast = page.locator("[data-undo-toast]");
    await expect(toast).toBeVisible();
    const variable = () => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--interview-obstruction")));
    const before = (await box(toast)).height;
    await expect.poll(async () => (await variable()) - (await expectedObstruction(page))).toBeCloseTo(0, 0);
    await page.addStyleTag({ content: "[data-undo-toast] { padding-block: 40px !important; }" });
    await expect.poll(async () => (await box(toast)).height).toBeGreaterThan(before + 20);
    const after = (await box(toast)).height;
    expect(after).toBeLessThan(225);
    // The taller toast is followed: still floating above the bar, or moved into the flow past the quarter.
    await expect.poll(async () => (await variable()) - (await expectedObstruction(page))).toBeCloseTo(0, 0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the rendered toast uses the foreground fill and the toast-focus ring in ${scheme} mode`, async ({ page, api }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 800, height: 900 });
      const kase = start();
      await openAgree(page, api, "en", kase);
      api.set({ postHeir: json(201, { case: added(kase) }) });
      await page.locator('[data-focus="add:son"]').click();
      const toast = page.locator("[data-undo-toast]");
      await expect(toast).toBeVisible();
      const css = readFileSync(join(process.cwd(), "src", "app", "[locale]", "globals.css"), "utf8");
      const block = scheme === "light" ? css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")) : css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));
      const rgb = (name: string) => {
        const hex = new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, "i").exec(block)![1];
        return `rgb(${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
      };
      const button = toast.getByRole("button", { name: en.undoAction, exact: true });
      let reached = false;
      for (let step = 0; step < 80 && !reached; step += 1) {
        await page.keyboard.press("Tab");
        reached = await button.evaluate((el) => el === document.activeElement);
      }
      expect(reached).toBe(true);
      await expect(toast).toHaveCSS("background-color", rgb("foreground"));
      await expect(button).toHaveCSS("outline-color", rgb("toast-focus"));
      await expect(button).toHaveCSS("outline-style", "solid");
    });
  }

  test("an edit that moves an existing card past the canvas edge ends with it inside the canvas", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await openCanvasFixture(page, api, "en", "many");
    const kase = fullCase(agree.case, {
      deaths: [],
      heirs: Array.from({ length: 50 }, (_, i) => ({ id: `many${i}`, relationship: "son", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } })),
      placement: { root: [{ relationship: "father", link: "parent", blocked: false }, { relationship: "wife", link: "spouse", blocked: false }] },
    }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const [first, ...rest] = kase.heirs;
    // The first son comes back last: its card moves to the far end of the tree.
    api.set({ putHeir: json(200, { case: { ...kase, revision: kase.revision + 1, heirs: [...rest, { ...first, name: "Moved" }] } }) });
    const card = page.locator('[data-node="many0"]');
    await card.focus();
    await card.press("Enter");
    const name = page.locator("[data-edit-sheet]").getByLabel(en.heirNameLabel);
    await name.fill("Moved");
    await name.press("Tab");
    await expect(page.locator('[data-node="many0"]')).toContainText("Moved");
    await expect.poll(() => page.evaluate(() => {
      const area = document.querySelector<HTMLElement>("[data-tree-area]")!;
      const a = area.getBoundingClientRect();
      const r = document.querySelector<HTMLElement>('[data-node="many0"]')!.getBoundingClientRect();
      return r.left >= a.left - 0.5 && r.right <= a.left + area.clientWidth + 0.5 && r.top >= a.top - 0.5 && r.bottom <= a.top + area.clientHeight + 0.5;
    }), { timeout: 3000 }).toBe(true);
  });

  test("the obstruction follows the bar plus the floating toast, and the bar alone when the toast flows", async ({ page, api }) => {
    await page.clock.install();
    await page.setViewportSize({ width: 375, height: 800 });
    const kase = start();
    await openAgree(page, api, "en", kase);
    const bar = page.locator("[data-summary-bar]");
    await expect(bar).toBeVisible();
    const barHeight = (await box(bar)).height;
    const variable = () => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--interview-obstruction")));
    await expect.poll(variable).toBeCloseTo(barHeight, 0);
    // The next preview stays pending, so the bar keeps its accepted shares while the toast shows.
    api.set({ getPreview: async (route) => { await new Promise((resolve) => setTimeout(resolve, 20_000)); try { await json(200, agree.response)(route); } catch {} }, postHeir: json(201, { case: added(kase) }) });
    await page.locator('[data-focus="add:son"]').click();
    const toast = page.locator("[data-undo-toast]");
    await expect(toast).toHaveAttribute("data-toast-placement", "float");
    const toastHeight = (await box(toast)).height;
    await expect.poll(variable).toBeCloseTo(barHeight + 8 + toastHeight, 0);
    // Too tall for a quarter of the viewport: the toast moves into the flow and the bar alone is registered.
    await page.setViewportSize({ width: 375, height: 380 });
    await expect(toast).toHaveAttribute("data-toast-placement", "flow");
    await expect.poll(variable).toBeCloseTo(Math.min(barHeight, 95), 0);
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(toast).toHaveAttribute("data-toast-placement", "float");
    await page.clock.fastForward(10_500);
    await expect(toast).toHaveCount(0);
    // Only the bar can remain, never the toast. If the pending preview timed out, the bar now shows that
    // failure; under the fake clock its registered height may still lag its new box, so this is a bound.
    await expect.poll(async () => (await variable()) <= ((await bar.boundingBox())?.height ?? 0) + 0.5).toBe(true);
  });

  test.describe("reduced motion", () => {
    test.describe("reduce", () => {
      test.use({ reducedMotion: "reduce" });
      test("nothing in the Interview transitions or animates, and every action still works", async ({ page, api }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const kase = start();
        await openAgree(page, api, "en", kase);
        api.set({ postHeir: json(201, { case: added(kase) }) });
        await page.locator('[data-focus="add:son"]').click();
        await expect(page.locator("[data-undo-toast]")).toBeVisible();
        await expect(page.locator("[data-node='new-son']")).toBeVisible();
        await page.locator('[data-node]:not([data-node="root"]):not([data-state="died_later"])').first().press("Enter");
        await expect(page.locator("section[data-edit-sheet]")).toBeVisible();
        const moving = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-js-only], [data-js-only] *")].filter((el) => {
          const s = getComputedStyle(el);
          return (s.transitionProperty !== "none" && s.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) || (s.animationName !== "none" && s.animationDuration.split(",").some((d) => parseFloat(d) > 0));
        }).map((el) => el.tagName));
        expect(moving).toEqual([]);
        await expect(page.locator('[data-node="new-son"]')).toHaveCSS("transition-duration", "0s");
      });
    });
    test.describe("no-preference", () => {
      test.use({ reducedMotion: "no-preference" });
      test("positioned cards transition inset and top over 300ms", async ({ page, api }) => {
        const kase = start();
        await openAgree(page, api, "en", kase);
        const card = page.locator("[data-node]:not([data-node='root'])").first();
        await expect(card).toHaveCSS("transition-duration", /^0\.3s(, 0\.3s)?$/);
        await expect(card).toHaveCSS("transition-property", "inset-inline-start, top");
        api.set({ postHeir: json(201, { case: added(kase) }) });
        await page.locator('[data-focus="add:son"]').click();
        await expect(page.locator("[data-node='new-son']")).toHaveCSS("transition-duration", /^0\.3s(, 0\.3s)?$/);
      });
    });
  });

  test("the registry, not a literal ar, decides direction", async () => {
    const { directionFrom } = await import("../src/i18n/messages");
    const registry = { locales: [{ code: "ur", direction: "rtl" as const }, { code: "en", direction: "ltr" as const }] };
    expect(directionFrom(registry, "ur")).toBe("rtl");
    expect(directionFrom(registry, "zz")).toBe("ltr");
    expect(rtlLocales.length).toBeGreaterThan(0);
    const published = { locales: locales.map((code) => ({ code, direction: directionOf(code) })) };
    for (const locale of locales) expect(directionFrom(published, locale)).toBe(directionOf(locale));
  });

  for (const locale of locales) {
    test(`RTL derives from the registry in ${locale}: arrows, connector, text and order`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openCanvasFixture(page, api, locale as "en" | "ar" | "fr");
      const rtl = directionOf(locale) === "rtl";
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.locator("html")).toHaveAttribute("dir", rtl ? "rtl" : "ltr");
      const group = page.locator("[data-tree-area]");
      // Only the connector SVG is transformed.
      expect(await group.locator("svg").first().evaluate((el) => getComputedStyle(el).scale)).toBe(rtl ? "-1 1" : "none");
      const flat = await group.evaluate((el) => [...el.querySelectorAll<HTMLElement>("button, button strong, button span:not([aria-hidden='true'])")].filter((n) => getComputedStyle(n).transform !== "none" || getComputedStyle(n).scale !== "none").map((n) => n.tagName));
      expect(flat).toEqual([]);
      const chevron = group.locator("[data-state='died_later'] span[aria-hidden='true']").first();
      expect(await chevron.evaluate((el) => getComputedStyle(el).scale)).toBe(rtl ? "-1 1" : "none");
      // Inline arrows are mirrored: the next sibling lies at the inline-end side.
      await page.locator('[data-node="root"]').focus();
      await page.keyboard.press("ArrowDown");
      const first = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.node);
      await page.keyboard.press(rtl ? "ArrowLeft" : "ArrowRight");
      const second = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.node);
      expect(second).not.toBe(first);
      await page.keyboard.press(rtl ? "ArrowRight" : "ArrowLeft");
      expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.node)).toBe(first);
    });

    test(`the count stepper reads from the inline-start side in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openHeirsScreen(page, api, locale as "en" | "ar" | "fr");
      const rtl = directionOf(locale) === "rtl";
      const stepper = page.locator("[data-focus='add:son']").locator("xpath=following-sibling::div[1]");
      const buttons = stepper.locator("button");
      const [fewer, more] = [await box(buttons.nth(0)), await box(buttons.nth(1))];
      expect(rtl ? fewer.x > more.x : fewer.x < more.x).toBe(true);
    });
  }

  for (const locale of ["en", "ar"] as const) {
    test(`names, terms and fractions keep their own direction markup in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openHeirsScreen(page, api, locale);
      const sheet = await openPreview(page);
      const preview = sheet.locator("section[aria-labelledby='preview-heading']");
      expect(await preview.locator("span[lang][dir]").count()).toBe(0);
      expect(await preview.locator("bdi[lang][dir]").count()).toBeGreaterThan(0);
      if (locale === "en") expect(await preview.locator("bdi[lang='ar'][dir='rtl']").count()).toBeGreaterThan(0);
      const fractions = await preview.evaluate((el) => [...el.querySelectorAll("*")].filter((n) => n.children.length === 0 && /^\d+\/\d+$/.test(n.textContent?.trim() ?? "")).map((n) => n.closest("[dir]")?.getAttribute("dir")));
      expect(fractions.length).toBeGreaterThan(0);
      expect(fractions.every((dir) => dir === "ltr")).toBe(true);
    });
  }
});

test.describe("Story 9.13: link a later-estate heir from the edit sheet", () => {
  const layered = fixture("Agree layered: wife and two sons, a son dies");
  const options = { blocked: [], invalid: {} };
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const later = (kase: Row, rows: Row[], revision: number): Row => ({
    ...kase, revision, snapshot: { at: revision, r1: rows.find(row => row.id === "r1")?.same_as ?? null }, deaths: [{ ...kase.deaths[0], heirs: rows }],
  });
  const unlinked = (): Row[] => [
    { id: "r1", relationship: "mother", gender: "female", name: null, edit_options: options, link_candidates: ["w"] },
    { id: "r2", relationship: "brother", gender: "male", name: null, same_as: "s2", edit_options: options, link_candidates: ["s2"] },
  ];
  const base = (): Row => {
    const kase = fullCase(layered.case, { snapshot: { at: 1 } }) as Row;
    kase.deaths = [{ ...(layered.case.deaths as Row[])[0], heir_options: options, heirs: [] }];
    return later(kase, unlinked(), 1);
  };
  const namedWife = (kase: Row, rows: Row[], revision: number) => ({
    ...later(kase, rows, revision), heirs: kase.heirs.map((row: Row) => row.id === "w" ? { ...row, name: "Amal" } : row),
  });
  const openEstate = async (page: Page, api: Parameters<typeof openHeirsScreen>[1], kase: Row, locale: "en" | "ar" = "en") => {
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, { status: "not_ready", revision: kase.revision }) });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("section[data-tree] [data-tree-area]").waitFor();
    await page.locator('[data-node="s1"]').press("Enter");
    await expect(page.locator("[data-focus='treeHeading']")).toBeFocused();
  };
  const sameAs = (page: Page) => page.locator("[data-edit-sheet] #edit-same-as");
  const headerUndo = (page: Page) => page.getByRole("button", { name: en.undoLastChange, exact: true });

  test("the old add form is absent in the first and a later estate", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEstate(page, api, base());
    for (const selector of ["#heir-form-heading", "#heir-name", "#heir-same-as", "input[name='heir-link']"]) await expect(page.locator(selector)).toHaveCount(0);
    await expect(page.locator("section[aria-labelledby='add-relatives-heading'] form")).toHaveCount(0);
    await page.locator("[data-breadcrumb] a").click();
    for (const selector of ["#heir-form-heading", "#heir-name", "input[name='heir-link']"]) await expect(page.locator(selector)).toHaveCount(0);
  });

  for (const [name, size] of [["phone sheet", { width: 390, height: 800 }], ["desktop panel", { width: 1280, height: 900 }]] as const) {
    test(`link, unlink, refusal and Undo on the ${name}`, async ({ page, api }) => {
      await page.setViewportSize(size);
      const kase = base();
      await openEstate(page, api, kase);
      await page.locator('[data-node="r1"]').press("Enter");
      const field = sameAs(page);
      await expect(field).toBeVisible();
      await expect(page.locator("[data-edit-sheet] label[for='edit-same-as']")).toHaveText(en.linkSameAsLabel);
      expect((await field.locator("option").allTextContents()).map(text => text.replace(/[⁨⁩]/g, ""))).toEqual([en.linkNobody, "Wife"]);
      expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // Refused: nothing changes and the reason shows at the field.
      api.set({ putHeir: json(400, { errors: { same_as: "not_alive" } }) });
      await field.selectOption("w");
      await expect(page.locator("#edit-same-as-error")).toHaveText(en.fieldErrors.same_as.not_alive);
      await expect(field).toBeFocused();
      expect(JSON.parse(api.heirPuts[0])).toMatchObject({ relationship: "mother", same_as: "w", expected_revision: 1 });
      // Accepted: the card shows the person's name.
      const linked = namedWife(kase, [{ ...unlinked()[0], same_as: "w", name: "Amal" }, unlinked()[1]], 2);
      const availablePreview = { ...layered.response, revision: 2, presented: served.presented[layered.title] };
      api.set({ putHeir: json(200, { case: linked }), getPreview: json(200, availablePreview), postRestore: json(200, { case: namedWife(kase, unlinked(), 3) }) });
      await field.selectOption("w");
      await expect(page.locator('[data-node="r1"]')).toContainText("Amal");
      await expect(field).toHaveValue("w");
      await expect(page.locator("[role='status']").filter({ hasText: "linked to a person already in the case" }).first()).toBeAttached();
      await page.locator("[data-edit-sheet]").getByRole("button", { name: en.editClose }).click();
      await expect(page.locator("section[aria-labelledby='heirs-heading']")).toContainText("Amal");
      // The calculation of the accepted revision is the one settled, not the earlier not-ready one.
      await page.locator("[data-breadcrumb] a").click();
      await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "ready");
      await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-revision", "2");
      // The shares of that revision are in the sheet.
      const shares = await openPreview(page);
      await expect(shares.locator("ul > li").first()).toBeVisible();
      await closePreview(page);
      // Undo restores the unlinked row, with the prior snapshot at the current revision.
      await headerUndo(page).first().click();
      await expect.poll(() => api.restorePosts.length).toBe(1);
      expect(restoreBody(api.restorePosts[0].body)).toMatchObject({ expected_revision: 2, snapshot: { at: 1, r1: null } });
      await page.locator('[data-node="s1"]').press("Enter");
      await expect(page.locator('[data-node="r1"]')).not.toContainText("Amal");
      // Unlink the other row: Nobody else sends null.
      const cleared = later(kase, [unlinked()[0], { ...unlinked()[1], same_as: undefined, name: null }], 4);
      api.set({ putHeir: json(200, { case: cleared }) });
      await page.locator('[data-node="r2"]').press("Enter");
      await expect(field).toHaveValue("s2");
      await field.selectOption("");
      await expect.poll(() => api.heirPuts.length).toBe(3);
      expect(JSON.parse(api.heirPuts[2]).same_as).toBeNull();
    });
  }

  test("a stale link edit shows the conflict notice and the field stays", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = base();
    await openEstate(page, api, kase);
    await page.locator('[data-node="r1"]').press("Enter");
    api.set({ putHeir: json(409, { error: "conflict", case: later(kase, unlinked(), 5) }) });
    await sameAs(page).selectOption("w");
    await expect(page.locator("[data-edit-sheet]").getByText(en.conflictNotice)).toBeVisible();
  });

  test("Tab reaches the field, and a person with no candidates has none", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = base();
    kase.deaths[0].heirs[0].link_candidates = [];
    kase.deaths[0].heirs.push({ id: "r3", relationship: "sister", gender: "female", name: null, edit_options: options, link_candidates: ["w"] });
    await openEstate(page, api, kase);
    await page.locator('[data-node="r1"]').press("Enter");
    await expect(sameAs(page)).toHaveCount(0);
    await page.locator('[data-node="r3"]').press("Enter");
    await page.locator("[data-edit-sheet] input[name='relationship']").first().focus();
    for (let step = 0; step < 12 && !(await sameAs(page).evaluate(el => el === document.activeElement)); step += 1) await page.keyboard.press("Tab");
    await expect(sameAs(page)).toBeFocused();
  });

  test("the first estate edit sheet has no link field", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEstate(page, api, base());
    await page.locator("[data-breadcrumb] a").click();
    await page.locator('[data-node="w"]').press("Enter");
    await expect(page.locator("section[data-edit-sheet]")).toBeVisible();
    await expect(sameAs(page)).toHaveCount(0);
  });

  test("Arabic mirrors the field and 320px reflows without horizontal scroll", async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openEstate(page, api, base(), "ar");
    await page.locator('[data-node="r1"]').press("Enter");
    const field = sameAs(page);
    await expect(field).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("label[for='edit-same-as']")).toHaveText(messages.ar.interview.linkSameAsLabel);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const box = (await field.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });
});

test.describe("Story 11.3: the summary bar and sheet", () => {
  for (const locale of ["en", "ar"] as const) for (const width of [375, 1366]) {
    test(`the fixed bar spans the viewport with its controls reachable at ${width}px in ${locale}`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 800 });
      await openHeirsScreen(page, api, locale);
      const t = messages[locale].interview;
      const bar = page.locator("[data-summary-bar]");
      await expect(bar).toBeVisible();
      const frame = (await bar.boundingBox())!;
      expect(frame.x).toBeCloseTo(0, 0);
      expect(frame.width).toBeCloseTo(width, 0);
      expect(frame.y + frame.height).toBeCloseTo(800, 0);
      expect(frame.height).toBeGreaterThanOrEqual(44);
      await expect(bar).toContainText(t.previewReadyCount.replace("{count}", "3"));
      const results = bar.getByRole("link", { name: t.previewResultsLink });
      const chevron = bar.getByRole("button", { name: t.previewHeading });
      for (const control of [results, chevron]) {
        const b = (await control.boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
        expect(b.y + b.height).toBeLessThanOrEqual(800);
      }
      await expect(results).toHaveAttribute("href", `/${locale}/results/`);
      await expect(chevron).toHaveAttribute("aria-haspopup", "dialog");
      await expect(chevron).toHaveAttribute("aria-expanded", "false");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The bar's height is part of the block-end obstruction.
      const obstruction = await page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--interview-obstruction")));
      expect(obstruction).toBeGreaterThanOrEqual(44);
      if (width >= 1024) {
        const add = (await page.locator("section[aria-labelledby='add-relatives-heading']").boundingBox())!;
        const tree = (await page.locator("section[data-tree]").boundingBox())!;
        expect(add.width).toBeCloseTo(380, 0);
        // The 380px column sits at the inline-start: left in English, right in Arabic.
        if (locale === "ar") expect(tree.x + tree.width).toBeLessThan(add.x + 1);
        else expect(tree.x).toBeGreaterThan(add.x + add.width - 1);
      }
    });
  }

  test("Escape, Close and a scrim click each close the sheet and return focus to the chevron", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, "en");
    const chevron = page.locator("[data-summary-expand]");
    const revision = () => page.locator("[data-preview-state]").getAttribute("data-preview-revision");
    const before = await revision();
    const writes = api.casePosts.length + api.heirPosts.length;
    const sheet = await openPreview(page);
    await expect(sheet.locator("h2#preview-heading")).toBeFocused();
    await expect(sheet).toHaveAttribute("aria-labelledby", "preview-heading");
    // The sheet sits at the block-end edge, under the scrim.
    await expect.poll(async () => { const b = (await sheet.boundingBox())!; return Math.abs(b.y + b.height - 800); }).toBeLessThan(1);
    await expect(page.locator("[data-summary-bar]")).toHaveAttribute("inert", "");
    const frame = (await sheet.boundingBox())!;
    expect(frame.height).toBeLessThanOrEqual(800 * 0.78 + 1);
    expect(frame.width).toBeCloseTo(375, 0);
    await expect(sheet.locator("[data-notice='disclaimer']")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(chevron).toBeFocused();
    await expect(page.locator("[data-summary-bar]")).not.toHaveAttribute("inert", "");
    await openPreview(page);
    await sheet.getByRole("button", { name: en.editClose, exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(chevron).toBeFocused();
    await openPreview(page);
    await page.mouse.click(187, 20);
    await expect(sheet).toBeHidden();
    await expect(chevron).toBeFocused();
    expect(await revision()).toBe(before);
    expect(api.casePosts.length + api.heirPosts.length).toBe(writes);
  });

  test("the text area of the bar opens the sheet, and Full results does not", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, "en");
    await page.locator("[data-summary-text]").click();
    await expect(sheetOf(page)).toBeVisible();
    await closePreview(page);
    await expect(page.locator("[data-summary-bar]").getByRole("link", { name: en.previewResultsLink })).toHaveAttribute("href", "/en/results/");
    await expect(sheetOf(page)).toBeHidden();
  });

  const differStubs = (api: Parameters<typeof openHeirsScreen>[1], opts: { afterChoice?: Stubs["getPreview"] } = {}) => {
    const differ = fixture("Differ: grandfather and full brother");
    const stored = fullCase(differ.case, { madhab: "hanafi" });
    let chosen = false;
    api.set({
      session: sessionAnonymous,
      getCase: (route) => json(200, { case: chosen ? stored : fullCase(differ.case) })(route),
      patchCase: (route) => { chosen = true; return json(200, { case: stored })(route); },
      getPreview: (route) => (chosen && opts.afterChoice ? opts.afterChoice(route) : json(200, chosen ? differ.response.schools.hanafi : differ.response)(route)),
    });
    return differ;
  };

  test("a School-comparison sheet that overflows a short viewport scrolls to Continue, and Continue works", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 420 });
    const differ = differStubs(api);
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const sheet = await openPreview(page);
    const scroller = sheet.locator("div.overflow-y-auto");
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await sheet.getByRole("radio", { name: en.madhabs.hanafi.name }).check();
    const next = sheet.getByRole("button", { name: en.madhabContinue });
    await next.scrollIntoViewIfNeeded();
    const [frame, view] = [(await next.boundingBox())!, (await sheet.boundingBox())!];
    expect(frame.y + frame.height).toBeLessThanOrEqual(view.y + view.height + 1);
    await next.click();
    await expect.poll(() => api.casePatches.length).toBe(1);
    expect(JSON.parse(api.casePatches[0].body)).toMatchObject({ madhab: "hanafi", case_id: differ.case.id });
  });

  test("an online failure with the sheet open keeps it open with the error, and Retry asks again and goes pending", async ({ page, api }) => {
    differStubs(api, { afterChoice: json(500, {}) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const sheet = await openPreview(page);
    await sheet.getByRole("radio", { name: en.madhabs.hanafi.name }).check();
    await sheet.getByRole("button", { name: en.madhabContinue }).click();
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "error");
    // No shares are left, yet the sheet stays with the error and Retry; the bar waits behind it.
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(en.previewFailed)).toBeVisible();
    await expect(page.locator("[data-summary-bar]")).toHaveAttribute("inert", "");
    const gets = api.previewGets;
    const differ = fixture("Differ: grandfather and full brother");
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    api.set({ getPreview: async (route) => { await gate; try { await json(200, differ.response.schools.hanafi)(route); } catch {} } });
    await sheet.getByRole("button", { name: en.previewRetry }).click();
    await expect.poll(() => api.previewGets).toBeGreaterThan(gets);
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "pending");
    await expect(sheet).toBeVisible();
    release();
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "ready");
  });

  test("a whole-preview refusal arriving while the sheet is open keeps it open with the served reason", async ({ page, api }) => {
    const differ = fixture("Differ: grandfather and full brother");
    const chosen = differ.response.schools.hanafi;
    // A whole-preview refusal for the chosen School, matching the saved revision and family.
    const refusal = { status: "unavailable", madhab: "hanafi", reason: "malikiyya_disputed", revision: chosen.revision, basis: chosen.basis, presented: served.presented["Maliki Malikiyya is refused"] };
    differStubs(api, { afterChoice: json(200, refusal) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    const sheet = await openPreview(page);
    await sheet.getByRole("radio", { name: en.madhabs.hanafi.name }).check();
    await sheet.getByRole("button", { name: en.madhabContinue }).click();
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "refused");
    await expect(page.locator("dialog[data-summary-sheet]:modal")).toBeVisible();
    await expect(sheet.getByText(en.previewUnavailable)).toBeVisible();
    await expect(sheet.getByText(en.previewReasons.malikiyya_disputed)).toBeVisible();
    await expect(page.locator("[data-summary-bar]")).toHaveAttribute("inert", "");
  });

  test("a whole-preview refusal on load shows the bar, and the sheet gives the served reason", async ({ page, api }) => {
    const differ = fixture("Differ: grandfather and full brother");
    const chosen = differ.response.schools.hanafi;
    const refusal = { status: "unavailable", madhab: "hanafi", reason: "malikiyya_disputed", revision: chosen.revision, basis: chosen.basis, presented: served.presented["Maliki Malikiyya is refused"] };
    api.set({ session: sessionAnonymous, getCase: json(200, { case: fullCase(differ.case, { madhab: "hanafi" }) }), getPreview: json(200, refusal) });
    await page.goto("/en/interview/");
    await page.getByRole("button", { name: en.resume }).click();
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "refused");
    const bar = page.locator("[data-summary-bar]");
    await expect(bar.locator("[data-summary-text]")).toHaveText(en.previewUnavailable);
    await expect(bar.getByRole("link", { name: en.previewResultsLink })).toBeVisible();
    const sheet = await openPreview(page);
    await expect(sheet.getByText(en.previewReasons.malikiyya_disputed)).toBeVisible();
  });

  test.describe("reduced motion", () => {
    test("the summary sheet and its scrim do not animate, and Escape still returns focus to the chevron", async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 375, height: 800 });
      await openHeirsScreen(page, api, "en");
      const sheet = await openPreview(page);
      expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      expect(await sheet.evaluate((el) => getComputedStyle(el, "::backdrop").animationName)).toBe("none");
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(page.locator("[data-summary-expand]")).toBeFocused();
    });
  });

  test("the one status node is inside the open dialog and back in the Interview after Close", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, "en");
    const status = page.locator("[role='status'][aria-atomic='true']");
    await expect(status).toHaveCount(1);
    await expect(sheetOf(page).locator("[role='status']")).toHaveCount(0);
    const sheet = await openPreview(page);
    await expect(page.locator("[role='status'][aria-atomic='true']")).toHaveCount(1);
    await expect(sheet.locator("[role='status'][aria-atomic='true']")).toHaveCount(1);
    await closePreview(page);
    await expect(page.locator("[role='status'][aria-atomic='true']")).toHaveCount(1);
    await expect(sheetOf(page).locator("[role='status']")).toHaveCount(0);
  });

  test("Full results in the bar navigates to the locale's results page", async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, "en");
    await page.route("**/en/results/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>results</title>" }));
    await page.locator("[data-summary-bar]").getByRole("link", { name: en.previewResultsLink }).click();
    await expect(page).toHaveURL(/\/en\/results\/$/);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the bar and sheet shadows and the scrim are drawn in ${scheme} mode`, async ({ page, api }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 375, height: 800 });
      await openHeirsScreen(page, api, "en");
      const bar = page.locator("[data-summary-bar]");
      expect(await bar.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/rgba\(0, 0, 0, 0\.12\) 0px -6px 16px 0px$/);
      expect(await bar.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("2px");
      const sheet = await openPreview(page);
      expect(await sheet.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/rgba\(0, 0, 0, 0\.2\) 0px -8px 24px 0px$/);
      expect(await sheet.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("18px");
      expect(await sheet.evaluate((el) => getComputedStyle(el, "::backdrop").backgroundColor)).toBe(scheme === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(23, 23, 23, 0.4)");
    });
  }
});

test.describe("Story 11.4: summary controls at narrow widths and high zoom", () => {
  const agree = fixture("Agree: wife, son and daughter in every school");
  const stamp = (kase: Record<string, any>, revision: number): Record<string, any> => ({ ...kase, revision, snapshot: { at: revision } }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const start = () => stamp(fullCase(agree.case) as Record<string, any>, 5); // eslint-disable-line @typescript-eslint/no-explicit-any
  const added = (kase: Record<string, any>) => stamp({ ...kase, heirs: [...kase.heirs, { id: "new-son", relationship: "son", gender: "male", name: null, edit_options: { blocked: [], invalid: {} } }] }, kase.revision + 1); // eslint-disable-line @typescript-eslint/no-explicit-any
  const spacing = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";
  const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
  const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  const variable = (page: Page) => page.evaluate(() => parseFloat(document.documentElement.style.getPropertyValue("--interview-obstruction")) || 0);
  const scrollPadding = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd));
  const open = async (page: Page, api: Parameters<typeof openHeirsScreen>[1], locale: "en" | "ar" | "fr", kase = start()) => {
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, agree.response) });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("[data-preview-state='ready']").waitFor();
  };

  for (const locale of ["en", "ar", "fr"] as const) for (const spaced of [false, true]) {
    test(`the bar wraps into two rows at 320px in ${locale}${spaced ? " with text spacing" : ""}`, async ({ page, api }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await open(page, api, locale);
      if (spaced) await page.addStyleTag({ content: spacing });
      const t = messages[locale].interview;
      const bar = page.locator("[data-summary-bar]");
      await expect(bar).toBeVisible();
      const text = await box(bar.locator("[data-summary-text]"));
      const results = bar.getByRole("link", { name: t.previewResultsLink });
      const chevron = bar.getByRole("button", { name: t.previewHeading });
      for (const control of [results, chevron]) {
        const b = await box(control);
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(320.5);
        expect(b.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
      }
      expect(await noOverflow(page)).toBe(true);
      expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
  }

  for (const locale of ["en", "ar"] as const) {
    test(`bar and toast at 375x800 in ${locale}: the toast floats above the bar and the padding is bar + 8 + toast`, async ({ page, api }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      const kase = start();
      await open(page, api, locale, kase);
      api.set({ getPreview: async (route) => { await new Promise((resolve) => setTimeout(resolve, 20_000)); try { await json(200, agree.response)(route); } catch {} }, postHeir: json(201, { case: added(kase) }) });
      await page.locator('[data-focus="add:son"]').click();
      const toast = page.locator("[data-undo-toast]");
      const bar = page.locator("[data-summary-bar]");
      await expect(toast).toHaveAttribute("data-toast-placement", "float");
      const t = await box(toast), b = await box(bar);
      expect(t.y + t.height).toBeLessThanOrEqual(b.y + 0.5);
      expect(b.y - (t.y + t.height)).toBeCloseTo(8, 0);
      await expect.poll(() => scrollPadding(page)).toBeCloseTo(b.height + 8 + t.height, 0);
      expect(await scrollPadding(page)).toBeLessThanOrEqual(0.25 * 800 + 1);
      expect(await variable(page)).toBeCloseTo(await scrollPadding(page), 0);
      // Tab to the last Heirs row control: the browser scrolls it clear of both the bar and the floating toast.
      const rowControls = page.locator('ul[aria-label] [data-focus^="editHeir:"]');
      const lastRow = rowControls.last();
      // Reduced motion turns smooth scrolling off, so the focus scroll lands at once and the check is not timing-bound.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await lastRow.scrollIntoViewIfNeeded();
      await page.locator('[data-focus="list"]').focus();
      for (let step = 0; step < 80 && !(await lastRow.evaluate((el) => el === document.activeElement)); step += 1) await page.keyboard.press("Tab");
      await expect(lastRow).toBeFocused();
      // The page scrolls smoothly in normal motion; wait for the scroll to settle clear of both surfaces.
      await expect.poll(async () => {
        const row = await box(lastRow);
        return row.y + row.height <= (await box(toast)).y + 1 && row.y + row.height <= (await box(bar)).y + 1;
      }).toBe(true);
      // The end of the page is padded by the obstruction, so the last content can scroll clear of both.
      const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("[data-js-only]")!).paddingBlockEnd));
      expect(padding).toBeCloseTo(await scrollPadding(page), 0);
    });
  }

  test("too tall at 320x400 with text spacing: the toast stays in the flow and the padding is the bar", async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 400 });
    const kase = start();
    await open(page, api, "en", kase);
    await page.addStyleTag({ content: spacing });
    api.set({ getPreview: async (route) => { await new Promise((resolve) => setTimeout(resolve, 20_000)); try { await json(200, agree.response)(route); } catch {} }, postHeir: json(201, { case: added(kase) }) });
    await page.locator('[data-focus="add:son"]').click({ force: true });
    const toast = page.locator("[data-undo-toast]");
    await expect(toast).toHaveAttribute("data-toast-placement", "flow");
    const bar = await box(page.locator("[data-summary-bar]"));
    await expect.poll(() => scrollPadding(page)).toBeCloseTo(Math.min(bar.height, 100), 0);
    api.set({ postRestore: json(200, { case: stamp(kase, 7) }) });
    await toast.getByRole("button", { name: en.undoAction, exact: true }).click({ force: true });
    expect(api.restorePosts).toHaveLength(1);
  });

  for (const size of [{ width: 800, height: 400 }, { width: 320, height: 200 }]) for (const locale of ["en", "ar"] as const) {
    test(`compact landscape ${size.width}x${size.height} in ${locale}: no bar, an in-flow button opens the sheet and Escape returns focus`, async ({ page, api }) => {
      await page.setViewportSize(size);
      await open(page, api, locale);
      const t = messages[locale].interview;
      await expect(page.locator("[data-summary-bar]")).toHaveCount(0);
      const button = page.locator("[data-summary-open]");
      await expect(button).toHaveText(t.previewHeading);
      expect((await box(button)).height).toBeGreaterThanOrEqual(44);
      expect(await variable(page)).toBeCloseTo(0, 0);
      await button.click();
      const sheet = sheetOf(page);
      await expect(sheet.locator("h2#preview-heading")).toBeFocused();
      expect((await box(sheet)).height).toBeLessThanOrEqual(size.height * 0.78 + 1);
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(button).toBeFocused();
    });
  }

  test("rotating with the chevron focused moves focus to the in-flow button and back; an open sheet stays open", async ({ page, api }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await open(page, api, "en");
    await page.locator("[data-summary-expand]").focus();
    await page.setViewportSize({ width: 800, height: 400 });
    await expect(page.locator("[data-summary-open]")).toBeFocused();
    await page.setViewportSize({ width: 400, height: 800 });
    await expect(page.locator("[data-summary-expand]")).toBeFocused();
    const previews = api.previewGets;
    await openPreview(page);
    const rows = await sheetOf(page).locator("ul > li").count();
    await page.setViewportSize({ width: 800, height: 400 });
    await expect(sheetOf(page)).toBeVisible();
    expect(await sheetOf(page).locator("ul > li").count()).toBe(rows);
    await closePreview(page);
    await expect(page.locator("[data-summary-open]")).toBeFocused();
    expect(api.previewGets).toBe(previews);
  });

  test("crossing 1366, 900, 600, 375 and 320 wide with the sheet open keeps it open with the same revision", async ({ page, api }) => {
    await page.setViewportSize({ width: 1366, height: 800 });
    await open(page, api, "en");
    await openPreview(page);
    const revision = await page.locator("[data-preview-revision]").getAttribute("data-preview-revision");
    const previews = api.previewGets;
    for (const width of [900, 600, 375, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(sheetOf(page)).toBeVisible();
      await expect(page.locator("[data-preview-revision]")).toHaveAttribute("data-preview-revision", revision ?? "");
    }
    expect(api.previewGets).toBe(previews);
  });

  test.describe("reduce", () => {
    test.use({ reducedMotion: "reduce" });
    test("the in-flow button and the bar still open and close the sheet", async ({ page, api }) => {
      await page.setViewportSize({ width: 800, height: 400 });
      await open(page, api, "en");
      await openPreviewAnywhere(page);
      await closePreview(page);
      await page.setViewportSize({ width: 375, height: 800 });
      await openPreviewAnywhere(page);
      await closePreview(page);
    });
  });
});

for (const locale of locales) {
  const text = messages[locale].interview;
  const joint = { en: /Jointly owned.*named beneficiary/, ar: /بالاشتراك.*مستفيد/, fr: /détenus en commun.*bénéficiaire désigné/ }[locale];
  test(`Story 11.6: the estate hint covers joint and beneficiary assets, before and after an invalid amount in ${locale}`, async ({ page, api }) => {
    await openHeirsScreen(page, api, locale);
    await page.getByRole("button", { name: text.deceasedEdit }).click();
    const estate = page.getByLabel(text.estateLabel);
    const hint = page.locator("#deceased-estate-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(joint);
    await expect(estate).toHaveAccessibleDescription(joint);
    await estate.fill("12.345");
    await estate.blur();
    await expect(page.locator("#deceased-estate-error")).not.toBeEmpty();
    await expect(hint).toBeVisible();
    await expect(estate).toHaveAccessibleDescription(joint);
  });
}
