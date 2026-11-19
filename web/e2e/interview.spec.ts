import type { Page } from "@playwright/test";

import { messages, locales, directionOf } from "../src/i18n/messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { openCanvasFixture, openHeirsScreen } from "./family";
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
    await expect(page.getByText(en.fieldErrors.heirs.limit)).toBeVisible();
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
      const grid = document.querySelector("section[aria-labelledby='add-relatives-heading']")!.closest("[data-wide]")!.getBoundingClientRect();
      return grid.top - crumb.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
    const precedes = await page.evaluate(() => {
      const crumb = document.querySelector("nav[data-focus='breadcrumb']")!;
      const form = document.querySelector("section[aria-labelledby='add-relatives-heading']")!;
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
      await expect(page.locator("#heirs-heading").locator("..")).toContainText(t.treeNoShare);
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
      await expect(group.locator("button")).toHaveCount(1);
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
});
