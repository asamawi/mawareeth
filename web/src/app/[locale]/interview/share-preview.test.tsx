import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRoot } from "react-dom/client";
import { act, createRef } from "react";
import type { Window } from "happy-dom";

import { parsePreview, type Preview } from "@/api/case";
import { terms, type Locale } from "@/i18n/catalog.generated";
import { messages } from "@/i18n/messages";
import { installDom, teardownDom } from "@/test/dom";
import { previewFixture, previewFixtures as allFixtures } from "@/test/preview-fixtures";
import type { PreviewContent, SharePreviewView } from "./share-preview";

let dom: Window;
before(() => { dom = installDom("http://localhost/en/interview/"); });
after(() => teardownDom(dom));

const { SharePreviewBody } = await import("./share-preview.tsx");
const en = messages.en.interview;

type Available = Extract<Preview, { status: "available" }>;
const available = (title: string): Available => {
  const preview = parsePreview(previewFixture(title).response);
  assert.equal(preview?.status, "available");
  return preview as Available;
};

function view(content: PreviewContent, over: Partial<SharePreviewView> = {}): SharePreviewView {
  return { state: "ready", revision: 1, pending: false, kept: false, slowLevel: 0, heirCount: 2, content, reserve: 0, bodyRef: createRef(), retry: () => {}, ...over };
}

async function render(v: SharePreviewView, locale = "en", extra: { onRetry?: () => void; onChooseSchool?: (madhab: string) => void } = {}) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<SharePreviewBody {...v} messages={messages[locale as "en"].interview} locale={locale} onRetry={extra.onRetry ?? (() => {})} onChooseSchool={extra.onChooseSchool} />));
  return { node, done: async () => { await act(async () => root.unmount()); node.remove(); } };
}

const labelsOf = (preview: Available) => Object.fromEntries(preview.presented!.rows.map((row) => [row.person, row.name?.text ?? row.person]));

test("an inheriting row shows the served fraction, percent and amount, and a Full results primary link", async () => {
  const preview = available("Hanbali wife and son with an estate");
  const { rows } = preview.presented!;
  const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }));
  try {
    const items = [...node.querySelectorAll("ul > li")];
    assert.equal(items.length, rows.length);
    for (const [i, row] of rows.entries()) {
      if (row.blocked) continue;
      const text = items[i].textContent ?? "";
      assert.ok(text.includes(row.share.text), "fraction");
      assert.ok(text.includes(row.percent.text), "percent");
      if (row.amount) assert.ok(text.includes(row.amount.text), "amount");
      assert.equal(items[i].querySelector(".font-semibold bdi[dir=ltr]")?.textContent, row.share.text);
    }
    const link = node.querySelector("a")!;
    assert.ok(link.className.includes("min-h-11") && link.className.includes("bg-accent"));
    assert.equal(node.querySelector("[aria-live]"), null);
    assert.equal(node.querySelector("[role=status]"), null);
  } finally { await done(); }
});

test("Full results links to the locale's results page with its own text", async () => {
  const preview = available("Hanbali wife and son with an estate");
  for (const locale of ["en", "ar", "fr"] as const) {
    const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }), locale);
    try {
      const link = node.querySelector("a")!;
      assert.equal(link.getAttribute("href"), `/${locale}/results/`);
      assert.equal(link.textContent, messages[locale].interview.previewResultsLink);
    } finally { await done(); }
  }
});

test("a row with no amount shows no amount cell", async () => {
  const base = available("Hanbali wife and son with an estate");
  const rows = base.presented!.rows.map((row) => ({ ...row, amount: null }));
  const preview: Available = { ...base, presented: { ...base.presented!, rows } };
  const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }));
  try {
    for (const item of node.querySelectorAll("ul > li")) {
      if (item.hasAttribute("data-blocked")) continue;
      assert.equal(item.querySelectorAll(".font-semibold bdi[dir=ltr]").length, 2);
      assert.equal(item.querySelectorAll(".font-semibold bdi[dir=auto]").length, 0);
    }
  } finally { await done(); }
});

test("a blocked row says so in text and shows no values", async () => {
  const title = previewFixtures().find((t) => available(t).presented!.rows.some((row) => row.blocked));
  assert.ok(title, "a fixture with a blocked heir");
  const preview = available(title);
  const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }));
  try {
    const blocked = node.querySelector("li[data-blocked]")!;
    assert.ok(blocked.textContent?.includes(en.treeNoShare));
    assert.equal(blocked.querySelector(".font-semibold"), null);
  } finally { await done(); }
});

