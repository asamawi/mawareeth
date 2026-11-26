import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { messages } from "../src/i18n/messages";
import { expect, fullCase, json, noCase, sessionAnonymous, sessionAuthenticated, test } from "./api";

type Fixture = { title: string; case: Record<string, unknown>; response: Record<string, unknown> };
const contracts = join(process.cwd(), "..", "api", "contracts");
const fixtures = (JSON.parse(readFileSync(join(contracts, "preview-fixtures.json"), "utf8")) as { fixtures: Fixture[] }).fixtures;
const presented = (JSON.parse(readFileSync(join(contracts, "preview-presented-fixtures.json"), "utf8")) as { presented: Record<string, unknown> }).presented;
const school = fixtures.find((item) => item.title === "Grandfather and brother under Hanafi")!;
const schoolResponse = { ...school.response, presented: presented[school.title] };

const HEIR = "Amina Fixture";
const named = () => {
  const heirs = (school.case.heirs as Record<string, unknown>[]).map((heir, index) => (index === 0 ? { ...heir, name: HEIR } : heir));
  return fullCase({ ...school.case, heirs });
};
const shared = { status: "draft", visibility: "private", case: named(), preview: schoolResponse };

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

for (const locale of ["en", "ar"] as const) {
  const text = messages[locale].shared;

  test.describe(`Shared and received views in ${locale}`, () => {
    test("a shared School case shows the read-only banner first and no edit controls", async ({ page, api }) => {
      await page.emulateMedia({ colorScheme: "light" });
      api.set({ session: sessionAnonymous, postShareView: json(200, shared) });
      await page.goto(`/${locale}/shared/#tok123`);
      const banner = page.locator("[data-component=shared-case-banner]");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(text.readOnly);
      await expect(banner).toContainText(text.banner);
      await expect(page.locator("main [role=note]").first()).toHaveAttribute("data-component", "shared-case-banner");
      await expect(page.locator("section[aria-labelledby=results-family]")).toContainText(HEIR);
      await expect(page.locator("main")).toContainText(messages[locale].results.school.split("{school}").join("Hanafi"));
      await expect(banner).toHaveClass(/bg-accent-soft/);
      await expect(banner).toHaveClass(/rounded-node/);
      const css = await banner.evaluate((node) => {
        const style = getComputedStyle(node);
        return { border: style.borderTopWidth, padding: style.paddingTop, background: style.backgroundColor };
      });
      const accent = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      const edge = await banner.evaluate((node) => ({ color: getComputedStyle(node).borderTopColor, radius: getComputedStyle(node).borderTopLeftRadius }));
      expect(edge.color).toBe(accent);
      expect(edge.radius).toBe("10px");
      expect(css.border).toBe("1px");
      expect(css.padding).toBe("12px");
      expect(css.background).not.toBe("rgba(0, 0, 0, 0)");
      for (const name of [messages[locale].results.save, messages[locale].results.shareAction, messages[locale].results.whatsappAction, messages[locale].cases.open]) {
        await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
      expect(await serious(page)).toEqual([]);
      expect(JSON.parse(api.shareViewPosts[0])).toEqual({ token: "tok123" });
    });

    test("an unavailable link shows only the unavailable text and no family", async ({ page, api }) => {
      api.set({ session: sessionAnonymous, postShareView: json(404, { detail: "Not found." }) });
      await page.goto(`/${locale}/shared/#gone`);
      await expect(page.getByRole("alert").filter({ hasText: text.unavailable })).toBeVisible();
      await expect(page.locator("[data-component=shared-case-banner]")).toHaveCount(0);
      await expect(page.locator("#results-family")).toHaveCount(0);
    });

    test("a private link for a guest asks to sign in and shows no family", async ({ page, api }) => {
      api.set({ session: sessionAnonymous, postShareView: json(403, { detail: "Authentication credentials were not provided.", code: "sign_in_required" }) });
      await page.goto(`/${locale}/shared/#private`);
      await expect(page.getByRole("main").getByRole("link", { name: text.signIn })).toBeVisible();
      await expect(page.getByRole("main").getByRole("link", { name: text.createAccount })).toBeVisible();
      await expect(page.locator("#results-family")).toHaveCount(0);
    });

    test("My cases View draft opens the received view read-only", async ({ page, api }) => {
      api.set({
        session: sessionAuthenticated,
        getCase: noCase,
        getSavedCases: json(200, { cases: [] }),
        getReceived: json(200, { received: [{ id: 9, owner: "Case Owner", updated_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" }] }),
        postReceivedView: json(200, { status: "draft", owner: "Case Owner", case: named(), preview: schoolResponse }),
      });
      await page.goto(`/${locale}/cases/`);
      await page.locator('a[href$="/received/#9"]').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/received/#9$`));
      await expect(page.locator("#results-family")).toBeVisible();
      await expect(page.getByRole("button", { name: messages[locale].results.save, exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: messages[locale].results.shareAction, exact: true })).toHaveCount(0);
    });

    test("accepting an invite redirects to the received view", async ({ page, api }) => {
      api.set({
        session: sessionAuthenticated,
        postInviteAccept: json(200, { id: 9 }),
        postReceivedView: json(200, { status: "draft", owner: "Case Owner", case: named(), preview: schoolResponse }),
      });
      await page.goto(`/${locale}/invite/#invtok`);
      await page.getByRole("button", { name: messages[locale].invites.accept }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/received/#9$`));
      await expect(page.locator("#results-family")).toBeVisible();
      expect(JSON.parse(api.inviteAcceptPosts[0])).toEqual({ token: "invtok" });
    });
  });
}
