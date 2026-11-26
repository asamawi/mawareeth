import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { directionOf, messages } from "../src/i18n/messages";
import { expect, fullCase, json, sessionAuthenticated, test, type Api } from "./api";

const agree = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[] })
  .fixtures.find((item) => item.title === "Agree: wife, son and daughter in every school")!;
const served = JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-presented-fixtures.json"), "utf8")) as { presented: Record<string, unknown> };
const agreeResponse = { ...agree.response, presented: served.presented[agree.title] };

const SUGGESTION = "Estate of the deceased, 1 January 2026";

function stubResults(api: Api, extra: Parameters<Api["set"]>[0] = {}) {
  api.set({
    session: sessionAuthenticated,
    getCase: json(200, { case: fullCase(agree.case) }),
    getPreview: json(200, agreeResponse),
    getNameSuggestion: json(200, { name: SUGGESTION }),
    getInvites: json(200, { invites: [] }),
    ...extra,
  });
}

/** A save that stores and answers with the submitted name, as the server does, and remembers it for My cases. */
function echoSave(stored: { name: string }) {
  return (route: Route) => {
    const sent = JSON.parse(route.request().postData() ?? "{}") as { name?: string };
    stored.name = sent.name || SUGGESTION;
    return json(201, { id: 42, name: stored.name, updated_at: "2026-11-26T00:00:00Z", revision: 1 })(route);
  };
}

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