test("the disclaimer is always shown without a dismiss control; null text falls back to the catalog", async () => {
  const base = available("Hanbali wife and son with an estate");
  const preview: Available = { ...base, presented: { ...base.presented!, notices: [{ code: "disclaimer", text: null }] } };
  for (const locale of ["en", "ar", "fr"]) {
    const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }), locale);
    try {
      const note = node.querySelector("[data-notice=disclaimer]")!;
      assert.equal(note.textContent, terms[locale as Locale]["notice.disclaimer"], locale);
      assert.equal(note.querySelector("button"), null);
      assert.equal(node.querySelector("[data-notice=locale_beta]"), null);
    } finally { await done(); }
  }
});

test("a Beta notice shows its text, and is omitted with neither text nor catalog key", async () => {
  const base = available("Hanbali wife and son with an estate");
  const withText: Available = { ...base, presented: { ...base.presented!, notices: [{ code: "disclaimer", text: null }, { code: "locale_beta", text: "Beta explanation" }] } };
  let r = await render(view({ kind: "available", preview: withText, labels: labelsOf(withText) }));
  try { assert.equal(r.node.querySelector("[data-notice=locale_beta]")?.textContent, "Beta explanation"); } finally { await r.done(); }
  const without: Available = { ...base, presented: { ...base.presented!, notices: [{ code: "locale_beta", text: null }] } };
  r = await render(view({ kind: "available", preview: without, labels: labelsOf(without) }));
  try { assert.equal(r.node.querySelector("[data-notice=locale_beta]"), null); } finally { await r.done(); }
});

test("pending, error with Retry, and refusal states", async () => {
  let r = await render(view({ kind: "waiting" }, { state: "pending", pending: true }));
  try { assert.ok(r.node.textContent?.includes(en.previewWaiting)); assert.equal(r.node.querySelector("section")?.getAttribute("aria-busy"), "true"); } finally { await r.done(); }
  let retried = 0;
  r = await render(view({ kind: "error", text: en.previewFailed, retry: true }, { state: "error" }), "en", { onRetry: () => { retried += 1; } });
  try {
    const button = r.node.querySelector("button")!;
    assert.equal(button.textContent, en.previewRetry);
    await act(async () => { button.click(); });
    assert.equal(retried, 1);
  } finally { await r.done(); }
  r = await render(view({ kind: "refused", reason: "Because." }, { state: "refused" }));
  try { assert.ok(r.node.textContent?.includes(en.previewUnavailable)); assert.ok(r.node.textContent?.includes("Because.")); } finally { await r.done(); }
});

test("schools that differ show the School choice, and choosing one reports it", async () => {
  const preview = parsePreview(previewFixture("Differ: grandfather and full brother").response);
  assert.equal(preview?.status, "choose_school");
  const choose = preview as Extract<Preview, { status: "choose_school" }>;
  const chosen: string[] = [];
  const r = await render(view({ kind: "choose", preview: choose, labels: {} }, { state: "choose-school" }), "en", { onChooseSchool: (m) => { chosen.push(m); } });
  try {
    assert.ok(r.node.querySelector("[data-school-choice]"));
    assert.ok(r.node.textContent?.includes(en.schoolsDiffer));
    const radio = r.node.querySelector<HTMLInputElement>("input[type=radio]")!;
    await act(async () => { radio.click(); });
    await act(async () => { r.node.querySelector<HTMLButtonElement>("button[type=submit]")!.click(); });
    assert.deepEqual(chosen, [radio.value]);
  } finally { await r.done(); }
});

function previewFixtures(): string[] {
  return previewFixtureTitles().filter((t) => parsePreview(previewFixture(t).response)?.status === "available");
}

const previewFixtureTitles = () => allFixtures.map((f) => f.title);

