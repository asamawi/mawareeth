import { test, before, after } from "node:test";
import assert from "node:assert/strict";
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
