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
  return new Response(JSON.stringify({ id: 42, name: "Estate", updated_at: "2026-11-01T00:00:00Z" }), { status: 200, headers: { "Content-Type": "application/json" } });
}

type FetchMock = ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & { calls: { url: string; method: string; body?: string; headers?: HeadersInit }[] };

function makeFetch(authenticated: boolean, extraHandlers: Record<string, { status: number; body: unknown }> = {}): FetchMock {
  const calls: { url: string; method: string; body?: string; headers?: HeadersInit }[] = [];
  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined, headers: init?.headers });
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

const nameInput = () => container.querySelector<HTMLInputElement>("dialog[open] input[type=text]");
async function typeName(value: string) {
  const input = nameInput()!;
  await act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    for (const type of ["input", "keyup", "change"]) input.dispatchEvent(new Event(type, { bubbles: true }));
  });
}
async function submitName() {
  const form = container.querySelector<HTMLFormElement>("dialog[open] form")!;
  await act(() => { form.requestSubmit(); });
  await settle();
}
const status = () => container.querySelector("[role=status]")!.textContent;
const buttonNamed = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === name);
const saveButton = () => container.querySelector<HTMLButtonElement>("button")!;
const posts = (fetch: FetchMock) => fetch.calls.filter((c) => c.url === "/api/v1/saved-cases/" && c.method === "POST");

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
  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 200, body: { id: 42, name: "Estate", updated_at: "2026-11-01T00:00:00Z" } } });
  (globalThis as Record<string, unknown>).fetch = fetch;

  await act(() => {
    root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />);
  });
  await settle();

  const saveBtn = container.querySelector<HTMLButtonElement>("button")!;
  await act(() => { saveBtn.click(); });
  await settle();
  await submitName();

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

  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 200, body: { id: 42, name: "Estate", updated_at: "2026-11-01T00:00:00Z" } } });
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

  assert.ok(nameInput(), "an authenticated resume opens the naming dialog");
  assert.equal(posts(fetch).length, 0, "nothing is claimed before naming");
  await submitName();
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
      return Promise.resolve(new Response(JSON.stringify({ id: 7, name: "Estate", updated_at: "2026-11-01T00:00:00Z" }), { status: 200, headers: { "Content-Type": "application/json" } }));
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
  assert.equal(container.querySelectorAll("dialog[open]").length, 1, "only the naming dialog is open");
  assert.ok(nameInput(), "the naming dialog follows sign-in");
  assert.ok(!calls.some((c) => c.url.includes("/api/v1/saved-cases/") && c.method === "POST"), "nothing is claimed before naming");
  await act(async () => { container.querySelector<HTMLFormElement>("dialog[open] form")!.requestSubmit(); await new Promise<void>((r) => { setTimeout(r, 20); }); });
  const postCall = calls.find((c) => c.url.includes("/api/v1/saved-cases/") && c.method === "POST");
  assert.ok(postCall, "saveCase POST should fire after naming");
});