test("the disclaimer is present for choose, refused, error, prompt and waiting content", async () => {
  const base = available("Hanbali wife and son with an estate");
  const choose = parsePreview(previewFixture("Differ: grandfather and full brother").response);
  assert.equal(choose?.status, "choose_school");
  const contents: PreviewContent[] = [
    { kind: "choose", preview: choose as Extract<Preview, { status: "choose_school" }>, labels: {} },
    { kind: "refused", reason: null },
    { kind: "error", text: en.previewFailed, retry: true },
    { kind: "prompt", layered: false },
    { kind: "waiting" },
    { kind: "available", preview: base, labels: labelsOf(base) },
  ];
  for (const content of contents) {
    const { node, done } = await render(view(content));
    try {
      assert.equal(node.querySelectorAll("[data-notice=disclaimer]").length, 1, content.kind);
      assert.equal(node.querySelector("[data-notice=disclaimer]")!.textContent?.length ? true : false, true);
    } finally { await done(); }
  }
});

// ---- Story 11.3: the summary bar and sheet ----

const { SharePreviewSummary } = await import("./share-preview.tsx");

async function summary(v: SharePreviewView, over: { locale?: string; showBar?: boolean; focusRoot?: () => void } = {}) {
  const proto = (dom.HTMLDialogElement as unknown as { prototype: object }).prototype as unknown as { showModal?: () => void; close?: () => void };
  const shown: string[] = [];
  proto.showModal = function (this: HTMLDialogElement) { shown.push("modal"); this.setAttribute("open", ""); };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new dom.Event("close") as unknown as Event);
  };
  const locale = over.locale ?? "en";
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const draw = (next: SharePreviewView, showBar = over.showBar ?? true) =>
    act(async () => root.render(<SharePreviewSummary view={next} messages={messages[locale as "en"].interview} locale={locale} showBar={showBar} focusRoot={over.focusRoot} />));
  await draw(v);
  return { node, shown, draw, done: async () => { await act(async () => root.unmount()); node.remove(); } };
}

const ready = () => { const preview = available("Hanbali wife and son with an estate"); return view({ kind: "available", preview, labels: labelsOf(preview) }, { heirCount: 3 }); };
const bar = (node: Element) => node.querySelector<HTMLElement>("[data-summary-bar]");

test("the bar shows only for the root estate with shares, a refusal or a failure", async () => {
  const preview = available("Hanbali wife and son with an estate");
  const choose = parsePreview(previewFixture("Differ: grandfather and full brother").response) as Extract<Preview, { status: "choose_school" }>;
  const hidden: PreviewContent[] = [{ kind: "prompt", layered: false }, { kind: "waiting" }, { kind: "none" }];
  for (const content of hidden) {
    const r = await summary(view(content, { state: "idle" }));
    try { assert.equal(bar(r.node), null, content.kind); assert.equal(r.node.querySelector("dialog"), null); } finally { await r.done(); }
  }
  const shown: PreviewContent[] = [
    { kind: "available", preview, labels: labelsOf(preview) }, { kind: "choose", preview: choose, labels: {} },
    { kind: "refused", reason: null }, { kind: "error", text: en.previewFailed, retry: true },
  ];
  for (const content of shown) {
    const r = await summary(view(content));
    try {
      assert.ok(bar(r.node), content.kind);
      await r.draw(view(content), false);
      assert.equal(bar(r.node), null, "later estate");
      assert.equal(r.node.querySelector("dialog"), null);
    } finally { await r.done(); }
  }
});

test("the bar text follows the state and never says ready while pending or failed", async () => {
  const v = ready();
  const cases: [Partial<SharePreviewView>, string][] = [
    [{ state: "ready" }, en.previewReadyCount.split("{count}").join("3")],
    [{ state: "choose-school" }, en.previewReadyCount.split("{count}").join("3")],
    [{ state: "pending", pending: true, kept: true }, en.previewWaiting],
    [{ state: "error", kept: true }, en.previewFailed],
  ];
  for (const [over, text] of cases) {
    const r = await summary({ ...v, ...over });
    try { assert.equal(bar(r.node)!.querySelector("[data-summary-text]")!.textContent, text, String(over.state)); assert.equal(r.node.querySelector("[aria-live]"), null); } finally { await r.done(); }
  }
});

test("Full results links to the locale results page, apart from the chevron", async () => {
  for (const locale of ["en", "ar", "fr"] as const) {
    const r = await summary(ready(), { locale });
    try {
      const link = bar(r.node)!.querySelector("a")!;
      assert.equal(link.getAttribute("href"), `/${locale}/results/`);
      assert.equal(link.textContent, messages[locale].interview.previewResultsLink);
      await act(async () => { link.click(); });
      assert.equal(r.shown.length, 0);
      const chevron = bar(r.node)!.querySelector("button")!;
      assert.equal(chevron.getAttribute("aria-label"), messages[locale].interview.previewHeading);
      assert.equal(chevron.getAttribute("aria-haspopup"), "dialog");
      assert.equal(chevron.getAttribute("aria-expanded"), "false");
      assert.ok(chevron.className.includes("min-h-11") && chevron.className.includes("min-w-11"));
    } finally { await r.done(); }
  }
});

