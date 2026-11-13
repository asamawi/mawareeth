import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { messages } from "../src/i18n/messages";
import { expect, noCase, sessionAnonymous, startedCase, test } from "./api";

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
  }
});