for (const locale of ["en", "ar"] as const) {
  const text = messages[locale].results;
  const saveButton = (page: Page) => page.getByRole("button", { name: text.save, exact: true });
  const dialog = (page: Page) => page.locator("dialog[open]");
  const nameField = (page: Page) => dialog(page).getByLabel(text.nameLabel);
  const status = (page: Page) => page.getByRole("status").filter({ hasText: /\S/ });

  test.describe(`Name a Case and Save in ${locale}`, () => {
    test("the first Save asks for a name by keyboard, in order, and Escape returns focus to Save", async ({ page, api }) => {
      stubResults(api);
      await page.goto(`/${locale}/results/`);
      await saveButton(page).focus();
      await page.keyboard.press("Enter");
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toHaveAttribute("dir", directionOf(locale));
      await expect(nameField(page)).toBeFocused();
      await expect(nameField(page)).toHaveValue(SUGGESTION);
      await expect(nameField(page)).toHaveAttribute("dir", "auto");
      await expect(dialog(page)).toContainText(text.nameCounter.replace("{count}", String([...SUGGESTION].length)));
      const box = await nameField(page).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press("Tab");
      await expect(dialog(page).getByRole("button", { name: text.nameSubmit, exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog(page).getByRole("button", { name: text.nameCancel, exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
      await expect(saveButton(page)).toBeFocused();
      expect(api.savedPosts).toEqual([]);
    });

    test("an edited name is sent trimmed and the status reads Saved to My cases", async ({ page, api }) => {
      const stored = { name: "" };
      stubResults(api, {
        postSaved: echoSave(stored),
        getSavedCases: (route) => json(200, { cases: [{ id: 42, name: stored.name, updated_at: "2026-11-26T00:00:00Z", madhab: "hanafi", heir_count: 3, status: "draft" }] })(route),
        getReceived: json(200, { received: [] }),
      });
      await page.goto(`/${locale}/results/`);
      await saveButton(page).click();
      await nameField(page).fill("  Mother's estate ");
      await page.keyboard.press("Enter");
      await expect(status(page)).toHaveText(text.saved);
      expect(JSON.parse(api.savedPosts[0].body)).toEqual({ case_id: expect.any(String), name: "Mother's estate" });
      expect(stored.name).toBe("Mother's estate");
      await expect(dialog(page)).toHaveCount(0);
      // My cases lists the case under the stored name.
      await page.goto(`/${locale}/cases/`);
      await expect(page.locator("li bdi")).toHaveText("Mother's estate");
    });

    test("a name of 101 characters is blocked and 100 is accepted", async ({ page, api }) => {
      const stored = { name: "" };
      stubResults(api, { postSaved: echoSave(stored) });
      await page.goto(`/${locale}/results/`);
      await saveButton(page).click();
      await nameField(page).fill("مَ".repeat(101));
      await expect(dialog(page)).toContainText(text.nameTooLong);
      // aria-disabled, not disabled: the button stays focusable, and a click does nothing.
      await dialog(page).getByRole("button", { name: text.nameSubmit, exact: true }).click({ force: true });
      await expect(dialog(page)).toBeVisible();
      expect(api.savedPosts).toEqual([]);
      await nameField(page).fill("مَ".repeat(100));
      await expect(dialog(page)).toContainText(text.nameCounter.replace("{count}", "100"));
      await dialog(page).getByRole("button", { name: text.nameSubmit, exact: true }).click();
      await expect(status(page)).toHaveText(text.saved);
      expect(stored.name).toBe("\u0645\u064e".repeat(100));
      expect(JSON.parse(api.savedPosts[0].body).name).toBe("\u0645\u064e".repeat(100));
    });

    test("a failure keeps the family and the typed name, and Retry resends it", async ({ page, api }) => {
      let attempts = 0;
      stubResults(api, {
        postSaved: (route) => {
          attempts += 1;
          return attempts === 1 ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" }) : json(201, { id: 42, name: "Mine", updated_at: "2026-11-26T00:00:00Z", revision: 1 })(route);
        },
      });
      await page.goto(`/${locale}/results/`);
      await saveButton(page).click();
      await nameField(page).fill("Mine");
      await page.keyboard.press("Enter");
      await expect(status(page)).toHaveText(text.saveError);
      await page.getByRole("button", { name: text.saveRetry, exact: true }).click();
      await expect(status(page)).toHaveText(text.saved);
      expect(api.savedPosts.map((post) => JSON.parse(post.body).name)).toEqual(["Mine", "Mine"]);
    });

    test("a conflict has its own message, no Retry and no Saved", async ({ page, api }) => {
      stubResults(api, {
        getCase: json(200, { case: fullCase(agree.case, { saved: { revision: 1 } }) }),
        postSaved: json(409, { error: "conflict", code: "saved_case_conflict", detail: "changed", revision: 2 }),
      });
      await page.goto(`/${locale}/results/`);
      await saveButton(page).click();
      await expect(status(page)).toHaveText(text.saveConflict);
      await expect(page.getByRole("button", { name: text.saveRetry, exact: true })).toHaveCount(0);
      expect(JSON.parse(api.savedPosts[0].body)).toEqual({ case_id: expect.any(String) });
    });

    const CONFLICT = { error: "conflict", code: "saved_case_conflict", detail: "changed", revision: 4, saved_id: 42, saved_name: "Mother's estate", working_case_id: agree.case.id, working_revision: 1 };
    const openLatest = (page: Page) => page.getByRole("button", { name: text.conflictOpenLatest, exact: true });
    const saveAsNew = (page: Page) => page.getByRole("button", { name: text.conflictSaveAsNew, exact: true });
    const conflicted = { getCase: json(200, { case: fullCase(agree.case, { saved: { revision: 1 } }) }), postSaved: json(409, CONFLICT) };

    test("a conflict offers two choices and Open latest version loads the stored case", async ({ page, api }) => {
      let opened = false;
      const base = fullCase(agree.case);
      const heirs = base.heirs as Record<string, unknown>[];
      const latest = { ...base, heirs: [{ ...heirs[0], name: "Latest Heir" }, ...heirs.slice(1)] };
      stubResults(api, {
        getCase: (route) => json(200, { case: opened ? { ...latest, saved: { revision: 4 } } : fullCase(agree.case, { saved: { revision: 1 } }) })(route),
        postSaved: json(409, CONFLICT),
        postOpen: (route) => { opened = true; return json(200, { case: fullCase(agree.case, { saved: { revision: 4 } }) })(route); },
      });
      await page.goto(`/${locale}/results/`);
      await saveButton(page).click();
      await expect(status(page)).toHaveText(text.saveConflict);
      await expect(openLatest(page)).toBeVisible();
      await expect(saveAsNew(page)).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await openLatest(page).click();
      await expect(openLatest(page)).toHaveCount(0);
      await expect(page.getByText("Latest Heir").first()).toBeVisible();
      await expect(saveButton(page)).toBeEnabled();
      expect(api.openPosts).toEqual([{ url: "/api/v1/saved-cases/42/open/", body: JSON.stringify({ case_id: agree.case.id, expected_revision: 1 }) }]);
      expect(api.createPosts).toEqual([]);
      expect(page.url()).not.toContain("resume=");
    });

    test("Save as a new case names the copy and links the working copy to it", async ({ page, api }) => {
      stubResults(api, { ...conflicted, postCreate: json(201, { id: 43, name: "Copy", updated_at: "2026-11-26T00:00:00Z", revision: 1 }) });
      await page.goto(`/${locale}/results/`);
      await saveButton(page).click();
      await saveAsNew(page).click();
      await expect(nameField(page)).toHaveValue(text.copyName.replace("{name}", "Mother's estate"));
      await nameField(page).fill("Copy");
      await page.keyboard.press("Enter");
      await expect(status(page)).toHaveText(text.saved);
      expect(JSON.parse(api.createPosts[0].body)).toEqual({ case_id: agree.case.id, expected_revision: 1, saved_id: 42, saved_revision: 4, request_key: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "Copy" });
      await expect(openLatest(page)).toHaveCount(0);
      await expect(saveButton(page)).toBeEnabled();
    });

    for (const scheme of ["light", "dark"] as const) {
      test(`the naming dialog has no serious or critical axe violation in ${scheme} mode`, async ({ page, api }) => {
        await page.emulateMedia({ colorScheme: scheme });
        stubResults(api);
        await page.goto(`/${locale}/results/`);
        await saveButton(page).click();
        await expect(nameField(page)).toHaveValue(SUGGESTION);
        expect(await serious(page)).toEqual([]);
      });
    }
  });
}