test("the chevron opens a modal sheet with the heading focused, the bar inert and the rows inside", async () => {
  const r = await summary(ready());
  try {
    const chevron = bar(r.node)!.querySelector("button")!;
    await act(async () => { chevron.click(); });
    const dialog = r.node.querySelector("dialog")!;
    assert.deepEqual(r.shown, ["modal"]);
    assert.ok(dialog.hasAttribute("open"));
    const heading = dialog.querySelector("h2#preview-heading")!;
    assert.equal(heading.textContent, en.previewHeading);
    assert.equal(dialog.getAttribute("aria-labelledby"), "preview-heading");
    assert.equal(document.activeElement, heading);
    assert.ok(bar(r.node)!.hasAttribute("inert"));
    assert.equal(chevron.getAttribute("aria-expanded"), "true");
    assert.equal(dialog.querySelectorAll("h3").length, 0, "the body omits its own heading");
    assert.ok(dialog.querySelector("[data-notice=disclaimer]"));
    assert.ok(dialog.querySelectorAll("ul > li").length > 0);
  } finally { await r.done(); }
});

test("the text area of the bar opens the sheet too", async () => {
  const r = await summary(ready());
  try {
    await act(async () => { bar(r.node)!.querySelector<HTMLElement>("[data-summary-text]")!.click(); });
    assert.ok(r.node.querySelector("dialog")!.hasAttribute("open"));
  } finally { await r.done(); }
});

test("Close, a native close (Escape) and a scrim click each close the sheet and return focus to the chevron", async () => {
  const r = await summary(ready());
  try {
    const chevron = bar(r.node)!.querySelector("button")!;
    const dialog = () => r.node.querySelector("dialog")!;
    const open = async () => { await act(async () => { chevron.click(); }); assert.ok(dialog().hasAttribute("open")); };
    const closed = () => {
      assert.equal(dialog().hasAttribute("open"), false);
      assert.equal(bar(r.node)!.hasAttribute("inert"), false);
      assert.equal(document.activeElement, chevron);
      assert.equal(dialog().querySelector("[data-preview-body]"), null);
    };
    await open();
    const close = [...dialog().querySelectorAll("button")].find((b) => b.textContent === en.editClose)!;
    await act(async () => { close.click(); });
    closed();
    await open();
    await act(async () => { dialog().removeAttribute("open"); dialog().dispatchEvent(new dom.Event("close") as unknown as Event); });
    closed();
    await open();
    await act(async () => { dialog().click(); });
    closed();
  } finally { await r.done(); }
});

test("an open sheet stays through waiting, an online error with Retry and a refusal, and the refusal keeps the bar on close", async () => {
  let rootFocused = 0;
  let retried = 0;
  const r = await summary(ready(), { focusRoot: () => { rootFocused += 1; } });
  try {
    await act(async () => { bar(r.node)!.querySelector("button")!.click(); });
    const dialog = () => r.node.querySelector("dialog")!;
    await r.draw(view({ kind: "waiting" }, { state: "pending", pending: true }));
    assert.ok(dialog().hasAttribute("open"));
    assert.ok(dialog().textContent?.includes(en.previewWaiting));
    assert.ok(bar(r.node)!.hasAttribute("inert"));
    assert.equal(bar(r.node)!.querySelector("[data-summary-text]")!.textContent, en.previewWaiting);
    await r.draw(view({ kind: "error", text: en.previewFailed, retry: true }, { state: "error", retry: () => { retried += 1; } }));
    assert.ok(dialog().hasAttribute("open"));
    const retry = [...dialog().querySelectorAll("button")].find((b) => b.textContent === en.previewRetry)!;
    await act(async () => { retry.click(); });
    assert.equal(retried, 1);
    await r.draw(view({ kind: "refused", reason: "Because." }, { state: "refused" }));
    assert.ok(dialog().hasAttribute("open"));
    assert.ok(dialog().textContent?.includes(en.previewUnavailable));
    assert.equal(rootFocused, 0);
    const close = [...dialog().querySelectorAll("button")].find((b) => b.textContent === en.editClose)!;
    await act(async () => { close.click(); });
    assert.equal(bar(r.node)!.querySelector("[data-summary-text]")!.textContent, en.previewUnavailable);
    assert.equal(dialog().hasAttribute("open"), false);
    assert.equal(document.activeElement, bar(r.node)!.querySelector("[data-summary-expand]"));
    assert.equal(rootFocused, 0);
  } finally { await r.done(); }
});

