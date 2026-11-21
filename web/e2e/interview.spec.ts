import type { Page } from "@playwright/test";

import { messages, locales, directionOf } from "../src/i18n/messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lineageFixture, openCanvasFixture, openHeirsScreen } from "./family";
import { abort, expect, fullCase, json, liveCase, noCase, sessionAnonymous, startedCase, test, watchErrors, type Stubs } from "./api";

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
    const add = page.getByRole("button", { name: "Add Son", exact: true });
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
    const preview = page.locator("section[aria-labelledby='preview-heading']");
    await expect(preview.getByText("7/8", { exact: true })).toBeVisible();
    const more = page.getByRole("button", { name: "One more Daughter", exact: true });
    const count = page.getByLabel("Number of Daughter to add", { exact: true });
    const list = page.locator("section[aria-labelledby='heirs-heading']");
    for (let press = 0; press < 3; press++) await more.click();
    await expect(count).toHaveText("4");
    await expect(list.getByRole("status")).toBeEmpty();
    expect(api.bulkPosts).toHaveLength(0);
    const add = page.getByRole("button", { name: "Add Daughter", exact: true });
    await expect(add).toHaveAccessibleDescription(/\b4$/);
    await add.click();
    await expect(list.getByRole("status")).toHaveText("4 × Daughter added.");
    for (const [index, daughter] of daughters.entries()) {
      const label = `Daughter ${index + 1}`;
      await expect(list.getByText(label, { exact: true }).first()).toBeVisible();
      await expect(page.locator(`[data-node="${daughter.id}"]`)).toContainText(label);
    }
    await expect(preview.getByRole("listitem").filter({ hasText: "Daughter 4" }).getByText("7/48", { exact: true })).toBeVisible();
    await expect(preview.getByText("7/8", { exact: true })).toHaveCount(0);
    await expect(count).toHaveText("1");
    await expect(add).toBeFocused();
    expect(api.bulkPosts).toHaveLength(1);
    expect(JSON.parse(api.bulkPosts[0].body)).toEqual({
      case_id: kase.id, expected_revision: kase.revision,
      heirs: Array(4).fill({ relationship: "daughter", name: null }),
    });
    expect(api.heirPosts).toHaveLength(0);
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
    expect(JSON.parse(api.restorePosts[0].body)).toEqual({
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
    expect(api.restorePosts.map((post) => JSON.parse(post.body).snapshot)).toEqual([one.snapshot, kase.snapshot]);
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
    expect(JSON.parse(api.restorePosts[0].body)).toEqual({ case_id: kase.id, expected_revision: 6, snapshot: kase.snapshot });
    await expect(page.locator("[data-focus='card:b']")).toBeFocused();
    await expect(page.locator("section[aria-labelledby='heirs-heading'] [role='status']")).toHaveText(en.undoDone);
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
    // Read both tops in one frame: the page may still be finishing its smooth focus scroll.
    const tops = await page.evaluate(() => ["section[data-tree]", "section[aria-labelledby='preview-heading']"].map((s) => document.querySelector(s)!.getBoundingClientRect().y));
    expect(Math.abs(tops[1] - tops[0])).toBeLessThan(2);
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
    const preview = page.locator("section[aria-labelledby='preview-heading']");
    await expect(preview).toBeVisible();
    const card = page.locator('[data-node="s1"]');
    await card.focus();
    await card.press("Enter");
    const heading = page.locator("[data-focus='treeHeading']");
    await expect(heading).toBeFocused();
    await expect(heading).toContainText(en.deathSecond);
    const nav = page.getByRole("navigation", { name: en.estateLevel });
    await expect(nav.getByRole("link")).toHaveCount(1);
    await expect(nav.locator("[aria-current='page']")).toContainText(en.deathSecond);
    await expect(preview).toBeHidden();
    await expect(page.locator("#preview-heading")).toBeHidden();
    // The first wife is the later deceased's mother here, never "Wife".
    const mother = page.locator('[data-node="r1"]');
    await expect(mother).toContainText(en.relationships.mother);
    await expect(mother).not.toContainText(en.relationships.wife);
    await nav.getByRole("link").click();
    await expect(heading).toBeFocused();
    await expect(heading).toHaveText(en.treeHeading);
    await expect(nav).toHaveCount(0);
    await expect(page.locator("section[aria-labelledby='preview-heading']")).toBeVisible();
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
      await expect(page.locator("section[aria-labelledby='heirs-heading'] [role='status']")).toHaveText(t.treeZoomStatus.replace("{percent}", new Intl.NumberFormat(locale, { style: "percent" }).format(1.25)));
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
      // Matrix "empty estate": the preview shows its prompt and no share rows.
      const preview = page.locator("section[aria-labelledby='preview-heading']");
      await expect(preview).toContainText(t.previewPrompt);
      await expect(preview.locator("ul li, table")).toHaveCount(0);
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
      await canvas.evaluate(el => { el.scrollTop = el.scrollHeight; });
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
      const status = page.locator("section[aria-labelledby='heirs-heading'] [role='status']");
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
      const status = page.locator("section[aria-labelledby='heirs-heading'] [role='status']");
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
    // Let the preview settle first: it shifts the layout, and so the chip.
    await page.locator("section[aria-labelledby='preview-heading']").locator("table, ul").first().waitFor();
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
