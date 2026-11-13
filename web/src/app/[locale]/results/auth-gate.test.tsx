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

type FetchMock = ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & { calls: { url: string; method: string; body?: string }[] };

function makeFetch(authenticated: boolean, extraHandlers: Record<string, { status: number; body: unknown }> = {}): FetchMock {
  const calls: { url: string; method: string; body?: string }[] = [];
  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
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

test("successful Save shows one invite form without creating a share link", async () => {
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
  assert.equal(container.querySelectorAll("input[type=email]").length, 1);
  assert.ok(fetch.calls.some((c) => c.url === "/api/v1/saved-cases/42/invites/" && c.method === "GET"));
  assert.ok(!fetch.calls.some((c) => c.url.includes("/shares/") && c.method === "POST"));
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
  const calls: { url: string; method: string; body?: string }[] = [];

  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
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

const shareBody = { id: 7, token: "tok123", visibility: "private", created_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z", expired: false };
const authedHandlers = { "/api/v1/saved-cases/42/shares/": { status: 201, body: shareBody }, "/api/v1/saved-cases/": { status: 200, body: { id: 42, updated_at: "2026-11-01T00:00:00Z" } } };

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
}

test("anonymous WhatsApp click opens the dialog with resume=whatsapp hrefs and makes no write", async () => {
  const fetch = makeFetch(false);
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { button(text.whatsappAction)!.click(); });
  assert.ok(container.querySelector("dialog")!.open);
  const hrefs = [...container.querySelectorAll("dialog a")].map((a) => decodeURIComponent(a.getAttribute("href") ?? ""));
  assert.equal(hrefs.length, 2);
  for (const href of hrefs) assert.ok(href.includes("/en/results/?resume=whatsapp"), href);
  assert.ok(!fetch.calls.some((c) => c.method === "POST"));
});

test("authenticated WhatsApp click saves, creates a private share, and shows both panels", async () => {
  const fetch = makeFetch(true, authedHandlers);
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { button(text.whatsappAction)!.click(); });
  await settle();
  const posts = fetch.calls.filter((c) => c.method === "POST");
  assert.equal(posts[0].url, "/api/v1/saved-cases/");
  assert.equal(posts[1].url, "/api/v1/saved-cases/42/shares/");
  assert.equal(JSON.parse(posts[1].body ?? "{}").visibility, "private");
  assert.ok(button(shareText.whatsappOpen), "Open WhatsApp button shown");
  assert.ok(container.textContent?.includes(shareText.copy), "SharePanel shown");
  const original = window.open;
  const opened: string[] = [];
  (window as unknown as Record<string, unknown>).open = (target: string) => { opened.push(target); return { opener: "set" }; };
  try {
    await act(() => { button(shareText.whatsappOpen)!.click(); });
  } finally {
    window.open = original;
  }
  assert.equal(opened.length, 1);
  assert.equal(decodeURIComponent(opened[0].slice("https://wa.me/?text=".length)), `${messages.en.shared.banner}\nhttp://localhost/en/shared/#tok123`);
});

test("WhatsApp clicked while the session loads, then signed in: closing the dialog prepares the WhatsApp panel", async () => {
  let resolveSession!: (r: Response) => void;
  const sessionPromise = new Promise<Response>((res) => { resolveSession = res; });
  const fetch = makeFetch(true, authedHandlers);
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    return url.includes("/api/v1/session/") ? sessionPromise : fetch(input, init);
  };
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await act(() => { button(text.whatsappAction)!.click(); });
  const dlg = container.querySelector("dialog")!;
  assert.ok(dlg.open, "dialog should be open while auth=loading");
  await act(async () => {
    resolveSession(sessionResp(true));
    await new Promise<void>((r) => { setTimeout(r, 20); });
  });
  await settle();
  assert.ok(!dlg.open);
  const share = fetch.calls.find((c) => c.url === "/api/v1/saved-cases/42/shares/" && c.method === "POST");
  assert.equal(JSON.parse(share?.body ?? "{}").visibility, "private");
  assert.ok(button(shareText.whatsappOpen), "Open WhatsApp button shown after the dialog closes");
});

test("the Share button shows no WhatsApp panel", async () => {
  (globalThis as Record<string, unknown>).fetch = makeFetch(true, authedHandlers);
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { button(text.shareAction)!.click(); });
  await settle();
  assert.ok(container.textContent?.includes(shareText.copy));
  assert.ok(!button(shareText.whatsappOpen));
});

test("a create failure shows createError and no WhatsApp panel", async () => {
  (globalThis as Record<string, unknown>).fetch = makeFetch(true, { "/api/v1/saved-cases/42/shares/": { status: 500, body: {} }, "/api/v1/saved-cases/": { status: 200, body: { id: 42, updated_at: "2026-11-01T00:00:00Z" } } });
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { button(text.whatsappAction)!.click(); });
  await settle();
  assert.equal(container.querySelector("[role=alert]")!.textContent, shareText.createError);
  assert.ok(!button(shareText.whatsappOpen));
});

test("?resume=whatsapp with authenticated prepares the share and strips the param", async () => {
  await teardownDom(dom);
  dom = installDom("http://localhost/en/results/?resume=whatsapp");
  document.cookie = "csrftoken=test-csrf-token";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const fetch = makeFetch(true, authedHandlers);
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await settle();
  assert.ok(fetch.calls.some((c) => c.url === "/api/v1/saved-cases/42/shares/" && c.method === "POST"));
  assert.ok(button(shareText.whatsappOpen));
  assert.ok(!window.location.search.includes("resume"));
  await act(async () => { root.unmount(); });
  container.remove();
  await teardownDom(dom);
  dom = installDom("http://localhost/en/results/");
  document.cookie = "csrftoken=test-csrf-token";
});
