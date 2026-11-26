// Story 9.12: UJ-2 against the real API (local only; see playwright.config.ts, project `live`).
import { expect, test, type Page, type Request } from "@playwright/test";

import { messages } from "../src/i18n/messages";
import { add, dragChip, expectInSync, openLaterEstate, serverCase, shapeOf, startCase, undoButton, type Locale } from "./live";

const deletes = (page: Page) => {
  const seen: Request[] = [];
  page.on("request", request => { if (request.method() === "DELETE") seen.push(request); });
  return seen;
};

/** Adds a son, a wife and a daughter with button presses, then two more sons with the count stepper. */
async function buildFamily(page: Page, locale: Locale) {
  const t = messages[locale].interview;
  await add(page, "wife");
  await expectInSync(page);
  await add(page, "daughter");
  await expectInSync(page);
  await add(page, "son");
  await expectInSync(page);
  const more = page.getByRole("button", { name: t.stepperMore.replace("{relationship}", t.relationships.son), exact: true });
  await more.click();
  await more.click();
  await add(page, "son");
  return expectInSync(page);
}

test("UJ-2 in Arabic on desktop: build, fix, delete, Undo, drop, cascade cancel, later estate, Save", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 1400 });
  const locale = "ar";
  const t = messages[locale].interview;
  const removals = deletes(page);
  await startCase(page, locale);

  // 1. Relationship buttons and a count stepper: no name typing.
  let server = await buildFamily(page, locale);
  const sons = server.heirs.filter((h: { relationship: string }) => h.relationship === "son").map((h: { id: string }) => h.id);
  expect(sons.length).toBeGreaterThanOrEqual(4);

  // 2. A change of relationship on the node, saved at once.
  const slip = sons[0];
  await page.locator(`[data-node="${slip}"]`).click();
  const panel = page.locator("section[data-edit-sheet]");
  await panel.locator("[data-focus='editRelationship:daughter']").check();
  server = await expectInSync(page);
  expect(server.heirs.find((h: { id: string }) => h.id === slip).relationship).toBe("daughter");
  await panel.getByRole("button", { name: t.editClose, exact: true }).click();

  // 3. Delete a duplicate; the Undo toast appears. Delete another by mistake and tap Undo.
  await page.locator(`[data-focus="remove:${sons[1]}"]`).click();
  await expect(page.locator("[data-undo-toast]")).toBeVisible();
  server = await expectInSync(page);
  expect(server.heirs.some((h: { id: string }) => h.id === sons[1])).toBe(false);
  await page.locator(`[data-focus="remove:${sons[2]}"]`).click();
  await expectInSync(page);
  await undoButton(page, locale).click();
  server = await expectInSync(page);
  expect(server.heirs.some((h: { id: string }) => h.id === sons[2])).toBe(true);

  // 4. A chip dropped on a card, and "Add relative here", give the same family from the server.
  const before = await serverCase(page);
  await dragChip(page, "son", sons[2]);
  const dropped = await expectInSync(page);
  const viaDrop = shapeOf(before, dropped);
  // The child hangs from the card it was dropped on, not from a brother.
  expect(viaDrop.parentId).toBe(sons[2]);
  const card = page.locator(`[data-node="${sons[3]}"]`);
  await card.focus();
  await card.press("Tab");
  await page.getByRole("button", { name: t.addRelativeHere }).press("Enter");
  await page.locator("[data-add-row] [role='group'] button").first().press("Enter");
  const placed = await expectInSync(page);
  const viaHere = shapeOf(dropped, placed);
  expect(viaHere.parentId).toBe(sons[3]);
  expect({ ...viaHere, parentId: null }).toEqual({ ...viaDrop, parentId: null });

  // Sub-flow: a relative who died later has an estate of their own, opened and left with the breadcrumb.
  const known = new Set(placed.heirs.map((h: { id: string }) => h.id));
  await add(page, "son");
  const later = (await expectInSync(page)).heirs.find((h: { id: string }) => !known.has(h.id)).id as string;
  await openLaterEstate(page, later);
  await expectInSync(page, later);
  await add(page, "son");
  await expectInSync(page, later);
  await page.locator("nav[data-breadcrumb] a").first().click();
  await expect(page.locator("nav[data-breadcrumb]")).toHaveCount(0);
  await expectInSync(page);

  // Failure: removing the person with a later estate asks first and lists it; cancelling sends nothing.
  const sent = removals.length;
  const settled = await serverCase(page);
  await page.locator(`[data-focus="remove:${later}"]`).click();
  const dialog = page.locator("[data-edit-sheet]");
  await expect(dialog.locator("li").first()).toBeVisible();
  // The probe was the only DELETE; Cancel sends nothing at all.
  const probed = removals.length;
  expect(probed).toBe(sent + 1);
  await dialog.getByRole("button", { name: t.heirRemoveNo }).click();
  await expectInSync(page);
  expect(removals).toHaveLength(probed);
  expect(removals.filter(r => r.url().includes("confirm_cascade=true"))).toEqual([]);
  expect(await serverCase(page)).toEqual(settled);
  await expectInSync(page);

  // The journey ends at the existing Save action, on the results page.
  await page.locator("[data-summary-bar]").getByRole("link", { name: t.previewResultsLink }).click();
  await expect(page.getByRole("button", { name: messages[locale].results.save, exact: true })).toBeVisible();
});

