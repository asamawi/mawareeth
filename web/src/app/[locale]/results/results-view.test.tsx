import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { installDom, teardownDom } from "@/test/dom";
import type { Window } from "happy-dom";
import { messages } from "@/i18n/messages";
import { terms } from "@/i18n/catalog.generated";
import { mixedRefusalFixture, previewFixture } from "@/test/preview-fixtures";

const en = messages["en"];
const fixture = previewFixture("Differ: grandfather and full brother");

let dom: Window;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let calls: { url: string; method: string; body?: string }[];
let patchGate: Promise<void> | null = null;
let onLine = true;
let previewBody: unknown = null;
let caseBody: unknown = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

before(() => {
  dom = installDom("http://localhost/en/results/");
  document.cookie = "csrftoken=test-csrf-token";
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });
});
after(() => teardownDom(dom));

beforeEach(() => {
  onLine = true;
  calls = [];
  patchGate = null;
  previewBody = null;
  caseBody = null;
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "PATCH") {
      const reply = json({ case: { ...fixture.case, madhab: "hanafi" } });
      return patchGate ? patchGate.then(() => reply) : Promise.resolve(reply);
    }
    if (url.includes("/api/v1/case/preview/")) return Promise.resolve(json(previewBody ?? fixture.response));
    if (url.includes("/api/v1/case/")) return Promise.resolve(json({ case: caseBody ?? fixture.case }));
    return Promise.resolve(json({}));
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
  });
}

const { ResultsView } = await import("./results-view.tsx");

const writes = () => calls.filter((c) => c.method === "PATCH" || c.method === "POST").length;
function assertOnePatch() {
  const patches = calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].url, "/api/v1/case/");
  const first = document.querySelector<HTMLInputElement>("input[type=radio]")!.value;
  assert.equal(JSON.parse(patches[0].body ?? "{}").madhab, first);
}
const submit = () => container.querySelector<HTMLButtonElement>("button[type=submit]")!;
const notice = () => [...container.querySelectorAll("[role=status]")].find((p) => p.textContent === en.interview.offlineEditing);

async function setOnline(value: boolean) {
  onLine = value;
  await act(async () => { window.dispatchEvent(new window.Event(value ? "online" : "offline")); });
}

async function render() {
  await act(async () => { root.render(<ResultsView messages={en} locale="en" />); });
  await settle();
  assert.ok(container.querySelector("[data-school-choice]"), "the school choice is shown");
}

async function pickAndContinue() {
  const radio = container.querySelector<HTMLInputElement>("input[type=radio]")!;
  await act(async () => { radio.click(); });
  await act(async () => { submit().click(); });
  await settle();
}

test("online: choosing sends one setMadhab request", async () => {
  await render();
  assert.equal(notice(), undefined);
  assert.equal(submit().getAttribute("aria-disabled"), "false");
  await pickAndContinue();
  assertOnePatch();
});

test("offline: no request, Continue is aria-disabled and the status line shows", async () => {
  onLine = false;
  await render();
  assert.ok(notice());
  assert.equal(submit().getAttribute("aria-disabled"), "true");
  await pickAndContinue();
  assert.equal(writes(), 0);
});

test("going offline on the page shows the status line and disables Continue without a reload", async () => {
  await render();
  const before = calls.length;
  await setOnline(false);
  assert.ok(notice());
  assert.equal(submit().getAttribute("aria-disabled"), "true");
  assert.equal(calls.length, before);
});

test("reconnecting removes the line, keeps the picked radio and sends one request", async () => {
  onLine = false;
  await render();
  const radio = container.querySelector<HTMLInputElement>("input[type=radio]")!;
  await act(async () => { radio.click(); });
  await act(async () => { submit().click(); });
  assert.equal(writes(), 0);
  await setOnline(true);
  assert.equal(notice(), undefined);
  assert.equal(submit().getAttribute("aria-disabled"), "false");
  assert.ok(container.querySelector<HTMLInputElement>("input[type=radio]")!.checked, "pick kept");
  await act(async () => { submit().click(); });
  await settle();
  assertOnePatch();
});

test("a submit after the connection dropped, before any offline event, sends nothing", async () => {
  await render();
  const radio = container.querySelector<HTMLInputElement>("input[type=radio]")!;
  await act(async () => { radio.click(); });
  onLine = false;
  assert.equal(submit().getAttribute("aria-disabled"), "false");
  await act(async () => { submit().click(); });
  await settle();
  assert.equal(writes(), 0);
});

