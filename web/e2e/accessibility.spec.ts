import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { messages } from "../src/i18n/messages";
import { lineageFixture, openCanvasFixture, openFiftyHeirs, openHeirsScreen, openPreview, sheetOf } from "./family";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, fullCase, json, noCase, sessionAnonymous, startedCase, test } from "./api";

const agree = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[] })
  .fixtures.find((item) => item.title === "Agree: wife, son and daughter in every school")!;

const served = JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-presented-fixtures.json"), "utf8")) as { presented: Record<string, unknown> };
const agreeResponse = { ...agree.response, presented: served.presented[agree.title] };

async function serious(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

test.describe("axe", () => {
  for (const locale of ["ar", "en", "fr"] as const) {
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

for (const locale of ["en", "ar", "fr"] as const) for (const kind of ["lineage", "empty"] as const) {
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

for (const locale of ["en", "ar"] as const) {
  test(`an open later estate with the breadcrumb in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    const all = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[] }).fixtures;
    const layered = all.find((item) => item.title === "Agree layered: wife and two sons, a son dies")!;
    const served = JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-presented-fixtures.json"), "utf8")) as { presented: Record<string, unknown> };
    const options = { blocked: [], invalid: {} };
    const kase = fullCase(layered.case, {
      deaths: (layered.case.deaths as { heirs: Record<string, unknown>[] }[]).map((death) => ({
        ...death, heir_options: options, heirs: death.heirs.map((heir) => ({ ...heir, edit_options: options })),
      })),
    });
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, { ...layered.response, presented: served.presented[layered.title] }) });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("section[data-tree] [data-tree-area]").waitFor();
    await page.locator('[data-node="s1"]').press("Enter");
    await expect(page.locator("nav[data-breadcrumb]")).toBeVisible();
    await expect(page.locator("[data-focus='treeHeading']")).toBeFocused();
    expect(await serious(page)).toEqual([]);
  });
}

for (const locale of ["ar", "en", "fr"] as const) {
  test(`the removal confirmation in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openCanvasFixture(page, api, locale);
    api.set({ deleteHeir: json(409, { error: "cascade_unconfirmed", impact: { persons: [], estates: [2] }, case: lineageFixture().kase }) });
    await page.locator('[data-node="w"]').press("Delete");
    await expect(page.locator("[data-edit-sheet]").getByRole("button", { name: messages[locale].interview.heirRemoveNo })).toBeFocused();
    expect(await serious(page)).toEqual([]);
  });
}

for (const locale of ["en", "ar", "fr"] as const) {
  test(`the pending preview in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    const kase = fullCase(agree.case) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const options = { blocked: [], invalid: {} };
    const returned = { ...kase, revision: 2, heirs: [...kase.heirs, { id: "new-son", relationship: "son", gender: "male", name: null, edit_options: options }] };
    let added = false;
    api.set({
      session: sessionAnonymous,
      getCase: json(200, { case: kase }),
      getPreview: async (route) => {
        if (!added) return json(200, agreeResponse)(route);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try { await json(200, agreeResponse)(route); } catch {}
      },
      postHeir: (route) => { added = true; return json(201, { case: returned })(route); },
    });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor();
    await page.locator("[data-preview-state='ready']").waitFor();
    await page.locator("[data-focus='add:son']").click();
    await page.locator("[data-preview-state='pending']").waitFor();
    await openPreview(page);
    const section = sheetOf(page).locator("section[aria-labelledby='preview-heading']");
    await expect(section).toHaveAttribute("aria-busy", "true");
    await expect(section.locator("[data-slow]")).toBeVisible({ timeout: 5000 });
    expect(await serious(page)).toEqual([]);
  });

  test(`the open Share preview sheet in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, locale);
    await openPreview(page);
    await expect(sheetOf(page).locator("[data-notice='disclaimer']")).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });

  test(`the summary bar in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openHeirsScreen(page, api, locale);
    await expect(page.locator("[data-summary-bar]")).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the 320px bar with text spacing, then the open sheet, in ${locale} ${scheme} mode has no serious or critical axe violations`, async ({ page, api }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 320, height: 640 });
      await openHeirsScreen(page, api, locale);
      await page.addStyleTag({ content: "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }" });
      await expect(page.locator("[data-summary-bar]")).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await openPreview(page);
      expect(await serious(page)).toEqual([]);
    });
  }

  test(`the compact-landscape Share preview button in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    await page.setViewportSize({ width: 800, height: 400 });
    await openHeirsScreen(page, api, locale);
    await expect(page.locator("[data-summary-open]")).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });

  test(`the cold-load skeleton in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    api.set({
      session: sessionAnonymous,
      getCase: async (route) => { await new Promise((resolve) => setTimeout(resolve, 2500)); try { await json(200, { case: null })(route); } catch {} },
    });
    await page.goto(`/${locale}/interview/`);
    await expect(page.locator("[data-skeleton]")).toHaveAttribute("aria-busy", "true");
    expect(await serious(page)).toEqual([]);
  });
}

const spacing = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";

for (const locale of ["en", "ar"] as const) {
  test(`the lineage canvas at 320px with text spacing in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openCanvasFixture(page, api, locale);
    await page.addStyleTag({ content: spacing });
    expect(await serious(page)).toEqual([]);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the side edit panel at 1280px in ${locale} ${scheme} mode has no serious or critical axe violations`, async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await openCanvasFixture(page, api, locale);
      const card = page.locator('[data-node]:not([data-node="root"]):not([data-state="died_later"])').first();
      await card.focus();
      await card.press("Enter");
      await expect(page.locator("section[data-edit-sheet]")).toBeVisible();
      expect(await serious(page)).toEqual([]);
    });
  }
}

for (const locale of ["en", "ar"] as const) {
  test(`the Same person as field open in ${locale} has no serious or critical axe violations`, async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const layered = (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown> }[] })
      .fixtures.find((item) => item.title === "Agree layered: wife and two sons, a son dies")!;
    const options = { blocked: [], invalid: {} };
    const kase = fullCase(layered.case, {
      deaths: [{
        ...(layered.case.deaths as Record<string, unknown>[])[0], heir_options: options,
        heirs: [{ id: "r1", relationship: "mother", gender: "female", name: null, edit_options: options, link_candidates: ["w"] }],
      }],
    });
    api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, { status: "not_ready", revision: 1 }) });
    await page.goto(`/${locale}/interview/`);
    await page.getByRole("button", { name: messages[locale].interview.resume }).click();
    await page.locator("section[data-tree] [data-tree-area]").waitFor();
    await page.locator('[data-node="s1"]').press("Enter");
    await page.locator('[data-node="r1"]').press("Enter");
    await expect(page.locator("[data-edit-sheet] #edit-same-as")).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });
}

// Story 9.12: the full 50-Heir Case, with the summary bar showing its ready preview.
for (const locale of ["en", "ar"] as const) for (const width of [375, 1280]) for (const scheme of ["light", "dark"] as const) {
  test(`the 50-Heir Case at ${width}px in ${locale} ${scheme} mode has no serious or critical axe violations`, async ({ page, api }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await openFiftyHeirs(page, api, locale);
    await expect(page.locator("[data-summary-bar]")).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });
}
