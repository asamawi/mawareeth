import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { directionOf, messages } from "../src/i18n/messages";
import { expect, fullCase, json, sessionAnonymous, sessionAuthenticated, test, type Api } from "./api";

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

    test("Share then Copy reports created then copied in the same status line as Save", async ({ page, api, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const row = { id: 7, visibility: "private", created_at: "2026-11-26T00:00:00Z", expires_at: "2026-12-26T00:00:00Z", expired: false };
      stubResults(api, {
        postSaved: json(201, { id: 42, name: SUGGESTION, updated_at: "2026-11-26T00:00:00Z", revision: 1 }),
        postShareCreate: json(201, { ...row, token: "tok123" }),
        getShares: json(200, { shares: [row] }),
      });
      await page.goto(`/${locale}/results/`);
      await page.getByRole("button", { name: text.shareAction, exact: true }).click();
      await expect(status(page)).toHaveText(messages[locale].share.created);
      await page.getByRole("button", { name: messages[locale].share.copy, exact: true }).click();
      await expect(status(page)).toHaveText(messages[locale].share.copied);
      await expect(status(page)).toHaveCount(1);
    });

    test("a guest's Share link goes through the real sign-in page and resumes the share for the same Case", async ({ page, api, context }) => {
      // Retro item 3 (story 11.5): sign in through the login form, not a faked `?resume=` session.
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const state = { signedIn: false };
      const row = { id: 7, visibility: "private", created_at: "2026-11-26T00:00:00Z", expires_at: "2026-12-26T00:00:00Z", expired: false };
      stubResults(api, {
        session: (route) => (state.signedIn ? sessionAuthenticated : sessionAnonymous)(route),
        postSaved: json(201, { id: 42, name: SUGGESTION, updated_at: "2026-11-26T00:00:00Z", revision: 1 }),
        postShareCreate: json(201, { ...row, token: "tok123" }),
        getShares: json(200, { shares: [row] }),
      });
      const logins: string[] = [];
      await page.route("**/api/v1/auth/login/", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        state.signedIn = true;
        const next = JSON.parse(route.request().postData() ?? "{}").next;
        logins.push(next);
        return json(200, { redirect: next })(route);
      });
      await page.goto(`/${locale}/results/`);
      await page.getByRole("button", { name: text.shareAction, exact: true }).click();
      await page.getByRole("dialog").getByRole("link", { name: text.signIn }).click();
      await page.waitForURL(`**/${locale}/login/**`);
      expect(new URL(page.url()).searchParams.get("next")).toBe(`/${locale}/results/?resume=share`);
      expect(api.savedPosts).toHaveLength(0);
      await page.locator("input[name=username]").fill("owner");
      await page.locator("input[name=password]").fill("secret-pass-1");
      await page.locator("input[name=password]").press("Enter");
      await page.waitForURL(`**/${locale}/results/**`);
      await expect(status(page)).toHaveText(messages[locale].share.created);
      expect(logins).toEqual([`/${locale}/results/?resume=share`]);
      // The share is made for the same Case the guest was looking at, saved first, once.
      expect(api.savedPosts.map((post) => JSON.parse(post.body).case_id)).toEqual([agree.case.id]);
      await expect.poll(() => page.url()).not.toContain("resume=");
    });

    test("a failing PDF shows the failure in the status line with the family still visible", async ({ page, api }) => {
      stubResults(api, { getDraftReport: (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) });
      await page.goto(`/${locale}/results/`);
      await page.getByRole("button", { name: text.pdfDownload, exact: true }).click();
      await expect(status(page)).toHaveText(text.pdfFailed);
      await expect(page.locator("#results-family")).toBeVisible();
      await expect(page.getByRole("button", { name: text.pdfRetry, exact: true })).toBeVisible();
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

for (const locale of ["en", "ar"] as const) {
  test(`Full results at 320px in ${locale} has no page x-scroll and a labelled table region`, async ({ page, api }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    stubResults(api);
    await page.goto(`/${locale}/results/`);
    const region = page.getByRole("region", { name: messages[locale].results.table.caption });
    await expect(region).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await region.evaluate((el) => el.scrollWidth >= el.clientWidth)).toBe(true);
  });
}

for (const locale of ["en", "ar", "fr"] as const) {
  const text = messages[locale].results;
  const names = [text.pdfDownload, text.save, text.shareAction, text.whatsappAction];
  const action = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

  test.describe(`Story 11.5 in ${locale}`, () => {
    test("desktop: ordered action row, primary and secondary styles, disclaimer and shell", async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      stubResults(api);
      await page.goto(`/${locale}/results/`);
      const boxes = [];
      for (const name of names) {
        const box = await action(page, name).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        boxes.push(box!);
      }
      const rtl = directionOf(locale) === "rtl";
      for (let i = 1; i < boxes.length; i += 1) {
        expect(rtl ? boxes[i].x < boxes[i - 1].x : boxes[i].x > boxes[i - 1].x).toBe(true);
      }
      const row = action(page, text.save).locator("..");
      const gaps = await row.evaluate((el) => { const s = getComputedStyle(el); return [s.columnGap, s.rowGap]; });
      expect(gaps).toEqual(["12px", "12px"]);
      const styles = await Promise.all(names.map((name) => action(page, name).evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, border: s.borderTopWidth }; })));
      expect(styles[0].bg).not.toBe("rgba(0, 0, 0, 0)");
      for (const style of styles.slice(1)) {
        expect(style.bg).toBe("rgba(0, 0, 0, 0)");
        expect(style.border).toBe("1px");
      }
      const notice = page.locator("[data-notice=disclaimer]");
      await expect(notice).toBeVisible();
      const look = await notice.evaluate((el) => { const s = getComputedStyle(el); return { pad: s.paddingTop, border: s.borderTopWidth, weight: Number(s.fontWeight) }; });
      expect(look.pad).toBe("12px");
      expect(look.border).toBe("1px");
      expect(look.weight).toBeGreaterThanOrEqual(600);
      const main = await page.locator("main").evaluate((el) => { const s = getComputedStyle(el); return { width: el.getBoundingClientRect().width, start: s.paddingInlineStart }; });
      expect(main.width).toBeLessThanOrEqual(1024);
      expect(main.start).toBe("24px");
      const vertical = await page.locator("main").evaluate((el) => { const s = getComputedStyle(el); return [s.paddingTop, s.paddingBottom]; });
      expect(vertical).toEqual(["64px", "64px"]);
    });

    test("desktop: table caption, proof tint, LTR fractions and keyboard order", async ({ page, api }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      stubResults(api);
      await page.goto(`/${locale}/results/`);
      await expect(page.getByRole("region", { name: text.table.caption })).toBeVisible();
      expect(await page.locator("bdi[dir=ltr]").count()).toBeGreaterThan(0);
      const region = page.getByRole("region", { name: text.table.caption });
      const proof = region.locator("button[aria-controls]").first();
      expect(await proof.evaluate((el) => getComputedStyle(el).textDecorationStyle)).toBe("dotted");
      await proof.click();
      expect(await proof.evaluate((el) => getComputedStyle(el.closest("tr")!).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      await action(page, names[0]).focus();
      for (const name of names.slice(1)) {
        await page.keyboard.press("Tab");
        await expect(action(page, name)).toBeFocused();
        const outline = await action(page, name).evaluate((el) => getComputedStyle(el).outlineStyle);
        expect(outline).not.toBe("none");
      }
    });

    test("phone: actions wrap inside the viewport with no page x-scroll", async ({ page, api }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      stubResults(api);
      await page.goto(`/${locale}/results/`);
      for (const name of names) {
        const box = (await action(page, name).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(320);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const region = page.getByRole("region", { name: text.table.caption });
      expect(await region.evaluate((el) => el.scrollWidth >= el.clientWidth)).toBe(true);
    });

    test("a failed PDF leaves Retry and the table", async ({ page, api }) => {
      stubResults(api, { getDraftReport: (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) });
      await page.goto(`/${locale}/results/`);
      await action(page, text.pdfDownload).click();
      await expect(action(page, text.pdfRetry)).toBeVisible();
      await expect(page.getByRole("region", { name: text.table.caption })).toBeVisible();
    });

    test("guest: Save opens sign-in, Close sends nothing and returns focus to Save", async ({ page, api }) => {
      let posts = 0;
      stubResults(api, { session: sessionAnonymous, postSaved: (route) => { posts += 1; return json(201, { id: 42, name: "x", updated_at: "2026-11-26T00:00:00Z", revision: 1 })(route); } });
      await page.goto(`/${locale}/results/`);
      await action(page, text.save).click();
      await expect(page.locator("dialog[open]")).toBeVisible();
      await page.locator("dialog[open]").getByRole("button", { name: text.close, exact: true }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      expect(posts).toBe(0);
      await expect(page.getByText(text.saved, { exact: true })).toHaveCount(0);
      await expect(action(page, text.save)).toBeFocused();
    });

    for (const scheme of ["light", "dark"] as const) {
      for (const width of [320, 1280]) {
        test(`axe at ${width}px in ${scheme} mode`, async ({ page, api }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width, height: 800 });
          stubResults(api);
          await page.goto(`/${locale}/results/`);
          await expect(action(page, text.pdfDownload)).toBeVisible();
          expect(await serious(page)).toEqual([]);
        });
      }
    }
  });
}