test("a save still in flight keeps Continue disabled across a reconnect", async () => {
  let release!: () => void;
  patchGate = new Promise<void>((resolve) => { release = resolve; });
  await render();
  const radio = container.querySelector<HTMLInputElement>("input[type=radio]")!;
  await act(async () => { radio.click(); });
  await act(async () => { submit().click(); });
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
  await setOnline(false);
  await setOnline(true);
  assert.equal(submit().getAttribute("aria-disabled"), "true");
  await act(async () => { release(); });
  await settle();
});

const { Available } = await import("./results-view.tsx");
const { parseServedPreview, parseCase } = await import("@/api/case");
const hanafiCase = () => parseCase({ case: previewFixture("Grandfather and brother under Hanafi").case })!;
const hanafi = previewFixture("Grandfather and brother under Hanafi");
const availablePreview = parseServedPreview(hanafi.response) as Parameters<typeof Available>[0]["preview"];

async function renderAvailable(gate: boolean, result: { kind: "failed" | "download" }) {
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={hanafiCase()} preview={availablePreview} back={null} gate={gate} download={() => Promise.resolve(result as never)} />);
  });
  await settle();
  const pdf = () => [...container.querySelectorAll("button")].find((b) => b.textContent === en.results.pdfDownload || b.textContent === en.results.pdfRetry)!;
  await act(() => { pdf().click(); });
  await settle();
}

test("Full results: a failed PDF is reported on the single status line and the family stays", async () => {
  await renderAvailable(true, { kind: "failed" });
  const lines = [...container.querySelectorAll("[role=status]")].map((p) => p.textContent);
  assert.deepEqual(lines, [en.results.pdfFailed]);
  assert.equal(container.querySelector("[role=alert]"), null);
  assert.ok(container.querySelector("#results-family"));
  assert.ok([...container.querySelectorAll("button")].some((b) => b.textContent === en.results.pdfRetry));
});

test("Shared view (no gate): DraftDownload keeps its own failure alert", async () => {
  await renderAvailable(false, { kind: "failed" });
  assert.equal(container.querySelector("[role=alert]")?.textContent, en.results.pdfFailed);
  assert.equal(container.querySelector("[role=status]"), null);
});

test("Full results: a button-initiated PDF shows busy while pending and blanks the line after success", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  try {
    await act(() => {
      root.render(<Available messages={en} locale="en" kase={hanafiCase()} preview={availablePreview} back={null} gate download={() => pending as never} />);
    });
    await settle();
    const line = container.querySelector("[role=status]")!;
    const pdf = [...container.querySelectorAll("button")].find((b) => b.textContent === en.results.pdfDownload)!;
    await act(() => { pdf.click(); });
    assert.equal(container.querySelector("[role=status]"), line);
    assert.equal(line.textContent, en.results.pdfBusy);
    await act(async () => { finish({ kind: "download", blob: new Blob(["%PDF"]) }); await new Promise<void>((r) => { setTimeout(r, 20); }); });
    assert.equal(container.querySelector("[role=status]"), line);
    assert.equal(line.textContent, "");
  } finally {
    URL.createObjectURL = realCreate;
  }
});

async function renderResultsFixture(title: string) {
  const { case: kase, response } = previewFixture(title);
  const fetchOther = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = String(input);
    if (url.includes("/api/v1/case/preview/")) return Promise.resolve(json(response));
    if (url === "/api/v1/case/") return Promise.resolve(json({ case: kase }));
    return fetchOther(input, init);
  };
  await act(async () => { root.render(<ResultsView messages={en} locale="en" />); });
  await settle();
}

test("Full results: agreement under a chosen school shows the shared school line", async () => {
  await renderResultsFixture("Hanbali wife and son with an estate");
  assert.ok([...container.querySelectorAll("p")].some((p) => p.textContent === "Same result in all four Sunni schools"));
  assert.doesNotMatch(container.textContent ?? "", /Calculated under/);
});

test("Full results: a difference under Maliki names the chosen school", async () => {
  await renderResultsFixture("Maliki mushtaraka shares the third");
  const schoolLine = en.results.school.replace("{school}", "Maliki");
  assert.ok([...container.querySelectorAll("p")].some((p) => p.textContent === schoolLine));
  assert.doesNotMatch(container.textContent ?? "", /Same result in all four Sunni schools/);
});

