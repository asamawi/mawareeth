import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { installDom, teardownDom } from "@/test/dom";
import type { Window } from "happy-dom";
import { messages } from "@/i18n/messages";

const text = messages["en"].results;
const shareText = messages["en"].share;

let dom: Window;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

before(() => {
  dom = installDom("http://localhost/en/results/");
  document.cookie = "csrftoken=test-csrf-token";
  (globalThis as Record<string, unknown>).fetch = () => Promise.reject(new Error("not set up"));
});

after(() => teardownDom(dom));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  (globalThis as Record<string, unknown>).fetch = () => Promise.reject(new Error("not set up"));
});

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
  });
}

function sessionResp(authenticated: boolean) {
  return new Response(JSON.stringify({ authenticated }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function savedCaseResp() {
  return new Response(JSON.stringify({ id: 42, updated_at: "2026-11-01T00:00:00Z" }), { status: 200, headers: { "Content-Type": "application/json" } });
}

type FetchMock = ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & { calls: { url: string; method: string }[] };

function makeFetch(authenticated: boolean, extraHandlers: Record<string, { status: number; body: unknown }> = {}): FetchMock {
  const calls: { url: string; method: string }[] = [];
  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/api/v1/session/")) return Promise.resolve(sessionResp(authenticated));
    for (const [pattern, response] of Object.entries(extraHandlers)) {
      if (url.includes(pattern)) {
        return Promise.resolve(new Response(JSON.stringify(response.body), { status: response.status, headers: { "Content-Type": "application/json" } }));
      }
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  (handler as FetchMock).calls = calls;
  return handler as FetchMock;
}

const { AuthGate } = await import("./auth-gate.tsx");

test("anonymous click Save opens dialog", async () => {
  const fetch = makeFetch(false);
  (globalThis as Record<string, unknown>).fetch = fetch;

  await act(() => {
    root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />);
  });
  await settle();

  const saveBtn = container.querySelector<HTMLButtonElement>("button");
  assert.ok(saveBtn, "save button present");
  await act(() => { saveBtn.click(); });

  const dlg = container.querySelector("dialog")!;
  assert.ok(dlg.open, "dialog should be open after anonymous Save click");
});

test("authenticated click Save sends POST to saved-cases", async () => {
  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 200, body: { id: 42, updated_at: "2026-11-01T00:00:00Z" } } });
  (globalThis as Record<string, unknown>).fetch = fetch;

  await act(() => {
    root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />);
  });
  await settle();

  const saveBtn = container.querySelector<HTMLButtonElement>("button")!;
  await act(() => { saveBtn.click(); });
  await settle();

  const dlg = container.querySelector("dialog")!;
  assert.ok(!dlg.open, "dialog should NOT open when authenticated");

  const postCall = fetch.calls.find((c) => c.url.includes("/api/v1/saved-cases/") && c.method === "POST");
  assert.ok(postCall, "POST to saved-cases should have been sent");
});

test("?resume=save with anonymous opens dialog", async () => {
  await teardownDom(dom);
  dom = installDom("http://localhost/en/results/?resume=save");
  document.cookie = "csrftoken=test-csrf-token";

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  const fetch = makeFetch(false);
  (globalThis as Record<string, unknown>).fetch = fetch;

  await act(() => {
    root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />);
  });
  await settle();
  await settle();

  const dlg = container.querySelector("dialog")!;
  assert.ok(dlg.open, "dialog should open when resume=save and user is anonymous");

  await act(async () => { root.unmount(); });
  container.remove();
  await teardownDom(dom);
  dom = installDom("http://localhost/en/results/");
  document.cookie = "csrftoken=test-csrf-token";
});

test("?resume=save with authenticated calls saveCase and strips param", async () => {
  await teardownDom(dom);
  dom = installDom("http://localhost/en/results/?resume=save");
  document.cookie = "csrftoken=test-csrf-token";

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 200, body: { id: 42, updated_at: "2026-11-01T00:00:00Z" } } });
  (globalThis as Record<string, unknown>).fetch = fetch;

  const replaceStateCalls: string[] = [];
  const origReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (_state: unknown, _title: unknown, url?: string | URL | null) => {
    if (url) replaceStateCalls.push(String(url));
    return origReplaceState(_state, String(_title), url);
  };

  await act(() => {
    root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />);
  });
  await settle();
  await settle();

  const postCall = fetch.calls.find((c) => c.url.includes("/api/v1/saved-cases/") && c.method === "POST");
  assert.ok(postCall, "saveCase POST should be sent for authenticated resume=save");

  const stripped = replaceStateCalls.some((url) => !url.includes("resume="));
  assert.ok(stripped, "replaceState should strip the resume param");

  await act(async () => { root.unmount(); });
  container.remove();
  await teardownDom(dom);
  dom = installDom("http://localhost/en/results/");
  document.cookie = "csrftoken=test-csrf-token";
});

test("dialog close returns focus to trigger button", async () => {
  const fetch = makeFetch(false);
  (globalThis as Record<string, unknown>).fetch = fetch;

  await act(() => {
    root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />);
  });
  await settle();

  const saveBtn = container.querySelector<HTMLButtonElement>("button")!;
  await act(() => { saveBtn.click(); });

  const dlg = container.querySelector("dialog")!;
  assert.ok(dlg.open, "dialog should be open");

  let focused = false;
  const origFocus = saveBtn.focus.bind(saveBtn);
  saveBtn.focus = () => { focused = true; origFocus(); };

  await act(() => { dlg.close(); });
  await settle();

  assert.ok(focused, "trigger button should receive focus when dialog closes");
});

test("dialog close after auth resolves as authenticated triggers runSave", async () => {
  let resolveSession!: (r: Response) => void;
  const sessionPromise = new Promise<Response>((res) => { resolveSession = res; });
  const calls: { url: string; method: string }[] = [];

  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/api/v1/session/")) return sessionPromise;
    if (url.includes("/api/v1/saved-cases/")) {
      return Promise.resolve(new Response(JSON.stringify({ id: 7, updated_at: "2026-11-01T00:00:00Z" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };

  await act(() => {
    root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />);
  });
  // auth="loading" - click Save now; authorizedAction("loading","save") = "dialog" → setAction("save")
  const saveBtn = container.querySelector<HTMLButtonElement>("button")!;
  await act(() => { saveBtn.click(); });

  const dlg = container.querySelector("dialog")!;
  assert.ok(dlg.open, "dialog should be open while auth=loading");

  // Resolve session as authenticated → effect auto-closes dialog → onClose triggers runSave
  await act(async () => {
    resolveSession(sessionResp(true));
    await new Promise<void>((r) => { setTimeout(r, 20); });
  });

  assert.ok(!dlg.open, "dialog should auto-close when auth resolves as authenticated");
  const postCall = calls.find((c) => c.url.includes("/api/v1/saved-cases/") && c.method === "POST");
  assert.ok(postCall, "saveCase POST should fire when dialog closes after sign-in");
});
