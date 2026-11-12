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