test.describe("phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });

  test("UJ-2 at 375px in Arabic by touch: build, fix on the sheet, delete, Undo, Add relative here, Save", async ({ page }) => {
    test.setTimeout(100_000);
    const locale = "ar";
    const t = messages[locale].interview;
    await startCase(page, locale);
    for (const relationship of ["wife", "daughter", "son", "son", "son"]) {
      await add(page, relationship);
      await expectInSync(page);
    }
    let server = await serverCase(page);
    const sons: string[] = server.heirs.filter((h: { relationship: string }) => h.relationship === "son").map((h: { id: string }) => h.id);

    // A tap on a card opens the modal edit sheet; the relationship saves at once.
    await page.locator(`[data-node="${sons[0]}"]`).tap();
    const sheet = page.locator("dialog[data-edit-sheet]:modal");
    await expect(sheet).toBeVisible();
    await sheet.locator("[data-focus='editRelationship:daughter']").tap();
    server = await expectInSync(page);
    expect(server.heirs.find((h: { id: string }) => h.id === sons[0]).relationship).toBe("daughter");

    // Add relative here, from a son's sheet, is the touch route to a positioned add.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    const before = server;
    await page.locator(`[data-node="${sons[2]}"]`).tap();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: t.addRelativeHere }).tap();
    await sheet.getByRole("button", { name: t.addRelative.replace("{relationship}", t.relationships.son_of_son) }).tap();
    const placed = await expectInSync(page);
    expect(shapeOf(before, placed).parentId).toBe(sons[2]);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // Delete, then Undo.
    await page.locator(`[data-focus="remove:${sons[1]}"]`).tap();
    server = await expectInSync(page);
    expect(server.heirs.some((h: { id: string }) => h.id === sons[1])).toBe(false);
    await undoButton(page, locale).tap();
    server = await expectInSync(page);
    expect(server.heirs.some((h: { id: string }) => h.id === sons[1])).toBe(true);

    await page.locator("[data-summary-bar]").getByRole("link", { name: t.previewResultsLink }).tap();
    await expect(page.getByRole("button", { name: messages[locale].results.save, exact: true })).toBeVisible();
  });
});

test("UJ-2 by keyboard alone in English: add, move on the tree, edit, delete, Undo, Add relative here, Save", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const locale = "en";
  const t = messages[locale].interview;
  await startCase(page, locale);
  // Each control is reached by focus and used with the keyboard only; no pointer press from here on.
  for (const relationship of ["wife", "son", "son", "daughter"]) {
    await page.locator(`[data-focus='add:${relationship}']`).focus();
    await page.keyboard.press("Enter");
    await expectInSync(page);
  }
  let server = await serverCase(page);
  const son = server.heirs.find((h: { relationship: string }) => h.relationship === "son").id as string;

  // Arrows move over the tree, Enter opens the card's panel, Escape closes it.
  await page.locator('[data-node="root"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-node]:focus")).toHaveCount(1);
  await page.locator(`[data-node="${son}"]`).focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("section[data-edit-sheet]");
  await expect(panel.getByLabel(t.heirNameLabel)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.locator(`[data-node="${son}"]`)).toBeFocused();

  // Delete removes the focused card; Ctrl+Z takes it back.
  await page.keyboard.press("Delete");
  // Delete asks first; the answer is chosen with Tab to "Yes, remove" and Enter.
  const confirm = page.locator("[data-edit-sheet]").getByRole("button", { name: t.heirRemoveYes });
  await expect(confirm).toBeVisible();
  while (!(await confirm.evaluate(el => el === document.activeElement))) await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  server = await expectInSync(page);
  expect(server.heirs.some((h: { id: string }) => h.id === son)).toBe(false);
  await page.locator("[data-js-only]").focus();
  await page.keyboard.press("Control+z");
  server = await expectInSync(page);
  expect(server.heirs.some((h: { id: string }) => h.id === son)).toBe(true);

  // Tab from a card reaches Add relative here; Enter opens it and a choice posts one positioned add.
  const before = server;
  await page.locator(`[data-node="${son}"]`).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: t.addRelativeHere })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const placed = await expectInSync(page);
  expect(shapeOf(before, placed).parentId).toBe(son);

  await page.locator("[data-summary-bar]").getByRole("link", { name: t.previewResultsLink }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: messages[locale].results.save, exact: true })).toBeVisible();
});
