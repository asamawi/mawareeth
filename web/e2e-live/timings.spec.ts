// Story 9.12: browser-side timings of the six family actions on a 50-Heir Case, against the real API.
// Supporting evidence only (Chrome 4x CPU throttling plus a Fast-4G-like network on `next dev`, which is
// unminified and sends no compressed bodies); the device run in epic-9-gate-evidence.md is what the gate
// needs. So a p95 over the budget is recorded (`within_budget`) and annotated, not failed: set
// E2E_LIVE_ENFORCE=1 to fail on it. The output holds no names and no ids.
import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { messages } from "../src/i18n/messages";
import { add, dragChip, serverCase, undoButton } from "./live";

const SAMPLES = Number(process.env.E2E_LIVE_SAMPLES ?? 5);
if (!Number.isInteger(SAMPLES) || SAMPLES < 1) throw new Error(`E2E_LIVE_SAMPLES must be an integer of at least 1, got "${process.env.E2E_LIVE_SAMPLES}"`);
const OUT = "test-results/live-timings.json";
const BUDGET_MS = 1000;
// The harness's network model (api/capacity.py): 150 ms round trip, 1.6 Mbps down, 750 kbps up.
const NETWORK = { label: "fast-4g-emulated", rtt_ms: 150, down_kbps: 1600, up_kbps: 750 };
const CPU_RATE = 4;
const ACTIONS = ["add", "bulk_add", "edit", "delete", "drop", "undo"] as const;
type Action = (typeof ACTIONS)[number];
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global { interface Window { __timing: { start: number | null; revision: number | null; end: number | null; armed: boolean } } }

/** Records the start (first pointer release or key press after arming) and the end (the accepted preview). */
const INSTALL = () => {
  const state = { start: null as number | null, revision: null as number | null, end: null as number | null, armed: false };
  window.__timing = state;
  const check = () => {
    if (state.end !== null || state.revision === null) return;
    const root = document.querySelector("[data-js-only]");
    if (!root) return;
    const ready = /^(ready|choose-school)$/.test(root.getAttribute("data-preview-state") ?? "");
    if (ready && root.getAttribute("data-preview-revision") === String(state.revision)) requestAnimationFrame(() => { if (state.end === null) state.end = performance.now(); });
  };
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    const request = args[0];
    const method = (args[1]?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
    const url = typeof request === "string" ? request : request instanceof Request ? request.url : String(request);
    if (state.armed && method !== "GET" && url.includes("/api/v1/case/") && response.ok) {
      response.clone().json().then((body: { case?: { revision?: number } }) => {
        if (typeof body?.case?.revision === "number") { state.revision = body.case.revision; check(); }
      }).catch(() => undefined);
    }
    return response;
  };
  new MutationObserver(check).observe(document, { subtree: true, attributes: true, childList: true, attributeFilter: ["data-preview-revision", "data-preview-state"] });
  for (const type of ["pointerup", "keydown"]) document.addEventListener(type, () => { if (state.armed && state.start === null) state.start = performance.now(); }, true);
};

async function post(page: Page, method: "POST" | "PUT" | "PATCH", path: string, data: Row): Promise<Row> {
  const csrf = (await page.context().cookies()).find(c => c.name === "csrftoken")?.value ?? "";
  const response = await page.request.fetch("/api/v1/case/" + path, { method, data, headers: { "X-CSRFToken": csrf } });
  expect(response.ok(), `${method} ${path}`).toBe(true);
  return (await response.json()).case;
}

/** The harness's Cases (api/capacity.py): 47 Heirs in the first estate, a School or a comparison, and later deaths. */
async function seed(page: Page, name: "school" | "compare" | "two_later_deaths"): Promise<Row> {
  await page.request.get("/api/v1/session/");
  let kase = await post(page, "POST", "", {});
  const write = async (method: "POST" | "PUT" | "PATCH", path: string, body: Row) => {
    kase = await post(page, method, path, { ...body, case_id: kase.id, expected_revision: kase.revision });
  };
  await write("PUT", "deceased/", { gender: "male", estate: "120000" });
  const relationships = name === "school" ? ["wife", "father", "mother", "son", "daughter"] : ["wife"];
  if (name === "school") await write("PATCH", "", { madhab: "hanbali" });
  const rest = 47 - relationships.length;
  relationships.push(...Array(Math.ceil(rest / 2)).fill("son"), ...Array(Math.floor(rest / 2)).fill("daughter"));
  await write("POST", "heirs/bulk/", { heirs: relationships.map(relationship => ({ relationship })) });
  if (name === "two_later_deaths") {
    const son = kase.heirs.find((h: Row) => h.relationship === "son").id;
    // The same calls, in the same order, as the harness's `build_interview` (api/capacity.py).
    await write("POST", "deaths/", { heir_id: son });
    await write("POST", "heirs/", { relationship: "son", layer: son });
    const grandson = kase.deaths[0].heirs.find((h: Row) => h.relationship === "son").id;
    await write("POST", "deaths/", { heir_id: grandson, first: son });
    await write("POST", "heirs/", { relationship: "son", layer: grandson });
  }
  return kase;
}