test("Full results: a partial refusal shows the other schools' shares and leaves Maliki selectable", async () => {
  await renderResultsFixture("Refusal: Malikiyya makes the schools differ");
  const choice = container.querySelector("[data-school-choice]");
  assert.ok(choice);
  assert.equal(choice.querySelector("legend")?.textContent, "Which school of law do you follow?");

  const cards = [...choice.querySelectorAll("li > strong")];
  const maliki = cards.find((label) => label.textContent === "Maliki")?.closest("li");
  assert.ok(maliki);
  assert.equal(
    maliki.querySelector("p")?.textContent,
    "Scholars of the Maliki school disagree about this family (the Malikiyya case), so no shares are shown.",
  );
  assert.equal(maliki.querySelectorAll("ul > li").length, 0);

  const radio = choice.querySelector<HTMLInputElement>('input[type="radio"][value="maliki"]');
  assert.ok(radio);
  assert.equal(radio.matches(":disabled"), false);

  const noShare = en.interview.previewNoShare;
  for (const [school, shares] of [
    ["Hanafi", ["1/2", "1/6", "1/3", noShare, noShare, noShare]],
    ["Shafi'i", ["1/2", "1/6", "1/6", noShare, noShare, "1/6"]],
    ["Hanbali", ["1/2", "1/6", "1/6", noShare, noShare, "1/6"]],
  ] as const) {
    const card = cards.find((label) => label.textContent === school)?.closest("li");
    assert.ok(card, `the ${school} comparison card is shown`);
    const shareRows = [...card.querySelectorAll("ul > li")];
    assert.deepEqual(shareRows.map((row) => row.lastElementChild?.textContent), shares, `${school} shares`);
  }
});

test("all four Schools refusing for different reasons shows each presented refusal and no shares", async () => {
  const mixed = mixedRefusalFixture();
  previewBody = mixed.response;
  caseBody = { ...mixed.case, madhab: null };
  await act(async () => { root.render(<ResultsView messages={en} locale="en" />); });
  await settle();
  const shown = container.textContent ?? "";
  for (const refusal of (mixed.response as { presented: { refusals: { text: string }[] } }).presented.refusals) assert.ok(shown.includes(refusal.text), refusal.text);
  assert.ok(shown.includes(en.interview.previewUnavailable));
  assert.equal(container.querySelector("#results-shares"), null);
});

test("Full results: one action row in order PDF (primary), Save, Share link, WhatsApp (secondary), and a disclaimer notice with no button", async () => {
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={hanafiCase()} preview={availablePreview} back={null} gate download={() => Promise.resolve({ kind: "failed" } as never)} />);
  });
  await settle();
  const saveButton = [...container.querySelectorAll("button")].find((x) => x.textContent === en.results.save)!;
  const row = saveButton.parentElement!;
  const buttons = [...row.querySelectorAll("button")] as HTMLButtonElement[];
  assert.deepEqual(buttons.map((b) => b.textContent), [en.results.pdfDownload, en.results.save, en.results.shareAction, en.results.whatsappAction]);
  assert.ok(buttons[0].className.includes("bg-accent"));
  for (const b of buttons.slice(1)) assert.ok(b.className.includes("border-line") && !b.className.includes("bg-accent"));
  const notice = container.querySelector("[data-notice=disclaimer]")!;
  const servedText = availablePreview.presented?.notices.find((n) => n.code === "disclaimer")?.text;
  assert.equal(notice.textContent, servedText ?? (terms as Record<string, Record<string, string>>).en["notice.disclaimer"]);
  for (const b of buttons) assert.ok(b.className.includes("disabled:opacity-60"));
  assert.equal(notice.querySelector("button"), null);
});

test("Shared view (no gate): PDF is primary, with no Save and no disclaimer", async () => {
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={hanafiCase()} preview={availablePreview} back={null} gate={false} />);
  });
  await settle();
  const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(labels.includes(en.results.pdfDownload));
  assert.ok(!labels.includes(en.results.save));
  assert.equal(container.querySelector("[data-notice=disclaimer]"), null);
  const pdf = [...container.querySelectorAll("button")].find((b) => b.textContent === en.results.pdfDownload)!;
  assert.ok(pdf.className.includes("bg-accent"));
});

test("Full results: a served disclaimer text wins over the catalog", async () => {
  const presented = availablePreview.presented!;
  const preview = { ...availablePreview, presented: { ...presented, notices: [...presented.notices.filter((n) => n.code !== "disclaimer"), { code: "disclaimer", text: "Served disclaimer wording" }] } } as typeof availablePreview;
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={hanafiCase()} preview={preview} back={null} gate />);
  });
  await settle();
  assert.equal(container.querySelector("[data-notice=disclaimer]")?.textContent, "Served disclaimer wording");
});