test("a first failure shows the bar with its text and Retry in place of Full results; Retry keeps focus in the bar", async () => {
  let retried = 0;
  const failed = () => view({ kind: "error", text: en.previewFailed, retry: true }, { state: "error", retry: () => { retried += 1; } });
  const r = await summary(view({ kind: "waiting" }, { state: "pending", pending: true }));
  try {
    assert.equal(bar(r.node), null, "no bar before anything settles");
    await r.draw(failed());
    assert.equal(bar(r.node)!.querySelector("[data-summary-text]")!.textContent, en.previewFailed);
    assert.equal(bar(r.node)!.querySelector("a"), null, "no Full results for a failure");
    const retry = bar(r.node)!.querySelector<HTMLButtonElement>("[data-summary-retry]")!;
    assert.equal(retry.textContent, en.previewRetry);
    assert.ok(retry.className.includes("min-h-11"));
    await act(async () => { retry.click(); });
    assert.equal(retried, 1);
    assert.equal(document.activeElement, bar(r.node)!.querySelector("[data-summary-expand]"));
    // The new request keeps the bar (no flicker), saying it is waiting, with no Retry.
    await r.draw(view({ kind: "waiting" }, { state: "pending", pending: true }));
    assert.equal(bar(r.node)!.querySelector("[data-summary-text]")!.textContent, en.previewWaiting);
    assert.equal(bar(r.node)!.querySelector("[data-summary-retry]"), null);
    await r.draw(ready());
    assert.equal(bar(r.node)!.querySelector("a")!.textContent, en.previewResultsLink);
  } finally { await r.done(); }
});

test("a failure with no Retry offered shows its text and no Retry", async () => {
  const r = await summary(view({ kind: "error", text: en.previewThrottled, retry: false }, { state: "error" }));
  try {
    assert.equal(bar(r.node)!.querySelector("[data-summary-text]")!.textContent, en.previewThrottled);
    assert.equal(bar(r.node)!.querySelector("[data-summary-retry]"), null);
  } finally { await r.done(); }
});

test("a refusal shows the bar with Full results, and the sheet gives the served reason", async () => {
  const r = await summary(view({ kind: "refused", reason: "Because." }, { state: "refused" }));
  try {
    assert.equal(bar(r.node)!.querySelector("[data-summary-text]")!.textContent, en.previewUnavailable);
    assert.equal(bar(r.node)!.querySelector("a")!.getAttribute("href"), "/en/results/");
    await act(async () => { bar(r.node)!.querySelector<HTMLButtonElement>("[data-summary-expand]")!.click(); });
    assert.ok(r.node.querySelector("dialog")!.textContent?.includes("Because."));
  } finally { await r.done(); }
});

test("leaving the root estate closes an open sheet", async () => {
  const r = await summary(ready());
  try {
    await act(async () => { bar(r.node)!.querySelector("button")!.click(); });
    await r.draw(ready(), false);
    assert.equal(r.node.querySelector("dialog"), null);
    await r.draw(ready(), true);
    assert.equal(r.node.querySelector("dialog")!.hasAttribute("open"), false, "does not reopen by itself");
  } finally { await r.done(); }
});

test("the one status node is moved into the open dialog's slot and back on close", async () => {
  const { createPortal } = await import("react-dom");
  const { useState } = await import("react");
  const proto = (dom.HTMLDialogElement as unknown as { prototype: object }).prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  proto.close = function (this: HTMLDialogElement) { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new dom.Event("close") as unknown as Event); };
  function Host() {
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    const status = <p role="status" aria-live="polite">said</p>;
    return (
      <div>
        {slot ? createPortal(status, slot) : status}
        <SharePreviewSummary view={ready()} messages={en as never} locale="en" showBar onStatusSlot={setSlot} />
      </div>
    );
  }
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(<Host />));
    assert.equal(node.querySelectorAll("[role=status]").length, 1);
    assert.equal(node.querySelector("dialog [role=status]"), null);
    await act(async () => { bar(node)!.querySelector("button")!.click(); });
    assert.equal(node.querySelectorAll("[role=status]").length, 1);
    assert.ok(node.querySelector("dialog [role=status]"));
    const close = [...node.querySelectorAll("dialog button")].find((b) => b.textContent === en.editClose)!;
    await act(async () => { (close as HTMLElement).click(); });
    assert.equal(node.querySelectorAll("[role=status]").length, 1);
    assert.equal(node.querySelector("dialog [role=status]"), null);
  } finally { await act(async () => root.unmount()); node.remove(); }
});