const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];

async function throttle(cdp: CDPSession, on: boolean) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: on ? CPU_RATE : 1 });
  await cdp.send("Network.emulateNetworkConditions", on
    ? { offline: false, latency: NETWORK.rtt_ms, downloadThroughput: NETWORK.down_kbps * 125, uploadThroughput: NETWORK.up_kbps * 125 }
    : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}

function record(workload: string, action: Action, samples: number[]) {
  const data = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {
    device: `chromium-desktop-${CPU_RATE}x-cpu`, network: NETWORK, budget_ms: BUDGET_MS, server: "next dev + runserver, local PostgreSQL", workloads: {},
  };
  data.workloads[workload] = {
    ...data.workloads[workload],
    [action]: { n: samples.length, samples_ms: samples.map(v => Math.round(v * 100) / 100), p95: Math.round(p95(samples) * 100) / 100, within_budget: p95(samples) < BUDGET_MS },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
}

for (const workload of ["school", "compare", "two_later_deaths"] as const) {
  test(`timings: ${workload}, 50 Heirs, six actions (supporting evidence)`, async ({ page }) => {
    test.setTimeout(Number(process.env.E2E_LIVE_TIMEOUT_MS ?? 1_800_000));
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page.addInitScript(INSTALL);
    const locale = "ar";
    const t = messages[locale].interview;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    const base = await seed(page, workload);
    const snapshot = base.snapshot;
    const sons: string[] = base.heirs.filter((h: Row) => h.relationship === "son").map((h: Row) => h.id);
    const daughters: string[] = base.heirs.filter((h: Row) => h.relationship === "daughter").map((h: Row) => h.id);
    const removable = workload === "two_later_deaths" ? base.deaths[0].heir_id as string : daughters[daughters.length - 1];

    /** Back to the base Case, outside the timer: restore, reload and resume with no throttling. */
    const reset = async () => {
      await throttle(cdp, false);
      const current = await serverCase(page);
      await post(page, "POST", "restore/", { case_id: current.id, expected_revision: current.revision, snapshot });
      await page.goto(`/${locale}/interview/`);
      // A Case this tab has not opened yet asks to resume; one it already opened loads straight in.
      const resume = page.getByRole("button", { name: messages[locale].interview.resume });
      const loaded = page.locator("[data-preview-state='ready'], [data-preview-state='choose-school']").first();
      await expect(resume.or(loaded)).toBeVisible({ timeout: 60_000 });
      if (await resume.isVisible()) await resume.click();
      await loaded.waitFor();
    };
    const arm = () => page.evaluate(() => Object.assign(window.__timing, { start: null, revision: null, end: null, armed: true }));
    const finish = async () => {
      await page.waitForFunction(() => window.__timing.end !== null, null, { timeout: 30_000 });
      return page.evaluate(() => window.__timing.end! - window.__timing.start!);
    };
    const steps: Record<Action, () => Promise<void>> = {
      add: async () => { await throttle(cdp, true); await arm(); await add(page, "son"); },
      bulk_add: async () => {
        const more = page.getByRole("button", { name: t.stepperMore.replace("{relationship}", t.relationships.son), exact: true });
        await more.click(); await more.click();
        await throttle(cdp, true); await arm(); await add(page, "son");
      },
      edit: async () => {
        await page.locator(`[data-node="${daughters[0]}"]`).click();
        // Same gender, so a person linked into a later estate can take it: daughter to full sister.
        const sheet = page.locator("section[data-edit-sheet]");
        await sheet.getByRole("button", { name: t.heirMoreRelatives }).click();
        const select = sheet.locator("#heir-relationship-rare");
        await select.waitFor();
        await throttle(cdp, true); await arm(); await select.selectOption("sister");
      },
      delete: async () => {
        await throttle(cdp, true); await arm();
        await page.locator(`[data-focus="remove:${removable}"]`).click();
        if (workload === "two_later_deaths") await page.locator("[data-edit-sheet]").getByRole("button", { name: t.heirRemoveYes }).click();
      },
      drop: async () => { await throttle(cdp, true); await arm(); await dragChip(page, "son", sons[0]); },
      undo: async () => {
        await add(page, "son");
        await expect(page.locator("[data-undo-toast]")).toBeVisible();
        await page.locator("[data-preview-state='ready'], [data-preview-state='choose-school']").first().waitFor();
        await throttle(cdp, true); await arm();
        await undoButton(page, locale).click();
      },
    };

    for (const action of ACTIONS) {
      const samples: number[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        await reset();
        await steps[action]();
        samples.push(await finish());
      }
      record(workload, action, samples);
      test.info().annotations.push({ type: `${workload} ${action} p95 (ms, emulated)`, description: String(Math.round(p95(samples))) });
      if (process.env.E2E_LIVE_ENFORCE === "1") expect(p95(samples), `${workload} ${action} p95`).toBeLessThan(BUDGET_MS);
    }
    await throttle(cdp, false);
  });
}
