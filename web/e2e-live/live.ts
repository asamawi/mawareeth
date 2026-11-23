// Helpers for the local-only live project: the real Django API behind `next dev`.
import { expect, type Page } from "@playwright/test";

import { messages } from "../src/i18n/messages";

export type Locale = "en" | "ar";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The Case as the server holds it. */
export async function serverCase(page: Page): Promise<Row> {
  const response = await page.request.get("/api/v1/case/");
  expect(response.ok()).toBe(true);
  return (await response.json()).case;
}

/** Starts a Case in the browser: the deceased form, then the Add relatives screen. */
export async function startCase(page: Page, locale: Locale): Promise<void> {
  const t = messages[locale].interview;
  await page.goto(`/${locale}/interview/`);
  await page.getByRole("heading", { name: t.deceasedHeading }).waitFor();
  await page.getByLabel(t.genderMale, { exact: true }).check();
  await page.locator("#deceased-estate").fill("100000");
  await page.getByRole("button", { name: t.deceasedSave }).click();
  await page.locator("section[aria-labelledby='add-relatives-heading']").waitFor();
}

const treeIds = (page: Page) => page.locator("[data-tree-area] [data-node]:not([data-node='root'])")
  .evaluateAll(els => els.map(el => (el as HTMLElement).dataset.node!).sort());
const outlineIds = (page: Page) => page.locator("section[aria-labelledby='heirs-heading'] [data-focus^='editHeir:']")
  .evaluateAll(els => els.map(el => (el as HTMLElement).dataset.focus!.slice("editHeir:".length)).sort());

/**
 * After an accepted step the Family tree, the Heirs outline and the server's Case list the same
 * people, and (in the first estate) the Share preview is for the server's current revision.
 * `estate` is the open later estate's heir id, or null for the first estate.
 */
export async function expectInSync(page: Page, estate: string | null = null): Promise<Row> {
  let server: Row = {};
  await expect(async () => {
    server = await serverCase(page);
    const rows: Row[] = estate === null
      ? [...server.heirs, ...(server.persons as Row[]).filter(p => p.status === "died_before_or_with")]
      : server.deaths.find((d: Row) => d.heir_id === estate).heirs;
    const expected = rows.map(row => row.id as string).sort();
    expect(await treeIds(page)).toEqual(expected);
    expect(await outlineIds(page)).toEqual(expected);
    if (estate === null) {
      const root = page.locator("[data-js-only]");
      await expect(root).toHaveAttribute("data-preview-revision", String(server.revision));
      await expect(root).toHaveAttribute("data-preview-state", /^(ready|choose-school)$/);
    } else {
      await expect(page.locator("[data-summary-bar], dialog[data-summary-sheet]")).toHaveCount(0);
    }
  }).toPass({ timeout: 20_000 });
  return server;
}

/** One press of a relationship button in the Add relatives panel. */
export const add = (page: Page, relationship: string) => page.locator(`[data-focus='add:${relationship}']`).click();

/** Drags a relationship chip from the Add relatives panel onto a card and releases it. */
export async function dragChip(page: Page, relationship: string, onto: string): Promise<void> {
  await page.locator("[data-preview-state='ready'], [data-preview-state='choose-school']").first().waitFor();
  const chip = page.locator(`[data-focus='add:${relationship}']`);
  await expect(chip).toHaveAttribute("aria-disabled", "false");
  // hover() waits for the chip to hold still, so the press lands on it and not on a neighbour.
  await chip.hover();
  const from = (await chip.boundingBox())!;
  const target = (await page.locator(`[data-node="${onto}"]`).boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.up();
}

export const undoButton = (page: Page, locale: Locale) =>
  page.getByRole("button", { name: messages[locale].interview.undoLastChange, exact: true }).first();

/** A new person's shape in the server's Case: relationship, and who their parent edge joins (by id and relationship). */
export function shapeOf(before: Row, after: Row): { relationship: string; parentId: string | null; parentRelationship: string | null } {
  const known = new Set(before.heirs.map((h: Row) => h.id));
  const fresh = after.heirs.filter((h: Row) => !known.has(h.id));
  expect(fresh).toHaveLength(1);
  const edge = (after.edges as Row[]).find(e => e.kind === "parent_of" && e.to === fresh[0].id);
  const parent = edge ? after.heirs.find((h: Row) => h.id === edge.from) : null;
  return { relationship: fresh[0].relationship, parentId: edge ? edge.from : null, parentRelationship: parent ? parent.relationship : null };
}

/**
 * Marks a person as died later from their card's edit sheet and opens their own estate. The server may ask
 * who among the family is related to them first; the suggested answers are accepted.
 */
export async function openLaterEstate(page: Page, id: string): Promise<void> {
  const row = page.locator(`[data-node="${id}"]`);
  await row.focus();
  await row.press("Enter");
  await page.locator("[data-edit-sheet] [data-focus='editStatus:died_later']").click();
  const submit = page.locator("[data-edit-sheet] [data-focus='relativesSubmit']");
  const open = page.locator("[data-edit-sheet] [data-focus='openEstate']");
  await expect(submit.or(open)).toBeVisible();
  if (await submit.isVisible()) await submit.click();
  await open.click();
  await expect(page.locator("nav[data-breadcrumb]")).toBeVisible();
}
