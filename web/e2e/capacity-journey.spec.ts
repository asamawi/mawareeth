// Story 9.12: the 50-Heir Interview at phone and desktop width, and the server's capacity refusals.
// Stubbed API (runs in CI). The real-backend journey and timings are in e2e-live/.
import type { Locator, Page } from "@playwright/test";

import { messages } from "../src/i18n/messages";
import { expect, json, test } from "./api";
import { fiftyHeirFixture, openFiftyHeirs } from "./family";

type Row = Record<string, unknown>;

/** The root stays inside the canvas's own box, with a few pixels of margin; both boxes in one frame. */
async function rootInside(canvas: Locator): Promise<void> {
  const [outer, root, bar] = await canvas.evaluate(el => {
    const box = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return [box(el)!, box(el.querySelector('[data-node="root"]'))!, box(document.querySelector("[data-summary-bar]"))];
  });
  // The fixed summary bar never covers the deceased.
  if (bar) {
    const overlaps = root.x < bar.x + bar.width && root.x + root.width > bar.x && root.y < bar.y + bar.height && root.y + root.height > bar.y;
    expect(overlaps, "the summary bar covers the root").toBe(false);
  }
  expect(root.x).toBeGreaterThanOrEqual(outer.x + 5);
  expect(root.y).toBeGreaterThanOrEqual(outer.y + 5);
  expect(root.x + root.width).toBeLessThanOrEqual(outer.x + outer.width - 5);
  expect(root.y + root.height).toBeLessThanOrEqual(outer.y + outer.height - 5);
}

/** The focused element's outline, grown by its offset, sits inside the canvas's visible box. */
const focusUnclipped = (page: Page) => page.evaluate(() => {
  const area = document.querySelector<HTMLElement>("[data-tree-area]")!;
  const a = area.getBoundingClientRect();
  const focused = document.activeElement as HTMLElement;
  const r = focused.getBoundingClientRect();
  const style = getComputedStyle(focused);
  const grow = (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0);
  return r.left - grow >= a.left - 0.5 && r.right + grow <= a.left + area.clientWidth + 0.5
    && r.top - grow >= a.top - 0.5 && r.bottom + grow <= a.top + area.clientHeight + 0.5;
});

const stamp = (kase: Row, revision: number): Row => ({ ...kase, revision, snapshot: { at: revision } });

for (const locale of ["en", "ar"] as const) {
  const t = messages[locale].interview;
  for (const width of [375, 1280]) {
    test(`50 Heirs at ${width}px in ${locale}: root visible, targets, card widths and focus`, async ({ page, api }) => {
      await page.setViewportSize({ width, height: 900 });
      const { kase: first, ids } = await openFiftyHeirs(page, api, locale);
      await expect(page.locator("[data-summary-bar]")).toBeVisible();
      const canvas = page.getByRole("group", { name: t.treeHeading });
      await canvas.scrollIntoViewIfNeeded();
      await rootInside(canvas);

      // Card widths: 108px below 640px, 136px from there.
      const cards = page.locator('[data-tree-area] [data-node]:not([data-node="root"])');
      expect(await cards.count()).toBeGreaterThanOrEqual(50);
      const widths = await cards.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().width)));
      expect(new Set(widths)).toEqual(new Set([width < 640 ? 108 : 136]));

      // Fit, zoom and pan keep the root visible.
      for (const name of [t.treeZoomIn, t.treeZoomIn, t.treeZoomOut, t.treeZoomOut, t.treeZoomOut, t.treeFit]) {
        await page.getByRole("button", { name, exact: true }).click();
        await rootInside(canvas);
      }
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox())!;
      for (const direction of [-1, 1]) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + direction * 10000, box.y + box.height / 2 + direction * 10000, { steps: 5 });
        await page.mouse.up();
        await rootInside(canvas);
      }

      // Every card and action is a target of at least 44px.
      const targets = page.locator(
        "[data-tree-area] [data-node], section[data-tree] button, section[aria-labelledby='add-relatives-heading'] button, section[aria-labelledby='heirs-heading'] button, section[aria-labelledby='heirs-heading'] a, [data-summary-bar] button, [data-summary-bar] a, [data-summary-expand]");
      const small = await targets.evaluateAll(els => els.filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.width < 43.99 || r.height < 43.99);
      }).map(el => `${el.tagName} ${el.getAttribute("data-node") ?? el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`));
      expect(small).toEqual([]);

      // Arrows, Home and End keep the focus outline inside the canvas.
      await page.locator('[data-node="root"]').focus();
      for (const key of ["ArrowDown", "ArrowRight", "ArrowDown", "End", "Home"]) {
        await page.keyboard.press(key);
        await expect.poll(() => focusUnclipped(page)).toBe(true);
        await rootInside(canvas);
      }

      // An edit, then Undo, keep the root visible.
      const card = page.locator(`[data-node="${ids.edit}"]`);
      await card.focus();
      await card.press("Enter");
      const sheet = page.locator("[data-edit-sheet]");
      const name = sheet.getByLabel(t.heirNameLabel);
      await expect(name).toBeVisible();
      const revision = first.revision as number;
      const renamed = stamp({ ...first, heirs: (first.heirs as Row[]).map(h => h.id === ids.edit ? { ...h, name: "Renamed" } : h) }, revision + 1);
      api.set({ putHeir: json(200, { case: renamed }), postRestore: json(200, { case: stamp(first, revision + 2) }) });
      await name.fill("Renamed");
      await name.press("Tab");
      await expect(page.locator(`[data-node="${ids.edit}"]`)).toContainText("Renamed");
      await page.keyboard.press("Escape");
      await rootInside(canvas);
      await page.getByRole("button", { name: t.undoLastChange, exact: true }).first().click();
      await expect(page.locator(`[data-node="${ids.edit}"]`)).not.toContainText("Renamed");
      await rootInside(canvas);
      expect(api.restorePosts).toHaveLength(1);
    });
  }
}