for (const locale of ["en", "ar", "fr"] as const) {
  const text = messages[locale].results;
  for (const withAmount of [true, false]) {
    test(`Story 11.6: the supplied-facts notice sits between the disclaimer and Download PDF ${withAmount ? "with" : "without"} an amount in ${locale}`, async ({ page, api }) => {
      const kase = fullCase(agree.case, { deceased: { ...(agree.case.deceased as Record<string, unknown>), estate: withAmount ? "9000" : null } });
      const basis = { ...((agreeResponse as Record<string, unknown>).basis as Record<string, unknown>), estate: withAmount ? "9000" : null };
      const shares = ((agreeResponse as Record<string, unknown>).shares as Record<string, unknown>[]).map((share) => (withAmount ? share : { ...share, amount: null }));
      stubResults(api, { getCase: json(200, { case: kase }), getPreview: json(200, { ...agreeResponse, basis, shares }) });
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto(`/${locale}/results/`);
      const notice = page.locator("[data-notice=supplied-facts]");
      await expect(notice).toBeVisible();
      const catalog = JSON.parse(readFileSync(join(process.cwd(), "..", "i18n", "terms", `${locale}.json`), "utf8")).terms;
      await expect(notice).toHaveText(catalog[withAmount ? "notice.supplied_facts" : "notice.supplied_facts_no_amount"].text);
      const disclaimer = (await page.locator("[data-notice=disclaimer]").boundingBox())!;
      const box = (await notice.boundingBox())!;
      const pdf = (await page.getByRole("button", { name: text.pdfDownload, exact: true }).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(disclaimer.y + disclaimer.height - 1);
      expect(pdf.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
      expect(await serious(page)).toEqual([]);
    });
  }
}

const fixtureNamed = (title: string) =>
  (JSON.parse(readFileSync(join(process.cwd(), "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as { fixtures: { title: string; case: Record<string, unknown>; response: Record<string, unknown> }[] })
    .fixtures.find((item) => item.title === title)!;

for (const locale of ["en", "ar", "fr"] as const) {
  test.describe(`Story 11.7 rounding line in ${locale}`, () => {
    test("the negative adjustment shows its label and served text after the shares, at 320px", async ({ page, api }) => {
      const title = "Two wives and a son, rounded half up";
      const fx = fixtureNamed(title);
      const presented = served.presented[title] as { rounding: { text: string } };
      stubResults(api, { getCase: json(200, { case: fullCase(fx.case) }), getPreview: json(200, { ...fx.response, presented: served.presented[title] }) });
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto(`/${locale}/results/`);
      const section = page.locator("section[aria-labelledby=results-shares]");
      const line = section.locator("[data-rounding]");
      await expect(line).toBeVisible();
      await expect(line).toHaveText(`${messages[locale].interview.previewRounding}: ${presented.rounding.text}`);
      const rows = (await section.locator("table, ul").last().boundingBox())!;
      const box = (await line.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(rows.y + rows.height - 1);
      expect(await serious(page)).toEqual([]);
    });

    test("a zero adjustment shows no rounding line", async ({ page, api }) => {
      expect((served.presented["Agree: wife, son and daughter in every school"] as { rounding: unknown }).rounding).toBeNull();
      stubResults(api);
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto(`/${locale}/results/`);
      await expect(page.locator("section[aria-labelledby=results-shares]")).toBeVisible();
      await expect(page.locator("[data-rounding]")).toHaveCount(0);
      expect(await serious(page)).toEqual([]);
    });
  });
}