test("a choose-school sheet shows the School choice, and an error with kept rows shows Retry", async () => {
  const choose = parsePreview(previewFixture("Differ: grandfather and full brother").response) as Extract<Preview, { status: "choose_school" }>;
  let r = await summary(view({ kind: "choose", preview: choose, labels: {} }, { state: "choose-school" }));
  try {
    await act(async () => { bar(r.node)!.querySelector("button")!.click(); });
    assert.ok(r.node.querySelector("dialog [data-school-choice]"));
  } finally { await r.done(); }
  let retried = 0;
  const kept = { ...ready(), state: "error" as const, kept: true, retry: () => { retried += 1; } };
  r = await summary(kept);
  try {
    await act(async () => { bar(r.node)!.querySelector("button")!.click(); });
    const dialog = r.node.querySelector("dialog")!;
    assert.ok(dialog.querySelectorAll("ul > li").length > 0);
    assert.ok(dialog.textContent?.includes(en.previewFailed));
    const retry = [...dialog.querySelectorAll("button")].find((b) => b.textContent === en.previewRetry)!;
    await act(async () => { retry.click(); });
    assert.equal(retried, 1);
  } finally { await r.done(); }
});

test("agreement is the teal line above the rows, with no Calculated under line", async () => {
  const base = available("Hanbali wife and son with an estate");
  const line = { code: "same_in_all_schools" as const, text: "Same result in all four Sunni schools" };
  const preview: Available = { ...base, presented: { ...base.presented!, comparison_outcome: "agreement", school_line: line } };
  const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }));
  try {
    const agreement = node.querySelector("[data-school-agreement]")!;
    assert.equal(agreement.textContent, line.text);
    assert.ok(agreement.className.includes("text-accent"));
    assert.ok(agreement.compareDocumentPosition(node.querySelector("ul")!) & 4, "the line precedes the rows");
    assert.ok(!(node.textContent ?? "").includes("Calculated under"));
  } finally { await done(); }
});

test("a difference names the School after the rows and shows no agreement line", async () => {
  const base = available("Hanbali wife and son with an estate");
  const presented = JSON.parse(readFileSync(new URL("../../../../../contracts/fixtures/presented_result/school-difference.json", import.meta.url), "utf8"));
  const preview: Available = { ...base, presented };
  const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }));
  try {
    assert.equal(node.querySelector("[data-school-agreement]"), null);
    const rows = node.querySelector("ul")!;
    const line = [...node.querySelectorAll("p")].find((p) => p.textContent === en.previewSchool.split("{school}").join(presented.school_line.text));
    assert.ok(line, "the School line names Maliki");
    assert.ok(rows.compareDocumentPosition(line) & 4, "the School line follows the rows");
    for (const row of presented.rows) assert.ok((rows.textContent ?? "").includes(row.share.text));
  } finally { await done(); }
});

test("a refusal by every School lists each distinct refusal and no shares", async () => {
  const { node, done } = await render(view({ kind: "refused", reason: "Because.", refusals: ["First refusal.", "Second refusal."] }, { state: "refused" }));
  try {
    const shown = node.textContent ?? "";
    assert.ok(shown.includes("First refusal.") && shown.includes("Second refusal."));
    assert.ok(!shown.includes("Because."));
    assert.equal(node.querySelector("ul"), null);
  } finally { await done(); }
});

// ---- Story 11.4: compact landscape ----

function stubCompact(initial: boolean) {
  const w = window as unknown as { matchMedia: unknown };
  const original = w.matchMedia;
  let matches = initial;
  const handlers = new Set<() => void>();
  w.matchMedia = () => ({
    get matches() { return matches; },
    addEventListener: (_: string, h: () => void) => { handlers.add(h); },
    removeEventListener: (_: string, h: () => void) => { handlers.delete(h); },
  });
  return {
    async set(next: boolean) { matches = next; await act(async () => { for (const h of [...handlers]) h(); }); },
    restore() { w.matchMedia = original; },
  };
}
const inflow = (node: Element) => node.querySelector<HTMLButtonElement>("[data-summary-open]");