const shareBody = { id: 7, token: "tok123", visibility: "private", created_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z", expired: false };
const authedHandlers = { "/api/v1/saved-cases/42/shares/": { status: 201, body: shareBody }, "/api/v1/saved-cases/": { status: 200, body: { id: 42, name: "Estate", updated_at: "2026-11-01T00:00:00Z" } } };

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
  (globalThis as Record<string, unknown>).fetch = makeFetch(true, { "/api/v1/saved-cases/42/shares/": { status: 500, body: {} }, "/api/v1/saved-cases/": { status: 200, body: { id: 42, name: "Estate", updated_at: "2026-11-01T00:00:00Z" } } });
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

const savedHandlers = { "/api/v1/saved-cases/name-suggestion/": { status: 200, body: { name: "Estate of the deceased, 1 January 2026" } }, "/api/v1/saved-cases/": { status: 201, body: { id: 42, name: "Mother's estate", updated_at: "2026-11-01T00:00:00Z" } } };

test("a first Save asks for a name prefilled with the suggestion and sends the edited trimmed name", async () => {
  const fetch = makeFetch(true, savedHandlers);
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  assert.equal(nameInput()!.value, "Estate of the deceased, 1 January 2026");
  assert.equal(nameInput()!.getAttribute("dir"), "auto");
  assert.equal(posts(fetch).length, 0);
  await typeName("  Mother's estate ");
  assert.ok(container.textContent!.includes("15 / 100"));
  await submitName();
  assert.deepEqual(JSON.parse(posts(fetch)[0].body!), { case_id: "c1", name: "Mother's estate" });
  assert.equal(status(), text.saved);
});

test("a name over 100 characters is blocked on the client and nothing is sent", async () => {
  const fetch = makeFetch(true, savedHandlers);
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  await typeName("a".repeat(101));
  assert.ok(container.textContent!.includes(text.nameTooLong));
  await submitName();
  assert.equal(posts(fetch).length, 0);
  assert.ok(nameInput(), "the dialog stays open");
  await typeName("\u0645\u064e".repeat(100));
  assert.ok(container.textContent!.includes("100 / 100"));
  await submitName();
  assert.equal(posts(fetch).length, 1);
});

test("cancelling the naming dialog claims nothing and returns focus to Save", async () => {
  const fetch = makeFetch(true, savedHandlers);
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  await act(() => { buttonNamed(text.nameCancel)!.click(); });
  await settle();
  assert.equal(container.querySelectorAll("dialog[open]").length, 0);
  assert.equal(posts(fetch).length, 0);
  assert.equal(status(), "");
  assert.equal(document.activeElement, saveButton());
});

test("a linked case saves without asking for a name", async () => {
  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 200, body: { id: 42, name: "Kept", updated_at: "2026-11-01T00:00:00Z" } } });
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" linked />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  assert.equal(container.querySelectorAll("dialog[open]").length, 0);
  assert.deepEqual(JSON.parse(posts(fetch)[0].body!), { case_id: "c1" });
  assert.equal(status(), text.saved);
});

test("a failed save shows the failure with Retry, keeps the typed name and Retry resends it", async () => {
  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 503, body: {} } });
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  await typeName("Mine");
  await submitName();
  assert.equal(status(), text.saveError);
  assert.ok(buttonNamed(text.saveRetry));
  await act(() => { buttonNamed(text.saveRetry)!.click(); });
  await settle();
  assert.deepEqual(posts(fetch).map((c) => JSON.parse(c.body!).name), ["Mine", "Mine"]);
  // Saving again asks again, with the typed name kept.
  await act(() => { saveButton().click(); });
  await settle();
  assert.equal(nameInput()!.value, "Mine");
});

test("a conflict says so, offers no Retry and claims nothing", async () => {
  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 409, body: { code: "saved_case_conflict" } } });
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" linked />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  assert.equal(status(), text.saveConflict);
  assert.equal(buttonNamed(text.saveRetry), undefined);
  assert.ok(!container.textContent!.includes(text.saved));
});

test("a success answer without the stored name is a failure", async () => {
  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 201, body: { id: 42, updated_at: "2026-11-01T00:00:00Z" } } });
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" linked />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  assert.equal(status(), text.saveError);
});

test("Share on a first save saves with the default name and shows no naming dialog", async () => {
  const fetch = makeFetch(true, authedHandlers);
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { buttonNamed(text.shareAction)!.click(); });
  await settle();
  assert.equal(container.querySelectorAll("dialog[open]").length, 0);
  assert.deepEqual(JSON.parse(posts(fetch)[0].body!), { case_id: "c1" });
});

