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

const savedRow = { id: 1, updated_at: "2026-11-01T00:00:00Z", madhab: "hanbali", heir_count: 2, status: "draft" };

// Minimal valid case body for openSavedCase (parseCase needs body.case.{id,started_at})
const caseBody = { case: { id: "case-1", started_at: "2026-11-01T00:00:00Z" } };

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

  const openBtn = container.querySelector<HTMLButtonElement>("button[type=button]");
  assert.ok(openBtn, "Open button should be present after rows load");

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

  const openBtn = container.querySelector<HTMLButtonElement>("button[type=button]");
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
  const openBtn = container.querySelector<HTMLButtonElement>("button[type=button]")!;
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
  await act(() => { container.querySelector<HTMLButtonElement>("button[type=button]")!.click(); });
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