const catalogEn = (terms as Record<string, Record<string, string>>).en;
const withEstate = (estate: string | null) => {
  const base = hanafiCase();
  return { ...base, deceased: { ...base.deceased!, estate } } as typeof base;
};

test("Full results: the supplied-facts notice follows the disclaimer and precedes the actions, with an amount", async () => {
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={withEstate("1200")} preview={availablePreview} back={null} gate />);
  });
  await settle();
  const notice = container.querySelector("[data-notice=supplied-facts]")!;
  assert.equal(notice.textContent, "The family and the estate amount were entered by the user and have not been verified by Mawareeth.");
  assert.equal(notice.textContent, catalogEn["notice.supplied_facts"]);
  assert.equal(notice.querySelector("button"), null);
  assert.ok(!notice.className.includes("font-semibold"));
  const disclaimer = container.querySelector("[data-notice=disclaimer]")!;
  assert.equal(disclaimer.nextElementSibling, notice);
  const pdf = [...container.querySelectorAll("button")].find((b) => b.textContent === en.results.pdfDownload)!;
  assert.ok(notice.compareDocumentPosition(pdf) & 4);
});

test("Full results: without an amount the no-amount notice shows and mentions no money figure", async () => {
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={withEstate(null)} preview={availablePreview} back={null} gate />);
  });
  await settle();
  const notice = container.querySelector("[data-notice=supplied-facts]")!;
  assert.equal(notice.textContent, catalogEn["notice.supplied_facts_no_amount"]);
  assert.ok(!/\d/.test(notice.textContent!));
});

test("Shared view (no gate): no supplied-facts notice", async () => {
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={withEstate("1200")} preview={availablePreview} back={null} gate={false} />);
  });
  await settle();
  assert.equal(container.querySelector("[data-notice=supplied-facts]"), null);
});

test("Full results and the shared view show the served rounding line after the shares, none at zero", async () => {
  const cases = [
    ["Two wives and a son, rounded half up", true],
    ["Hanbali wife and three sons need correction", true],
    ["Agree: wife, son and daughter in every school", false],
  ] as const;
  for (const [title, expected] of cases) {
    const fx = previewFixture(title);
    const preview = parseServedPreview(fx.response) as Parameters<typeof Available>[0]["preview"];
    const served = preview.presented?.rounding ?? null;
    assert.equal(served !== null, expected, title);
    for (const gate of [true, false]) {
      await act(() => {
        root.render(<Available messages={en} locale="en" kase={parseCase({ case: fx.case })!} preview={preview} back={null} gate={gate} />);
      });
      await settle();
      const line = container.querySelector("[data-rounding]");
      if (!served) { assert.equal(line, null, title); continue; }
      assert.equal(line!.textContent, `${en.interview.previewRounding}: ${served.text}`);
      assert.equal(line!.closest("li"), null);
      assert.equal(line!.closest("section")!.getAttribute("aria-labelledby"), "results-shares");
      assert.equal(line!.querySelector("bdi")!.getAttribute("dir"), "auto");
    }
  }
});

test("Full results shows the unallocated line and the rounding line as two separate elements", async () => {
  const fx = previewFixture("Wife alone leaves an unallocated remainder");
  const body = fx.response as { presented: Record<string, unknown> };
  const response = { ...body, presented: { ...body.presented, rounding: { amount_minor: -1, currency: "SAR", text: "-SAR0.01", dir: "auto" } } };
  const preview = parseServedPreview(response) as Parameters<typeof Available>[0]["preview"];
  await act(() => {
    root.render(<Available messages={en} locale="en" kase={parseCase({ case: fx.case })!} preview={preview} back={null} gate={false} />);
  });
  await settle();
  const section = container.querySelector("section[aria-labelledby=results-shares]")!;
  const rounding = section.querySelector("[data-rounding]")!;
  const unallocated = [...section.querySelectorAll("p")].find((p) => p.textContent?.startsWith(en.interview.previewUnallocated))!;
  assert.ok(unallocated && rounding && unallocated !== rounding);
  assert.ok(unallocated.compareDocumentPosition(rounding) & 4, "rounding after unallocated");
  assert.ok(!unallocated.contains(rounding) && !rounding.contains(unallocated));
});
