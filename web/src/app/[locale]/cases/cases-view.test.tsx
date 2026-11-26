import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { installDom, teardownDom } from "@/test/dom";
import type { Window } from "happy-dom";
import { messages } from "@/i18n/messages";

const text = messages["en"];

let dom: Window;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

before(() => {
  dom = installDom("http://localhost/en/cases/");
  document.cookie = "csrftoken=test-csrf-token";
  (globalThis as Record<string, unknown>).fetch = () => Promise.reject(new Error("not set up"));
});

after(() => teardownDom(dom));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as Record<string, unknown>).__mockRouter = undefined;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  (globalThis as Record<string, unknown>).fetch = () => Promise.reject(new Error("not set up"));
  (globalThis as Record<string, unknown>).__mockRouter = undefined;
});

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
  });
}

const savedRow = { id: 1, name: "Mother's estate", updated_at: "2026-11-01T00:00:00Z", madhab: "hanbali", heir_count: 2, status: "draft" };

// Minimal valid case body for openSavedCase (parseCase needs body.case.{id,started_at})
const caseBody = { case: { id: "case-1", started_at: "2026-11-01T00:00:00Z" } };

const firstOpen = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text.cases.open) ?? null;

const { CasesView } = await import("./cases-view.tsx");

test("openSavedCase success: router.push called with interview URL", async () => {
  const pushCalls: string[] = [];
  (globalThis as Record<string, unknown>).__mockRouter = { push(url: string) { pushCalls.push(url); }, replace() {}, prefetch() {} };

  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    if (url.includes("/api/v1/session/")) {
      return Promise.resolve(new Response(JSON.stringify({ authenticated: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.endsWith("/api/v1/case/")) {
      return Promise.resolve(new Response(JSON.stringify({ case: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    // listSavedCases: GET to /api/v1/saved-cases/
    if (url.endsWith("/api/v1/saved-cases/") || url.includes("/api/v1/saved-cases/?")) {
      return Promise.resolve(new Response(JSON.stringify({ cases: [savedRow] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    // openSavedCase: POST to /api/v1/saved-cases/{id}/open/
    if (url.includes("/api/v1/saved-cases/") && url.includes("/open/") && init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify(caseBody), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };

  await act(() => {
    root.render(<CasesView locale="en" text={text} />);
  });
  await settle();
  await settle();

  const openBtn = firstOpen();
  assert.ok(openBtn, "Open button should be present after rows load");
  const label = container.querySelector("li bdi");
  assert.equal(label?.textContent, "Mother's estate", "the row is labelled by the stored name");
  assert.equal(label?.getAttribute("dir"), "auto");
  assert.ok(container.querySelector("li")!.textContent!.includes(text.cases.updated), "the date stays");

  await act(() => { openBtn.click(); });
  await settle();

  assert.ok(pushCalls.some((u) => u.includes("/en/interview/")), `router.push should be called with /en/interview/; got: ${JSON.stringify(pushCalls)}`);
});

test("openSavedCase failure: router.push NOT called", async () => {
  const pushCalls: string[] = [];
  (globalThis as Record<string, unknown>).__mockRouter = { push(url: string) { pushCalls.push(url); }, replace() {}, prefetch() {} };

  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    if (url.includes("/api/v1/session/")) {
      return Promise.resolve(new Response(JSON.stringify({ authenticated: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.endsWith("/api/v1/case/")) {
      return Promise.resolve(new Response(JSON.stringify({ case: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.endsWith("/api/v1/saved-cases/") || url.includes("/api/v1/saved-cases/?")) {
      return Promise.resolve(new Response(JSON.stringify({ cases: [savedRow] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    // openSavedCase: returns 404 → result null
    if (url.includes("/api/v1/saved-cases/") && url.includes("/open/")) {
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };

  await act(() => {
    root.render(<CasesView locale="en" text={text} />);
  });
  await settle();
  await settle();

  const openBtn = firstOpen();
  assert.ok(openBtn, "Open button should be present");

  await act(() => { openBtn.click(); });
  await settle();

  assert.strictEqual(pushCalls.length, 0, "router.push should NOT be called when openSavedCase fails");
});


test("Shared with me links to the account-bound read-only view", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("session/")) return Response.json({ authenticated: true });
    if (url.includes("received/")) return Response.json({ received: [{ id: 9, owner: "Case Owner", updated_at: "2026-11-01", expires_at: "2026-12-01" }] });
    return Response.json({ cases: [] });
  };
  await act(async () => root.render(<CasesView locale="en" text={text} />));
  await settle(); await settle();
  assert.ok(container.textContent?.includes("Shared with me"));
  assert.ok(container.textContent?.includes("Case Owner"));
  assert.equal(container.querySelector('a[href="/en/received/#9"]')?.textContent, "View draft");
  const item = container.querySelector('a[href="/en/received/#9"]')!.closest("li")!;
  assert.deepEqual([...item.querySelectorAll("a")].map((a) => a.textContent), ["View draft"]);
  assert.equal(item.querySelectorAll("button").length, 0, "no Open or Rename on a received row");
});

// The working copy: revision 3 and a saved link at `saved` (undefined: field absent; null: no link).
function workingCase(saved: unknown, extra: Record<string, unknown> = {}) {
  return { case: { id: "work-1", revision: 3, started_at: "2026-11-01T00:00:00Z", deceased: { gender: "male", estate: null }, heirs: [], ...extra, ...(saved === undefined ? {} : { saved }) } };
}

type Scenario = { caseGet: () => Response | Promise<Response>; open: (init?: RequestInit) => Response };

async function runPrompt(scenario: Scenario) {
  const pushCalls: string[] = [];
  const opens: string[] = [];
  (globalThis as Record<string, unknown>).__mockRouter = { push(url: string) { pushCalls.push(url); }, replace() {}, prefetch() {} };
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    if (url.includes("/api/v1/session/")) return json({ authenticated: true });
    if (url.endsWith("/api/v1/case/")) return Promise.resolve(scenario.caseGet());
    if (url.includes("/open/")) { opens.push(String(init?.body)); return Promise.resolve(scenario.open(init)); }
    if (url.includes("/api/v1/saved-cases/")) return json({ cases: [savedRow] });
    return json({});
  };
  await act(() => { root.render(<CasesView locale="en" text={text} />); });
  await settle();
  await settle();
  const openBtn = firstOpen()!;
  await act(() => { openBtn.click(); });
  await settle();
  return { pushCalls, opens, openBtn };
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const buttonWith = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("dialog button")].find((b) => b.textContent === label)!;

test("an unsaved working copy asks; Cancel sends no open request and keeps the copy", async () => {
  const run = await runPrompt({ caseGet: () => ok(workingCase({ revision: 2 })), open: () => ok(caseBody) });
  assert.ok(container.querySelector("dialog h2")?.textContent === text.cases.discardTitle);
  assert.equal(run.opens.length, 0);
  await act(() => { buttonWith(text.cases.discardNo).click(); });
  await settle();
  assert.equal(run.opens.length, 0);
  assert.equal(run.pushCalls.length, 0);
  assert.equal(container.querySelector("dialog h2"), null);
});

test("Confirm opens and names the revision the visitor was shown", async () => {
  const run = await runPrompt({ caseGet: () => ok(workingCase({ revision: null })), open: () => ok(caseBody) });
  await act(() => { buttonWith(text.cases.discardYes).click(); });
  await settle();
  assert.deepEqual(JSON.parse(run.opens[0]), { case_id: "work-1", expected_revision: 3 });
  assert.ok(run.pushCalls.some((u) => u.includes("/en/interview/")));
});

test("a clean linked copy, an empty copy and no copy open with no prompt", async () => {
  for (const body of [workingCase({ revision: 3 }), workingCase(null, { deceased: null, heirs: [] }), { case: null }]) {
    const run = await runPrompt({ caseGet: () => ok(body), open: () => ok(caseBody) });
    assert.equal(container.querySelector("dialog h2"), null);
    assert.equal(run.opens.length, 1);
    assert.ok(run.pushCalls.length === 1);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
  }
});

test("a never-saved copy with a deceased asks", async () => {
  const run = await runPrompt({ caseGet: () => ok(workingCase(null)), open: () => ok(caseBody) });
  assert.equal(container.querySelector("dialog h2")?.textContent, text.cases.discardTitle);
  assert.equal(run.opens.length, 0);
});

test("an unreadable state asks, and Confirm opens without a check", async () => {
  const run = await runPrompt({ caseGet: () => new Response("{}", { status: 500 }), open: () => ok(caseBody) });
  assert.equal(container.querySelector("dialog h2")?.textContent, text.cases.discardTitle);
  await act(() => { buttonWith(text.cases.discardYes).click(); });
  await settle();
  assert.equal(run.opens[0], "{}");
});

for (const [label, refreshed] of [
  ["clean", () => workingCase({ revision: 9 }, { id: "work-2" })],
  ["absent", () => ({ case: null })],
  ["dirty", () => workingCase({ revision: 1 }, { id: "work-2" })],
] as const) {
  test(`a 409 on Confirm asks again with a ${label} refresh and opens only on the second Confirm`, async () => {
    let reads = 0;
    let posts = 0;
    const run = await runPrompt({
      caseGet: () => ok(++reads === 1 ? workingCase({ revision: 1 }) : refreshed()),
      open: () => ok(++posts === 1 ? { error: "conflict", case: null } : caseBody, posts === 1 ? 409 : 200),
    });
    await act(() => { buttonWith(text.cases.discardYes).click(); });
    await settle();
    assert.equal(run.pushCalls.length, 0);
    assert.equal(run.opens.length, 1);
    assert.equal(container.querySelector("dialog h2")?.textContent, text.cases.discardTitle);
    assert.equal(reads, 2);
    await act(() => { buttonWith(text.cases.discardYes).click(); });
    await settle();
    assert.equal(run.opens.length, 2);
    const second = JSON.parse(run.opens[1]);
    const shown = refreshed().case as { id: string; revision?: number } | null;
    assert.deepEqual(second, shown ? { case_id: shown.id, expected_revision: shown.revision ?? 3 } : { case_id: null });
    assert.ok(run.pushCalls.some((u) => u.includes("/en/interview/")));
  });
}

test("leaving the page while the state read is pending sends no open and does not navigate", async () => {
  let release: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  const pushCalls: string[] = [];
  const opens: string[] = [];
  (globalThis as Record<string, unknown>).__mockRouter = { push(url: string) { pushCalls.push(url); }, replace() {}, prefetch() {} };
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    if (url.includes("/api/v1/session/")) return Promise.resolve(ok({ authenticated: true }));
    if (url.endsWith("/api/v1/case/")) return pending;
    if (url.includes("/open/")) { opens.push(String(init?.body)); return Promise.resolve(ok(caseBody)); }
    if (url.includes("/api/v1/saved-cases/")) return Promise.resolve(ok({ cases: [savedRow] }));
    return Promise.resolve(ok({}));
  };
  await act(() => { root.render(<CasesView locale="en" text={text} />); });
  await settle();
  await settle();
  await act(() => { firstOpen()!.click(); });
  await act(async () => { root.unmount(); });
  release(ok(workingCase({ revision: 3 })));
  await settle();
  root = createRoot(container);
  assert.equal(opens.length, 0);
  assert.equal(pushCalls.length, 0);
});

test("after a failed open the focus returns to the pressed Open button", async () => {
  const run = await runPrompt({ caseGet: () => ok(workingCase({ revision: 3 })), open: () => ok({}, 500) });
  await settle();
  assert.equal(run.opens.length, 1);
  assert.equal(run.openBtn.disabled, false);
  assert.equal(document.activeElement, run.openBtn);
});

test("opening the linked row again while unsaved asks the same", async () => {
  const run = await runPrompt({ caseGet: () => ok(workingCase({ revision: 2 })), open: () => ok(caseBody) });
  await act(() => { buttonWith(text.cases.discardNo).click(); });
  await settle();
  await act(() => { run.openBtn.click(); });
  await settle();
  assert.equal(container.querySelector("dialog h2")?.textContent, text.cases.discardTitle);
  assert.equal(run.opens.length, 0);
});

// ---- Story 10.2: names, sort, rename, skeleton and retry ----
type Row = Record<string, unknown>;
const row = (id: number, name: string | undefined, updated: string, revision: number | null = 1): Row => ({ id, ...(name === undefined ? {} : { name }), updated_at: updated, ...(revision === null ? {} : { revision }), madhab: "hanafi", heir_count: 1, status: "draft" });
type Listing = { list?: () => Response | Promise<Response>; rename?: (body: Record<string, unknown>) => Response | Promise<Response>; locale?: string };
async function mountList(rows: Row[], extra: Listing = {}) {
  const renames: Record<string, unknown>[] = [];
  let lists = 0;
  (globalThis as Record<string, unknown>).__mockRouter = { push() {}, replace() {}, prefetch() {} };
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const json = (body: unknown, status = 200) => Promise.resolve(ok(body, status));
    if (url.includes("/api/v1/session/")) return json({ authenticated: true });
    if (url.includes("received/")) return json({ received: [] });
    if (url.includes("/rename/")) { const body = JSON.parse(String(init?.body)); renames.push(body); return Promise.resolve(extra.rename ? extra.rename(body) : ok({}, 500)); }
    if (url.endsWith("/api/v1/saved-cases/")) { lists++; return Promise.resolve(extra.list ? extra.list() : ok({ cases: rows })); }
    return json({});
  };
  const locale = extra.locale ?? "en";
  await act(() => { root.render(<CasesView locale={locale} text={messages[locale as "en"]} />); });
  await settle();
  await settle();
  return { renames, lists: () => lists };
}
const labels = () => [...container.querySelectorAll("ul:first-of-type > li > div > span.font-semibold bdi")].map((node) => node.textContent);
const renameButton = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("id")?.startsWith("rename-") && b.textContent === text.cases.rename.replace("{name}", name))!;
async function type(value: string) {
  const input = container.querySelector<HTMLInputElement>("form input")!;
  await act(async () => {
    // React tracks the value it last rendered; clear that so the typed value counts as a change.
    input.value = value;
    (input as unknown as { _valueTracker?: { setValue(value: string): void } })._valueTracker?.setValue("\u0000");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // React's change plugin also reads the focused field on key events, which happy-dom delivers reliably.
    input.focus();
    input.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}
const submitForm = () => act(async () => { container.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event); });
const field = () => container.querySelector<HTMLInputElement>("form input");
async function chooseSort(value: string) {
  const select = container.querySelector<HTMLSelectElement>("#cases-sort")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
  });
}

test("rows show the name, the untitled label for a blank one, and default to newest change first", async () => {
  await mountList([row(1, "Older", "2026-11-01T00:00:00Z"), row(2, "", "2026-11-03T00:00:00Z"), row(3, "Newest", "2026-11-05T00:00:00Z")]);
  assert.deepEqual(labels(), ["Newest", text.cases.untitled, "Older"]);
  assert.equal(container.querySelector("li bdi")?.getAttribute("dir"), "auto");
  assert.equal(container.querySelector<HTMLSelectElement>("#cases-sort")!.value, "recent");
});

test("a single row shows no sort control", async () => {
  await mountList([row(1, "Only", "2026-11-01T00:00:00Z")]);
  assert.equal(container.querySelector("#cases-sort"), null);
});

test("sorting by name uses the Locale collation and breaks ties by newest change then id", async () => {
  await mountList([row(1, "b", "2026-11-01T00:00:00Z"), row(2, "Á", "2026-11-02T00:00:00Z"), row(3, "a", "2026-11-03T00:00:00Z"), row(4, "a", "2026-11-03T00:00:00Z"), row(5, "a", "2026-11-04T00:00:00Z")]);
  await chooseSort("name");
  const ids = [...container.querySelectorAll("ul:first-of-type > li")].map((li) => li.querySelector("[id^=saved-]")!.id);
  const aFirst = new Intl.Collator("en").compare("a", "Á") < 0;
  assert.deepEqual(ids, [...(aFirst ? ["saved-5", "saved-4", "saved-3", "saved-2"] : ["saved-2", "saved-5", "saved-4", "saved-3"]), "saved-1"]);
});

test("sorting by name in Arabic follows the ar collation, not the en one", async () => {
  const names = ["a", "ا", "b", "ب"];
  const ar = [...names].sort(new Intl.Collator("ar").compare);
  const en = [...names].sort(new Intl.Collator("en").compare);
  assert.notDeepEqual(ar, en, "the runtime must order these differently in ar and en");
  await mountList(names.map((name, index) => row(index + 1, name, `2026-11-0${index + 1}T00:00:00Z`)), { locale: "ar" });
  await chooseSort("name");
  assert.deepEqual(labels(), ar);
});

test("Rename is hidden for a row without a revision", async () => {
  await mountList([row(1, "Old server", "2026-11-01T00:00:00Z", null), row(2, "New server", "2026-11-02T00:00:00Z", 3)]);
  assert.equal(container.querySelectorAll("[id^=rename-]").length, 1);
  assert.ok(renameButton("New server"));
});

test("rename success shows the new name only after the 200 and sends the revision", async () => {
  let release: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  const run = await mountList([row(1, "Old", "2026-11-01T00:00:00Z", 3)], { rename: () => pending });
  await act(() => { renameButton("Old").click(); });
  assert.equal(document.activeElement, field());
  await type("  New name ");
  await submitForm();
  assert.deepEqual(run.renames, [{ name: "New name", expected_revision: 3 }]);
  assert.deepEqual(labels(), ["Old"], "the stored label remains visible while saving");
  assert.ok(container.textContent!.includes(text.cases.renameSaving));
  await submitForm();
  assert.equal(run.renames.length, 1, "a second press while saving sends nothing");
  release(ok({ id: 1, name: "New name", updated_at: "2026-11-09T00:00:00Z", revision: 4 }));
  await settle();
  assert.deepEqual(labels(), ["New name"]);
  assert.equal(field(), null);
  assert.equal(document.activeElement, renameButton("New name"));
});

test("a later rename uses the revision the first one returned", async () => {
  const run = await mountList([row(1, "Old", "2026-11-01T00:00:00Z", 3)], { rename: (body) => ok({ id: 1, name: String(body.name), updated_at: "2026-11-09T00:00:00Z", revision: Number(body.expected_revision) + 1 }) });
  for (const name of ["One", "Two"]) {
    await act(() => { container.querySelector<HTMLButtonElement>("[id^=rename-]")!.click(); });
    await type(name);
    await submitForm();
    await settle();
  }
  assert.deepEqual(run.renames.map((body) => body.expected_revision), [3, 4]);
});

test("a failed, refused or conflicting rename shows no new name and keeps the text", async () => {
  const cases: [string, () => Response, string][] = [
    ["failure", () => ok({}, 500), text.cases.renameFailed],
    ["too long", () => ok({ errors: { name: "too_long" } }, 400), text.results.nameTooLong],
    ["invalid", () => ok({ errors: { name: "invalid" } }, 400), text.results.nameInvalid],
    ["conflict", () => ok({ code: "rename_conflict", revision: 5, name: "Stored elsewhere" }, 409), text.cases.renameConflict],
  ];
  for (const [label, response, message] of cases) {
    const run = await mountList([row(1, "Old", "2026-11-01T00:00:00Z", 3)], { rename: response });
    await act(() => { renameButton("Old").click(); });
    await type("Typed text");
    await submitForm();
    await settle();
    assert.equal(field()?.value, "Typed text", `${label}: the text stays`);
    assert.ok(container.textContent!.includes(message), `${label}: message`);
    if (label === "conflict") {
      assert.deepEqual(labels(), ["Stored elsewhere"]);
      await submitForm();
      await settle();
      assert.deepEqual(run.renames.map((body) => body.expected_revision), [3, 5], "Save again retries with the adopted revision");
    } else {
      assert.deepEqual(labels(), ["Old"]);
    }
    await act(async () => { root.unmount(); });
    root = createRoot(container);
  }
});

test("Escape and Cancel restore the label and return focus to Rename", async () => {
  await mountList([row(1, "Old", "2026-11-01T00:00:00Z", 3)]);
  await act(() => { renameButton("Old").click(); });
  await type("Changed");
  await act(async () => { field()!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event); });
  assert.equal(field(), null);
  assert.deepEqual(labels(), ["Old"]);
  assert.equal(document.activeElement, renameButton("Old"));
  await act(() => { renameButton("Old").click(); });
  await act(() => { [...container.querySelectorAll<HTMLButtonElement>("form button")].find((b) => b.textContent === text.cases.renameCancel)!.click(); });
  assert.equal(field(), null);
  assert.equal(document.activeElement, renameButton("Old"));
});

test("the owned list shows a skeleton with aria-busy while loading", async () => {
  let release: (response: Response) => void = () => {};
  await mountList([], { list: () => new Promise<Response>((resolve) => { release = resolve; }) });
  const busy = container.querySelector('[aria-busy="true"]');
  assert.ok(busy);
  assert.ok(busy!.textContent!.includes(text.cases.loading));
  release(ok({ cases: [row(1, "Done", "2026-11-01T00:00:00Z")] }));
  await settle();
  assert.equal(container.querySelector('[aria-busy="true"]'), null);
});

test("an empty list and a failed list are different, and Retry refetches", async () => {
  await mountList([]);
  assert.ok(container.textContent!.includes(text.cases.empty));
  assert.equal(container.querySelector("[role=alert]")!.textContent, "");
  await act(async () => { root.unmount(); });
  root = createRoot(container);
  let fail = true;
  const run = await mountList([], { list: () => (fail ? ok({}, 500) : ok({ cases: [row(1, "Back", "2026-11-01T00:00:00Z")] })) });
  assert.equal(container.querySelector("[role=alert]")!.textContent, text.cases.error);
  assert.ok(!container.textContent!.includes(text.cases.empty));
  const retry = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text.cases.retry)!;
  assert.ok(retry);
  fail = false;
  await act(() => { retry.click(); });
  await settle();
  assert.equal(run.lists(), 2);
  assert.deepEqual(labels(), ["Back"]);
  assert.equal(container.querySelector("[role=alert]")!.textContent, "");
});

test("while a rename saves, other rows cannot start one and Cancel and Escape do nothing; B keeps its text afterwards", async () => {
  let release: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  const run = await mountList([row(1, "A name", "2026-11-02T00:00:00Z", 3), row(2, "B name", "2026-11-01T00:00:00Z", 2)], { rename: () => pending });
  await act(() => { renameButton("A name").click(); });
  await type("A new");
  await submitForm();
  assert.equal(renameButton("B name").disabled, true, "B cannot open Rename while A saves");
  assert.equal(field()!.readOnly, true);
  const cancel = [...container.querySelectorAll<HTMLButtonElement>("form button")].find((b) => b.textContent === text.cases.renameCancel)!;
  assert.equal(cancel.disabled, true);
  await act(async () => { field()!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event); });
  assert.ok(field(), "Escape is ignored while saving");
  release(ok({ id: 1, name: "A new", updated_at: "2026-11-09T00:00:00Z", revision: 4 }));
  await settle();
  assert.equal(field(), null);
  assert.equal(run.renames.length, 1);
  assert.equal(renameButton("B name").disabled, false);
  await act(() => { renameButton("B name").click(); });
  await type("B typed");
  assert.equal(field()?.value, "B typed");
});

test("renaming the oldest row moves it first in Last changed order and updates its date", async () => {
  await mountList([row(1, "Oldest", "2026-11-01T00:00:00Z", 1), row(2, "Mid", "2026-11-02T00:00:00Z", 1), row(3, "New", "2026-11-03T00:00:00Z", 1)], { rename: () => ok({ id: 1, name: "Oldest 2", updated_at: "2026-11-09T12:00:00Z", revision: 2 }) });
  assert.deepEqual(labels(), ["New", "Mid", "Oldest"]);
  await act(() => { renameButton("Oldest").click(); });
  await type("Oldest 2");
  await submitForm();
  await settle();
  assert.deepEqual(labels(), ["Oldest 2", "New", "Mid"]);
  assert.ok(container.querySelector("#saved-1")!.textContent!.includes(new Date("2026-11-09T12:00:00Z").toLocaleString("en")));
});

test("Escape from the Cancel button closes the editor", async () => {
  await mountList([row(1, "Old", "2026-11-01T00:00:00Z", 3)]);
  await act(() => { renameButton("Old").click(); });
  const cancel = [...container.querySelectorAll<HTMLButtonElement>("form button")].find((b) => b.textContent === text.cases.renameCancel)!;
  await act(async () => { cancel.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event); });
  assert.equal(field(), null);
});

test("Open is described by the case name and the date", async () => {
  await mountList([row(7, "Mother's estate", "2026-11-01T00:00:00Z", 3)]);
  const open = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text.cases.open)!;
  assert.equal(open.getAttribute("aria-describedby"), "name-7 saved-7");
  assert.equal(container.querySelector("#name-7")!.textContent, "Mother's estate");
});

// ---- Story 10.3: hand-off, New Case, sign-in resume ----
type Story = { authed?: boolean; caseGet?: () => Response; open?: () => Response; start?: (body: Record<string, unknown>) => Response; rows?: Row[]; session?: () => boolean };
async function mountStory(url: string, story: Story) {
  dom.happyDOM.setURL(url);
  sessionStorage.removeItem("mawareeth.open-handoff");
  const pushCalls: string[] = [];
  const opens: string[] = [];
  const starts: Record<string, unknown>[] = [];
  (globalThis as Record<string, unknown>).__mockRouter = { push(target: string) { pushCalls.push(target); }, replace() {}, prefetch() {} };
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = String(input);
    const json = (body: unknown, status = 200) => Promise.resolve(ok(body, status));
    if (target.includes("/api/v1/session/")) return json({ authenticated: story.session ? story.session() : story.authed !== false });
    if (target.includes("received/")) return json({ received: [] });
    if (target.includes("/open/")) { opens.push(String(init?.body)); return Promise.resolve(story.open ? story.open() : ok(caseBody)); }
    if (target.endsWith("/api/v1/case/") && init?.method === "POST") { starts.push(JSON.parse(String(init.body))); return Promise.resolve(story.start ? story.start(starts[starts.length - 1]) : ok({ case: { id: "fresh-1", started_at: "2026-11-01T00:00:00Z" } }, 201)); }
    if (target.endsWith("/api/v1/case/")) return Promise.resolve(story.caseGet ? story.caseGet() : ok({ case: null }));
    if (target.endsWith("/api/v1/saved-cases/")) return json({ cases: story.rows ?? [savedRow] });
    return json({});
  };
  await act(() => { root.render(<CasesView locale="en" text={text} />); });
  await settle();
  await settle();
  return { pushCalls, opens, starts };
}
const newButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text.cases.newCase)!;
const remount = async () => { await act(async () => { root.unmount(); }); root = createRoot(container); };

test("a successful Open writes the hand-off with the working id before navigating", async () => {
  const run = await mountStory("http://localhost/en/cases/", {});
  await act(() => { firstOpen()!.click(); });
  await settle();
  assert.equal(run.pushCalls.length, 1);
  assert.equal(sessionStorage.getItem("mawareeth.open-handoff"), "case-1");
});

test("a failed Open writes no hand-off", async () => {
  await mountStory("http://localhost/en/cases/", { open: () => ok({}, 404) });
  await act(() => { firstOpen()!.click(); });
  await settle();
  assert.equal(sessionStorage.getItem("mawareeth.open-handoff"), null);
});

test("New Case shows with an empty list and starts plainly when there is no Case", async () => {
  const run = await mountStory("http://localhost/en/cases/", { rows: [] });
  assert.ok(newButton());
  await act(() => { newButton().click(); });
  await settle();
  assert.deepEqual(run.starts, [{}]);
  assert.equal(sessionStorage.getItem("mawareeth.open-handoff"), "fresh-1");
  assert.deepEqual(run.pushCalls, ["/en/interview/"]);
});

test("New Case with a clean working copy replaces it by id and revision, with no prompt", async () => {
  const run = await mountStory("http://localhost/en/cases/", { caseGet: () => ok(workingCase({ revision: 3 })) });
  await act(() => { newButton().click(); });
  await settle();
  assert.equal(container.querySelector("dialog h2"), null);
  assert.deepEqual(run.starts, [{ replace: true, case_id: "work-1", expected_revision: 3 }]);
});

test("New Case with an unsaved copy asks; Cancel starts nothing and Confirm replaces", async () => {
  const run = await mountStory("http://localhost/en/cases/", { caseGet: () => ok(workingCase(null)) });
  await act(() => { newButton().click(); });
  await settle();
  assert.equal(container.querySelector("dialog h2")?.textContent, text.cases.discardTitle);
  await act(() => { buttonWith(text.cases.discardNo).click(); });
  await settle();
  assert.equal(run.starts.length, 0);
  await act(() => { newButton().click(); });
  await settle();
  await act(() => { buttonWith(text.cases.discardConfirmNew).click(); });
  await settle();
  assert.deepEqual(run.starts, [{ replace: true, case_id: "work-1", expected_revision: 3 }]);
  assert.equal(run.pushCalls.length, 1);
});

test("New Case: a 409 asks again with the newer revision and starts on the second Confirm", async () => {
  let reads = 0;
  let posts = 0;
  const conflict = await mountStory("http://localhost/en/cases/", {
    caseGet: () => ok(reads++ === 0 ? workingCase({ revision: 3 }) : workingCase({ revision: 4 }, { revision: 4 })),
    start: () => (posts++ === 0 ? ok(workingCase({ revision: 4 }, { revision: 4 }), 409) : ok({ case: { id: "fresh-1", started_at: "2026-11-01T00:00:00Z" } }, 201)),
  });
  await act(() => { newButton().click(); });
  await settle();
  assert.equal(container.querySelector("dialog h2")?.textContent, text.cases.discardTitle);
  assert.equal(conflict.pushCalls.length, 0);
  assert.equal(buttonWith(text.cases.discardConfirmNew).textContent, text.cases.discardConfirmNew);
  await act(() => { buttonWith(text.cases.discardConfirmNew).click(); });
  await settle();
  assert.deepEqual(conflict.starts, [{ replace: true, case_id: "work-1", expected_revision: 3 }, { replace: true, case_id: "work-1", expected_revision: 4 }]);
  assert.deepEqual(conflict.pushCalls, ["/en/interview/"]);
  assert.equal(sessionStorage.getItem("mawareeth.open-handoff"), "fresh-1");
});

test("New Case: a failure shows the message and stays on the list", async () => {
  const failed = await mountStory("http://localhost/en/cases/", { start: () => ok({}, 500) });
  await act(() => { newButton().click(); });
  await settle();
  assert.equal(container.querySelector("[role=alert]")?.textContent, text.cases.newCaseFailed);
  assert.equal(failed.pushCalls.length, 0);
  assert.equal(sessionStorage.getItem("mawareeth.open-handoff"), null);
});

test("an Open refused with 403 while signed out goes to sign-in keeping ?open=", async () => {
  let probes = 0;
  const run = await mountStory("http://localhost/en/cases/", { open: () => ok({}, 403), session: () => probes++ === 0 });
  await act(() => { firstOpen()!.click(); });
  await settle();
  assert.deepEqual(run.pushCalls, ["/en/login/?next=" + encodeURIComponent("/en/cases/?open=1")]);
});

test("an Open refused with 403 while still signed in shows the generic failure", async () => {
  const run = await mountStory("http://localhost/en/cases/", { open: () => ok({}, 403) });
  await act(() => { firstOpen()!.click(); });
  await settle();
  assert.equal(run.pushCalls.length, 0);
  assert.equal(container.querySelector("[role=alert]")?.textContent, text.cases.error);
});

test("?open= resumes the Open once signed in and the parameter is removed", async () => {
  const run = await mountStory("http://localhost/en/cases/?open=7", {});
  assert.equal(run.opens.length, 1);
  assert.equal(run.pushCalls.length, 1);
  assert.equal(window.location.search, "");
});

test("?open= asks the discard question for an unsaved copy and a 404 shows the failure", async () => {
  const asked = await mountStory("http://localhost/en/cases/?open=7", { caseGet: () => ok(workingCase(null)) });
  assert.equal(container.querySelector("dialog h2")?.textContent, text.cases.discardTitle);
  assert.equal(asked.opens.length, 0);
  await remount();
  const missing = await mountStory("http://localhost/en/cases/?open=7", { open: () => ok({}, 404) });
  assert.equal(missing.pushCalls.length, 0);
  assert.equal(container.querySelector("[role=alert]")?.textContent, text.cases.error);
});

test("an invalid ?open= is ignored but removed", async () => {
  for (const bad of ["abc", "0", "-3", "1.5"]) {
    const run = await mountStory("http://localhost/en/cases/?open=" + bad, {});
    assert.equal(run.opens.length, 0, bad);
    assert.equal(window.location.search, "", bad);
    await remount();
  }
});

test("signed out: no Open call, and the sign-in link keeps ?open=", async () => {
  const run = await mountStory("http://localhost/en/cases/?open=7", { authed: false });
  assert.equal(run.opens.length, 0);
  const link = container.querySelector<HTMLAnchorElement>("a")!;
  assert.equal(link.getAttribute("href"), "/en/login/?next=" + encodeURIComponent("/en/cases/?open=7"));
  assert.equal(window.location.search, "?open=7");
});