test("compact landscape renders the in-flow button and no bar, and the button opens the sheet and gets focus back", async () => {
  const media = stubCompact(true);
  const r = await summary(ready());
  try {
    assert.equal(bar(r.node), null);
    const button = inflow(r.node)!;
    assert.equal(button.textContent, en.previewHeading);
    assert.equal(button.getAttribute("aria-haspopup"), "dialog");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    await act(async () => { button.click(); });
    assert.ok(r.node.querySelector("dialog")!.hasAttribute("open"));
    assert.equal(button.getAttribute("aria-expanded"), "true");
    const close = [...r.node.querySelectorAll("dialog button")].find((b) => b.textContent === en.editClose) as HTMLElement;
    await act(async () => { close.click(); });
    assert.equal(document.activeElement, button);
  } finally { await r.done(); media.restore(); }
});

test("compact mode follows the bar's visibility rule", async () => {
  const media = stubCompact(true);
  const r = await summary(view({ kind: "waiting" }, { state: "idle" }));
  try {
    assert.equal(inflow(r.node), null);
    await r.draw(ready(), false);
    assert.equal(inflow(r.node), null);
  } finally { await r.done(); media.restore(); }
});

test("a mode change keeps the sheet open and moves focus between openers", async () => {
  const media = stubCompact(false);
  const r = await summary(ready());
  try {
    const chevron = bar(r.node)!.querySelector<HTMLButtonElement>("[data-summary-expand]")!;
    await act(async () => { chevron.focus(); });
    await media.set(true);
    assert.equal(bar(r.node), null);
    assert.equal(document.activeElement, inflow(r.node));
    await media.set(false);
    assert.equal(document.activeElement, bar(r.node)!.querySelector("[data-summary-expand]"));
    await act(async () => { bar(r.node)!.querySelector<HTMLButtonElement>("[data-summary-expand]")!.click(); });
    const dialog = r.node.querySelector("dialog")!;
    await media.set(true);
    assert.equal(r.node.querySelector("dialog"), dialog, "the dialog is not remounted");
    assert.ok(dialog.hasAttribute("open"));
    const close = [...dialog.querySelectorAll("button")].find((b) => b.textContent === en.editClose) as HTMLElement;
    await act(async () => { close.click(); });
    assert.equal(document.activeElement, inflow(r.node));
  } finally { await r.done(); media.restore(); }
});

test("the sheet shows the served rounding adjustment as its own line after the rows, and none at zero", async () => {
  const cases = [
    ["Two wives and a son, rounded half up", true],
    ["Hanbali wife and three sons need correction", true],
    ["Agree: wife, son and daughter in every school", false],
  ] as const;
  for (const [title, expected] of cases) {
    const preview = available(title);
    const served = preview.presented!.rounding;
    assert.equal(served !== null, expected, title);
    const { node, done } = await render(view({ kind: "available", preview, labels: labelsOf(preview) }));
    try {
      const line = node.querySelector("[data-rounding]");
      if (!served) { assert.equal(line, null, title); continue; }
      assert.equal(line!.textContent, `${en.previewRounding}: ${served.text}`);
      assert.equal(line!.querySelector("bdi")!.getAttribute("dir"), "auto");
      assert.equal(line!.closest("li"), null);
      const list = node.querySelector("ul")!;
      assert.ok(list.compareDocumentPosition(line!) & 4, "after the rows");
    } finally { await done(); }
  }
  assert.equal(available("Two wives and a son, rounded half up").presented!.rounding!.text, "-SAR0.01");
  const positive = available("Hanbali wife and three sons need correction").presented!.rounding!.text;
  assert.equal(positive, "SAR0.01");
  const { node, done } = await render(view({ kind: "available", preview: available("Hanbali wife and three sons need correction"), labels: labelsOf(available("Hanbali wife and three sons need correction")) }));
  try {
    const text = node.querySelector("[data-rounding]")!.textContent;
    assert.equal(text, `${en.previewRounding}: SAR0.01`);
    assert.ok(!text!.includes("-"));
  } finally { await done(); }
});
