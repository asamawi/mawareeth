import type { Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parsePresentedResult } from "../src/contracts/presented";
import { parsePreview } from "../src/api/case";
import { messages } from "../src/i18n/messages";
import { fullCase, json, sessionAnonymous, type Api } from "./api";

type Fixture = { title: string; case: Record<string, unknown>; response: Record<string, unknown> };
const contracts = join(process.cwd(), "..", "api", "contracts");
const served = JSON.parse(readFileSync(join(contracts, "preview-presented-fixtures.json"), "utf8")) as {
  presented: Record<string, unknown>;
};
const agree = (JSON.parse(readFileSync(join(contracts, "preview-fixtures.json"), "utf8")) as { fixtures: Fixture[] }).fixtures.find(
  (item) => item.title === "Agree: wife, son and daughter in every school",
)!;

/** Opens the heirs screen: a saved deceased with heirs, resumed from an existing case. */
export async function openHeirsScreen(page: Page, api: Api, locale: "en" | "ar" | "fr"): Promise<void> {
  api.set({
    session: sessionAnonymous,
    getCase: json(200, { case: fullCase(agree.case) }),
    getPreview: json(200, { ...agree.response, presented: served.presented[agree.title] }),
  });
  await page.goto(`/${locale}/interview/`);
  await page.getByRole("button", { name: messages[locale].interview.resume }).click();
  await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor();
  // The accepted calculation is on the root's signal; the summary bar and sheet (story 11.3) draw from it.
  await page.locator("[data-preview-state='ready']").waitFor();
}

/** The Share preview's modal sheet (the only place its body is drawn). */
export const sheetOf = (page: Page): Locator => page.locator("dialog[data-summary-sheet]");

/** Opens the Share preview sheet from the summary bar's chevron and waits for its heading. */
export async function openPreview(page: Page): Promise<Locator> {
  await page.locator("[data-summary-expand]").click();
  const sheet = sheetOf(page);
  await sheet.locator("h2#preview-heading").waitFor();
  return sheet;
}

/** Closes the sheet with its Close button; focus returns to the chevron. */
export async function closePreview(page: Page, locale: "en" | "ar" | "fr" = "en"): Promise<void> {
  await sheetOf(page).getByRole("button", { name: messages[locale].interview.editClose, exact: true }).click();
  await sheetOf(page).waitFor({ state: "hidden" });
}

/** Shared lineage and blocked-evidence fixture, validated by the production readers. */
export function lineageFixture() {
  const fixtures = (JSON.parse(readFileSync(join(contracts, "preview-fixtures.json"), "utf8")) as { fixtures: Fixture[] }).fixtures;
  const layered = structuredClone(fixtures.find(f => f.title === "Layered three under hanafi")!);
  const blocked = parsePresentedResult(served.presented["Grandfather and brother under Hanafi"]);
  const presented = parsePresentedResult(served.presented[layered.title]);
  const evidence = blocked.evidence[0].heirs.find(h => h.rule.code === "blocked")!;
  presented.evidence[0].heirs = presented.evidence[0].heirs.map(h => h.person === "s2" ? { ...structuredClone(evidence), person: "s2" } : h);
  const grandchild = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(grandchild); return; }
    const row = value as Record<string, unknown>;
    if ((row.id === "s2" || row.heir === "s2") && row.relationship === "son") row.relationship = "son_of_son";
    Object.values(row).forEach(grandchild);
  };
  grandchild(layered.case); grandchild(layered.response); grandchild(presented);
  parsePresentedResult(presented);
  const response = { ...layered.response, presented };
  if (!parsePreview(response)) throw new Error("Lineage preview fixture failed parsePreview");
  const options = { blocked: [], invalid: {} };
  const deaths = (layered.case.deaths as Record<string, unknown>[]).map(d => ({ ...d, heir_options: options, heirs: (d.heirs as Record<string, unknown>[]).map(h => ({ ...h, edit_options: options })) }));
  return { kase: fullCase(layered.case, {
    deaths,
    persons: [
      { id: "before", relationship: "son", gender: "male", name: null, status: "died_before_or_with", death_order: null },
      { id: "s2", relationship: "son_of_son", gender: "male", name: null, status: "alive", death_order: null },
    ],
    edges: [{ kind: "parent_of", from: "before", to: "s2" }], placement: {},
  }), response };
}
export async function openCanvasFixture(page: Page, api: Api, locale: "en" | "ar" | "fr", kind: "lineage" | "empty" | "many" = "lineage") {
  const fixture = lineageFixture();
  const options = { blocked: [], invalid: {} };
  const kase = kind === "lineage" ? fixture.kase : fullCase(agree.case, {
    deaths: [],
    heirs: kind === "empty" ? [] : Array.from({ length: 50 }, (_, i) => ({ id: `many${i}`, relationship: "son", gender: "male", name: null, edit_options: options })),
    placement: { root: [{ relationship: "father", link: "parent", blocked: false }, { relationship: "wife", link: "spouse", blocked: false }] },
  });
  api.set({ session: sessionAnonymous, getCase: json(200, { case: kase }), getPreview: json(200, kind === "lineage" ? fixture.response : { status: "not_ready" }) });
  await page.goto(`/${locale}/interview/`);
  await page.getByRole("button", { name: messages[locale].interview.resume }).click();
  await page.locator("section[data-tree] [data-tree-area]").waitFor();
  if (kind === "lineage") await page.locator('[data-node="s2"][data-state="blocked"]').waitFor();
}
