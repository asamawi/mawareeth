import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { messages } from "../src/i18n/messages";
import { openCanvasFixture, openHeirsScreen } from "./family";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, fullCase, json, noCase, sessionAnonymous, startedCase, test } from "./api";

const agree = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[] })
  .fixtures.find((item) => item.title === "Agree: wife, son and daughter in every school")!;

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe("axe", () => {
  for (const locale of ["ar", "en"] as const) {
    test(`landing /${locale}/ has no serious or critical violations`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous });
      await page.goto(`/${locale}/`);
      await expect(page.getByRole("link", { name: messages[locale].nav.login })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });

    test(`started interview screen /${locale}/ has no serious or critical violations`, async ({ page, api }) => {
      api.set({ session: sessionAnonymous, getCase: noCase, postCase: startedCase() });
      await page.goto(`/${locale}/interview/`);
      await expect(page.getByRole("heading", { name: messages[locale].interview.started })).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });

    test(`edit surface in ${locale} has no serious or critical violations`, async ({ page, api }) => {
      await page.setViewportSize({ width: locale === "ar" ? 375 : 1280, height: 800 });
      await openHeirsScreen(page, api, locale);
      await page.locator('[data-state="normal"]').first().click();
      await expect(page.locator("[data-edit-sheet] input[name='edit-status']").first()).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });

    for (const scheme of ["light", "dark"] as const) {
      test(`heirs screen /${locale}/ in ${scheme} mode has no serious or critical violations`, async ({ page, api }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openHeirsScreen(page, api, locale);
        expect(await serious(page)).toEqual([]);
      });
    }
  }
});

for (const locale of ["en", "ar"] as const) for (const kind of ["lineage", "empty"] as const) {
  test(`${kind} canvas in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    await openCanvasFixture(page, api, locale, kind);
    expect(await serious(page)).toEqual([]);
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`undo controls and toast in ${locale} have no serious or critical axe violations`, async ({ page, api }) => {
    const kase = fullCase(agree.case, { revision: 5, snapshot: { at: 5 } }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const options = { blocked: [], invalid: {} };
    const returned = { ...kase, revision: 6, snapshot: { at: 6 }, heirs: [...kase.heirs, { id: "new-son", relationship: "son", gender: "male", name: null, edit_options: options }] };
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: json(200, agree.response),
      postHeir: json(201, { case: returned }),
    });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor();
    await page.locator("[data-focus='add:son']").click();
    await expect(page.locator("[data-undo-toast]")).toBeVisible();
    await expect(page.getByRole("button", { name: messages[locale].interview.undoLastChange, exact: true })).toHaveCount(2);
    expect(await serious(page)).toEqual([]);
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`the expanded Add relative here chooser in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    const kase = fullCase(agree.case) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const entry = (relationship: string, link: string, gender: string) => ({ relationship, link, blocked: false, gender });
    kase.placement = { root: [entry("father", "parent", "male"), entry("son", "child", "male")], h2: [entry("son_of_son", "child", "male"), { ...entry("daughter_of_son", "child", "female"), blocked: true }] };
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, agree.response) });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("section[data-tree] [data-tree-area]").waitFor();
    await page.locator('[data-node="h2"]').focus();
    await page.locator("[data-add-row]").getByRole("button", { name: messages[locale].interview.addRelativeHere }).click();
    await expect(page.locator("[data-add-row] [role='group']")).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });
}