test("a blank name submitted in French sends the page Locale so the server names it in French", async () => {
  const fetch = makeFetch(true, savedHandlers);
  (globalThis as Record<string, unknown>).fetch = fetch;
  const fr = messages["fr"].results;
  await act(() => { root.render(<AuthGate locale="fr" text={fr} share={messages["fr"].share} caseId="c1" />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  await typeName("   ");
  await submitName();
  const post = posts(fetch)[0];
  assert.equal((post.headers as Record<string, string>)["Accept-Language"], "fr");
  assert.deepEqual(JSON.parse(post.body!), { case_id: "c1", name: "" });
});

test("a name the server refuses reopens the dialog with that name and a message, and offers no Retry", async () => {
  const fetch = makeFetch(true, { "/api/v1/saved-cases/": { status: 400, body: { errors: { name: "invalid" } } } });
  (globalThis as Record<string, unknown>).fetch = fetch;
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  await typeName("Bad");
  await submitName();
  assert.equal(nameInput()!.value, "Bad");
  assert.ok(container.querySelector("dialog[open]")!.textContent!.includes(text.nameInvalid));
  assert.equal(buttonNamed(text.saveRetry), undefined);
  assert.notEqual(status(), text.saveError);
});

test("Retry resends exactly the failed request, not the name of an earlier save", async () => {
  let post = 0;
  const bodies: string[] = [];
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/api/v1/session/")) return Promise.resolve(sessionResp(true));
    if (url === "/api/v1/saved-cases/" && init?.method === "POST") {
      bodies.push(String(init.body));
      post += 1;
      return Promise.resolve(post === 2 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ id: 42, name: "A", updated_at: "x" }), { status: post === 1 ? 201 : 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ invites: [] }), { status: 200 }));
  };
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  await typeName("A");
  await submitName();
  assert.equal(status(), text.saved);
  await act(() => { saveButton().click(); });
  await settle();
  assert.equal(status(), text.saveError);
  await act(() => { buttonNamed(text.saveRetry)!.click(); });
  await settle();
  assert.deepEqual(bodies.map((b) => JSON.parse(b)), [{ case_id: "c1", name: "A" }, { case_id: "c1" }, { case_id: "c1" }]);
  assert.equal(status(), text.saved);
});

