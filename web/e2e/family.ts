import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
export async function openHeirsScreen(page: Page, api: Api, locale: "en" | "ar"): Promise<void> {
  api.set({
    session: sessionAnonymous,
    getCase: json(200, { case: fullCase(agree.case) }),
    getPreview: json(200, { ...agree.response, presented: served.presented[agree.title] }),
  });
  await page.goto(`/${locale}/interview/`);
  await page.getByRole("button", { name: messages[locale].interview.resume }).click();
  await page.locator("section[aria-labelledby='heir-form-heading']").waitFor();
  await page.locator("section[aria-labelledby='preview-heading']").locator("table, ul").first().waitFor();
}