test.describe("capacity refusals", () => {
  const t = messages.en.interview;
  const fixture = fiftyHeirFixture();
  const live = (): Row => fixture.kase;
  const ids = fixture.ids;
  // The tail of the first estate is plain children: dropping them leaves every card used below.
  const without = (kase: Row, count: number): Row => ({ ...kase, heirs: (kase.heirs as Row[]).slice(0, (kase.heirs as Row[]).length - count) });

  const second = (kase: Row) => (kase.deaths as Row[])[1].heir_id as string;
  const newer = (): Row => stamp(live(), (live().revision as number) + 1);

  /** An existing heir is still editable, and each later estate still opens (the second through the first). */
  async function stillEditable(page: Page, api: Parameters<typeof openFiftyHeirs>[1], kase: Row) {
    const named = stamp({ ...kase, heirs: (kase.heirs as Row[]).map(h => h.id === ids.edit ? { ...h, name: "Still editable" } : h) }, (kase.revision as number) + 1);
    api.set({ putHeir: json(200, { case: named }) });
    const card = page.locator(`[data-node="${ids.edit}"]`);
    await card.focus();
    await card.press("Enter");
    const name = page.locator("[data-edit-sheet]").getByLabel(t.heirNameLabel);
    await name.fill("Still editable");
    await name.press("Tab");
    await expect(page.locator(`[data-node="${ids.edit}"]`)).toContainText("Still editable");
    await page.keyboard.press("Escape");
    expect(api.heirPuts).toHaveLength(1);
    // The first later estate opens and its person still edits.
    const estate = page.locator(`[data-node="${ids.estate}"]`);
    await estate.focus();
    await estate.press("Enter");
    await expect(page.locator("[data-breadcrumb]")).toBeVisible();
    const later = stamp({ ...named, deaths: (named.deaths as Row[]).map(d => ({ ...d, heirs: (d.heirs as Row[]).map(h => h.id === ids.estateHeir ? { ...h, name: "Later heir" } : h) })) }, (named.revision as number) + 1);
    api.set({ putHeir: json(200, { case: later }) });
    const person = page.locator(`[data-node="${ids.estateHeir}"]`);
    await person.focus();
    await person.press("Enter");
    const edit = page.locator("[data-edit-sheet]").getByLabel(t.heirNameLabel);
    await expect(edit).toBeVisible();
    await edit.fill("Later heir");
    await edit.press("Tab");
    expect(api.heirPuts).toHaveLength(2);
    await page.keyboard.press("Escape");
    // The second later estate opens from the first: its heading is the third death.
    const next = page.locator(`[data-node="${second(kase)}"]`);
    await next.focus();
    await next.press("Enter");
    await expect(page.locator("[data-focus='treeHeading']")).toContainText(t.deathThird);
    await expect(page.locator("[data-breadcrumb]")).toBeVisible();
  }

  /** The refused limit holds on the page: every add button is disabled at 50 and the limit shows. */
  async function atLimit(page: Page) {
    await expect(page.getByText(t.fieldErrors.heirs.limit).first()).toBeVisible();
    for (const button of await page.locator("section[aria-labelledby='add-relatives-heading'] button[data-focus^='add:']").all()) {
      await expect(button).toHaveAttribute("aria-disabled", "true");
    }
  }

  test("the 51st add is refused, nothing says added and the Case still edits", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // The page holds 49 Heirs; another tab has since added the 50th, so the server refuses this one.
    const kase = without(live(), 1);
    await openFiftyHeirs(page, api, "en", kase);
    api.set({ postHeir: json(400, { detail: "Invalid input.", errors: { heirs: "limit" } }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: t.fieldErrors.heirs.limit }).first()).toBeVisible();
    expect(api.heirPosts).toHaveLength(1);
    await expect(page.locator("[data-undo-toast]")).toHaveCount(0);
    await expect(page.locator("[role='status']").filter({ hasText: /added/i })).toHaveCount(0);
    await stillEditable(page, api, kase);
  });

  test("a stale tab's 51st add gets a 409 with the newer Case: reconciled at the limit, both estates open", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = without(live(), 1);
    await openFiftyHeirs(page, api, "en", kase);
    const fresh = newer();
    api.set({ postHeir: json(409, { error: "conflict", detail: "That case is no longer the current one.", case: fresh }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.locator(`[data-node="${(fresh.heirs as Row[])[49].id}"]`)).toBeVisible();
    await expect(page.locator("[data-undo-toast]")).toHaveCount(0);
    await expect(page.locator("[role='status']").filter({ hasText: /added/i })).toHaveCount(0);
    await atLimit(page);
    await stillEditable(page, api, fresh);
  });

  test("a bulk add past 50 is refused whole and the Case still edits", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = without(live(), 3);
    await openFiftyHeirs(page, api, "en", kase);
    const more = page.getByRole("button", { name: t.stepperMore.replace("{relationship}", "Son"), exact: true });
    await more.click();
    await more.click();
    api.set({ postBulk: json(400, { error: "over_capacity", detail: "A layer holds at most 50 heirs." }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: t.fieldErrors.heirs.limit }).first()).toBeVisible();
    expect(api.bulkPosts).toHaveLength(1);
    expect(JSON.parse(api.bulkPosts[0].body).heirs).toHaveLength(3);
    await expect(page.locator("[data-undo-toast]")).toHaveCount(0);
    await stillEditable(page, api, kase);
  });

  test("a stale tab's bulk add gets a 409 with the newer Case: reconciled at the limit, both estates open", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const kase = without(live(), 3);
    await openFiftyHeirs(page, api, "en", kase);
    const more = page.getByRole("button", { name: t.stepperMore.replace("{relationship}", "Son"), exact: true });
    await more.click();
    await more.click();
    const fresh = newer();
    api.set({ postBulk: json(409, { error: "conflict", detail: "That case is no longer the current one.", case: fresh }) });
    await page.getByRole("button", { name: "Add Son", exact: true }).click();
    await expect(page.locator(`[data-node="${(fresh.heirs as Row[])[49].id}"]`)).toBeVisible();
    expect(api.bulkPosts).toHaveLength(1);
    await expect(page.locator("[data-undo-toast]")).toHaveCount(0);
    await atLimit(page);
    await stillEditable(page, api, fresh);
  });

  /** A page that knows one later death while the server holds two (another tab recorded the second). */
  const oneDeath = (): Row => ({ ...live(), deaths: (live().deaths as Row[]).slice(0, 1) });
  async function markThird(page: Page) {
    const card = page.locator(`[data-node="${ids.later}"]`);
    await card.focus();
    await card.press("Enter");
    await page.locator("section[data-edit-sheet]").getByRole("radio", { name: t.statusDiedLater }).click();
  }

  test("a third later death is refused, nothing changes and both estates open afterwards", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFiftyHeirs(page, api, "en", oneDeath());
    api.set({ postDeath: json(400, { detail: "Invalid input.", errors: { death: "limit" } }) });
    await markThird(page);
    await expect(page.getByRole("alert").filter({ hasText: t.fieldErrors.death.limit }).first()).toBeVisible();
    expect(api.deathPosts).toHaveLength(1);
    await expect(page.locator(`[data-node="${ids.later}"]`)).not.toHaveAttribute("data-state", "died_later");
    await page.keyboard.press("Escape");
    // The server holds both estates: a reload shows them, and each opens.
    api.set({ getCase: json(200, { case: live() }) });
    await page.reload();
    // A tab that already opened the Case loads straight in; a new one asks to resume.
    const resume = page.getByRole("button", { name: t.resume });
    const tree = page.locator("section[data-tree] [data-tree-area]");
    await expect(resume.or(tree)).toBeVisible();
    if (await resume.isVisible()) await resume.click();
    await page.locator("section[data-tree] [data-tree-area]").waitFor();
    await stillEditable(page, api, live());
  });

  test("a stale tab's third death gets a 409 with the newer Case: reconciled, limit shown, both estates open", async ({ page, api }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openFiftyHeirs(page, api, "en", oneDeath());
    const fresh = newer();
    api.set({ postDeath: json(409, { error: "conflict", detail: "That case is no longer the current one.", case: fresh }) });
    await markThird(page);
    expect(api.deathPosts).toHaveLength(1);
    await expect(page.locator(`[data-node="${ids.later}"]`)).not.toHaveAttribute("data-state", "died_later");
    await page.keyboard.press("Escape");
    // The reconciled Case has two later deaths: a plain card no longer offers a third.
    const card = page.locator(`[data-node="${ids.later}"]`);
    await card.focus();
    await card.press("Enter");
    const sheet = page.locator("section[data-edit-sheet]");
    await expect(sheet.getByRole("radio", { name: t.statusDiedLater })).toHaveCount(0);
    await expect(sheet).toContainText(t.laterDeathLimit);
    await page.keyboard.press("Escape");
    await stillEditable(page, api, fresh);
  });
});