function deferredSaves() {
  const posts: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  (globalThis as Record<string, unknown>).fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/api/v1/session/")) return sessionResp(true);
    if (url === "/api/v1/saved-cases/" && init?.method === "POST") {
      posts.push(String(init.body));
      await gate;
      return new Response(JSON.stringify({ id: 42, name: "N", updated_at: "x" }), { status: 200 });
    }
    if (url.includes("/shares/")) return new Response(JSON.stringify({ id: 7, token: "tok", visibility: "private", created_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z", expired: false }), { status: 201 });
    return new Response(JSON.stringify({ invites: [] }), { status: 200 });
  };
  return { posts, release };
}

test("Share during a pending Save does not write a second time", async () => {
  const { posts: sent, release } = deferredSaves();
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" linked />); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  await act(() => { buttonNamed(text.shareAction)?.click(); });
  await settle();
  assert.equal(sent.length, 1);
  await act(async () => { release(); await new Promise<void>((r) => { setTimeout(r, 20); }); });
  assert.equal(sent.length, 1);
});

test("Save during a pending Share does not write a second time", async () => {
  const { posts: sent, release } = deferredSaves();
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" linked />); });
  await settle();
  await act(() => { buttonNamed(text.shareAction)!.click(); });
  await settle();
  await act(() => { saveButton().click(); });
  await settle();
  assert.equal(sent.length, 1);
  await act(async () => { release(); await new Promise<void>((r) => { setTimeout(r, 20); }); });
  assert.equal(sent.length, 1);
});

// Save conflict choices (story 10.1 part B).
const CONFLICT = { error: "conflict", code: "saved_case_conflict", detail: "changed", revision: 4, saved_id: 42, saved_name: "Mother's estate", working_case_id: "c1", working_revision: 2 };
const NEW_ROW = { id: 43, name: "Copy", updated_at: "2026-11-02T00:00:00Z", revision: 1 };
const FRESH = { case: { id: "fresh", revision: 1, started_at: "now", madhab: "hanafi", heirs: [] } };
type Call = { url: string; method: string; body: string };

/** A fetch that answers the session itself and every other call by `answer`, recording the calls. */
function scripted(answer: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/api/v1/session/")) return Promise.resolve(sessionResp(true));
    const call = { url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" };
    calls.push(call);
    return Promise.resolve(answer(call, calls.length - 1));
  };
  return calls;
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const choice = (label: string) => buttonNamed(label);
async function renderConflicted(onReplaced?: () => void, action: "save" | "share" | "whatsapp" = "save") {
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" linked onReplaced={onReplaced} />); });
  await settle();
  await act(() => { buttonNamed(action === "save" ? text.save : action === "share" ? text.shareAction : text.whatsappAction)!.click(); });
  await settle();
}
const answers = (extra: (call: Call, index: number) => Response | Promise<Response> | undefined = () => undefined) => (call: Call, index: number) => {
  const own = extra(call, index);
  if (own) return own;
  if (call.url === "/api/v1/saved-cases/") return reply(409, CONFLICT);
  return reply(404, {});
};

test("a conflict from Save shows the text and two choices, and disables Save, Share and WhatsApp with no write", async () => {
  const calls = scripted(answers());
  await renderConflicted();
  assert.equal(status(), text.saveConflict);
  assert.ok(choice(text.conflictOpenLatest) && choice(text.conflictSaveAsNew));
  for (const label of [text.save, text.shareAction, text.whatsappAction]) assert.equal(buttonNamed(label)!.disabled, true);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ["POST /api/v1/saved-cases/"]);
});

test("a conflict whose body is partial offers the text only, no choices", async () => {
  scripted(() => reply(409, { code: "saved_case_conflict", revision: 4 }));
  await renderConflicted();
  assert.equal(status(), text.saveConflict);
  assert.equal(choice(text.conflictOpenLatest), undefined);
});

test("Open latest version sends the checked open, then asks the page to reload", async () => {
  let replaced = 0;
  const calls = scripted(answers((call) => (call.url === "/api/v1/saved-cases/42/open/" ? reply(200, FRESH) : undefined)));
  await renderConflicted(() => { replaced += 1; });
  await act(() => { choice(text.conflictOpenLatest)!.click(); });
  await settle();
  assert.equal(replaced, 1);
  const open = calls.filter((c) => c.url === "/api/v1/saved-cases/42/open/");
  assert.equal(open.length, 1);
  assert.deepEqual(JSON.parse(open[0].body), { case_id: "c1", expected_revision: 2 });
  assert.equal(choice(text.conflictOpenLatest), undefined);
  assert.equal(status(), "");
  assert.equal(window.location.search, "");
});

test("pressing Open latest twice sends one request and both choices are disabled meanwhile", async () => {
  let release: () => void = () => {};
  const calls = scripted(answers((call) => (call.url === "/api/v1/saved-cases/42/open/" ? new Promise<Response>((resolve) => { release = () => resolve(reply(200, FRESH)); }) : undefined)));
  await renderConflicted();
  await act(() => { choice(text.conflictOpenLatest)!.click(); choice(text.conflictOpenLatest)!.click(); });
  await settle();
  assert.equal(status(), text.conflictBusy);
  assert.equal(choice(text.conflictOpenLatest)!.disabled, true);
  assert.equal(choice(text.conflictSaveAsNew)!.disabled, true);
  assert.equal(calls.filter((c) => c.url.endsWith("/open/")).length, 1);
  await act(async () => { release(); await new Promise<void>((r) => { setTimeout(r, 20); }); });
});

test("a stale Open latest keeps the copy and asks again with the fresh revision", async () => {
  let opens = 0;
  const calls = scripted(answers((call) => {
    if (!call.url.endsWith("/open/")) return undefined;
    opens += 1;
    return opens === 1 ? reply(409, { error: "conflict", case: { id: "c1", revision: 9, started_at: "now", heirs: [] } }) : reply(200, FRESH);
  }));
  let replaced = 0;
  await renderConflicted(() => { replaced += 1; });
  await act(() => { choice(text.conflictOpenLatest)!.click(); });
  await settle();
  assert.equal(replaced, 0, "the prompt stays: no reload remounts it");
  assert.equal(status(), text.saveConflict);
  assert.equal(choice(text.conflictOpenLatest)!.disabled, false);
  await act(() => { choice(text.conflictOpenLatest)!.click(); });
  await settle();
  assert.deepEqual(calls.filter((c) => c.url.endsWith("/open/")).map((c) => JSON.parse(c.body)), [{ case_id: "c1", expected_revision: 2 }, { case_id: "c1", expected_revision: 9 }]);
  assert.equal(replaced, 1);
});

test("a failed Open latest says so, keeps the prompt and Retry resends the same open", async () => {
  let replaced = 0;
  const calls = scripted(answers());
  await renderConflicted(() => { replaced += 1; });
  await act(() => { choice(text.conflictOpenLatest)!.click(); });
  await settle();
  assert.equal(status(), text.conflictOpenFailed);
  assert.ok(choice(text.conflictSaveAsNew));
  await act(() => { buttonNamed(text.saveRetry)!.click(); });
  await settle();
  const opens = calls.filter((c) => c.url.endsWith("/open/"));
  assert.equal(opens.length, 2);
  assert.deepEqual(opens[1], opens[0]);
  assert.equal(replaced, 0);
});

test("Save as a new case asks for a name prefilled with the copy name, and Cancel re-enables the choices", async () => {
  const calls = scripted(answers());
  await renderConflicted();
  await act(() => { choice(text.conflictSaveAsNew)!.click(); });
  await settle();
  assert.equal(nameInput()!.value, "Mother's estate (copy)");
  await act(() => { container.querySelector<HTMLButtonElement>("dialog[open] button[type=button]")!.click(); });
  await settle();
  assert.equal(container.querySelectorAll("dialog[open]").length, 0);
  assert.equal(choice(text.conflictOpenLatest)!.disabled, false);
  assert.equal(choice(text.conflictSaveAsNew)!.disabled, false);
  assert.equal(calls.filter((c) => c.url.endsWith("/create/")).length, 0);
  await act(() => { choice(text.conflictOpenLatest)!.click(); });
  await settle();
  assert.equal(calls.filter((c) => c.url.endsWith("/open/")).length, 1);
});

test("the copy name is cut so the whole stays within 100 characters", async () => {
  scripted(() => reply(409, { ...CONFLICT, saved_name: "x".repeat(150) }));
  await renderConflicted();
  await act(() => { choice(text.conflictSaveAsNew)!.click(); });
  await settle();
  assert.equal(nameInput()!.value, `${"x".repeat(100 - " (copy)".length)} (copy)`);
});

test("Save as a new case sends the checked arguments with one request key, and Retry resends them unchanged", async () => {
  let creates = 0;
  const calls = scripted(answers((call) => {
    if (!call.url.endsWith("/create/")) return undefined;
    creates += 1;
    return creates === 1 ? reply(503, {}) : reply(201, NEW_ROW);
  }));
  await renderConflicted();
  await act(() => { choice(text.conflictSaveAsNew)!.click(); });
  await settle();
  await typeName("Copy");
  await submitName();
  assert.equal(status(), text.conflictCreateFailed);
  await act(() => { buttonNamed(text.saveRetry)!.click(); });
  await settle();
  const created = calls.filter((c) => c.url === "/api/v1/saved-cases/create/");
  assert.equal(created.length, 2);
  assert.deepEqual(created[1], created[0]);
  const body = JSON.parse(created[0].body);
  assert.deepEqual({ ...body, request_key: "" }, { case_id: "c1", expected_revision: 2, saved_id: 42, saved_revision: 4, request_key: "", name: "Copy" });
  assert.match(body.request_key, /^[0-9a-f-]{36}$/);
  assert.equal(status(), text.saved);
  assert.equal(choice(text.conflictOpenLatest), undefined);
  // The working copy is linked to the new row, so Save is available again.
  assert.equal(buttonNamed(text.save)!.disabled, false);
});

for (const [label, source] of [["Share", "share"], ["WhatsApp", "whatsapp"]] as const) {
  test(`a conflict from ${label} continues with the new case after Save as a new case`, async () => {
    const calls = scripted(answers((call) => {
      if (call.url.endsWith("/create/")) return reply(201, NEW_ROW);
      if (call.url === "/api/v1/saved-cases/43/shares/") return reply(201, shareBody);
      return undefined;
    }));
    await renderConflicted(undefined, source);
    assert.equal(calls.filter((c) => c.url.endsWith("/shares/") && c.method === "POST").length, 0, "no link is created by the conflict");
    await act(() => { choice(text.conflictSaveAsNew)!.click(); });
    await settle();
    await submitName();
    const shares = calls.filter((c) => c.url.endsWith("/shares/") && c.method === "POST");
    assert.deepEqual(shares.map((c) => c.url), ["/api/v1/saved-cases/43/shares/"]);
    assert.ok(container.textContent?.includes(shareText.copy), "SharePanel shown");
    if (source === "whatsapp") assert.ok(buttonNamed(shareText.whatsappOpen));
  });
}

test("a stale Save as a new case prompts again with the fresh state, and without a conflict asks the page to reload", async () => {
  let creates = 0;
  let replaced = 0;
  const calls = scripted(answers((call) => {
    if (!call.url.endsWith("/create/")) return undefined;
    creates += 1;
    if (creates === 1) return reply(409, { code: "resolve_stale", conflict: { ...CONFLICT, revision: 7, working_revision: 3 }, case: { id: "c1", revision: 3, started_at: "now", heirs: [] } });
    return reply(409, { code: "resolve_stale", conflict: null, case: { id: "c1", revision: 3, started_at: "now", heirs: [] } });
  }));
  await renderConflicted(() => { replaced += 1; });
  await act(() => { choice(text.conflictSaveAsNew)!.click(); });
  await settle();
  await submitName();
  assert.equal(status(), text.saveConflict);
  assert.equal(replaced, 0, "the prompt stays: no reload remounts it");
  await act(() => { choice(text.conflictSaveAsNew)!.click(); });
  await settle();
  await submitName();
  const created = calls.filter((c) => c.url.endsWith("/create/")).map((c) => JSON.parse(c.body));
  assert.deepEqual([created[1].expected_revision, created[1].saved_revision], [3, 7]);
  assert.notEqual(created[0].request_key, created[1].request_key);
  assert.equal(replaced, 1);
  assert.equal(choice(text.conflictOpenLatest), undefined);
});

test("an enriched conflict with an empty saved name opens the copy dialog with the server suggestion", async () => {
  scripted(answers((call) => {
    if (call.url === "/api/v1/saved-cases/") return reply(409, { ...CONFLICT, saved_name: "" });
    if (call.url.includes("name-suggestion")) return reply(200, { name: "Estate of the deceased, 1 January 2026" });
    return undefined;
  }));
  await renderConflicted();
  await act(() => { choice(text.conflictSaveAsNew)!.click(); });
  await settle();
  assert.equal(nameInput()!.value, "Estate of the deceased, 1 January 2026");
});

test("a stale open that names a different case closes the prompt and asks the page to reload", async () => {
  let replaced = 0;
  scripted(answers((call) => (call.url.endsWith("/open/") ? reply(409, { error: "conflict", case: { id: "other", revision: 1, started_at: "now", heirs: [] } }) : undefined)));
  await renderConflicted(() => { replaced += 1; });
  await act(() => { choice(text.conflictOpenLatest)!.click(); });
  await settle();
  assert.equal(replaced, 1);
  assert.equal(choice(text.conflictOpenLatest), undefined);
  assert.equal(status(), "");
});

test("a Share panel from an earlier share is cleared when the visitor switches to the copy", async () => {
  let shares = 0;
  scripted(answers((call) => {
    if (call.url === "/api/v1/saved-cases/") return shares === 0 ? reply(200, { id: 42, name: "Estate", updated_at: "2026-11-01T00:00:00Z" }) : reply(409, CONFLICT);
    if (call.url.endsWith("/shares/") && call.method === "POST") { shares += 1; return reply(201, shareBody); }
    if (call.url.endsWith("/create/")) return reply(201, NEW_ROW);
    return undefined;
  }));
  await act(() => { root.render(<AuthGate locale="en" text={text} share={shareText} caseId="c1" linked />); });
  await settle();
  await act(() => { buttonNamed(text.shareAction)!.click(); });
  await settle();
  assert.ok(container.textContent?.includes(shareText.copy), "first panel shown");
  await act(() => { buttonNamed(text.save)!.click(); });
  await settle();
  await act(() => { choice(text.conflictSaveAsNew)!.click(); });
  await settle();
  await submitName();
  assert.ok(!container.textContent?.includes(shareText.copy), "the old link is gone");
  assert.equal(status(), text.saved);
});
