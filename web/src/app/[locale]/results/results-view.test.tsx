import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { installDom, teardownDom } from "@/test/dom";
import type { Window } from "happy-dom";
import { messages } from "@/i18n/messages";
import { previewFixture } from "@/test/preview-fixtures";

const en = messages["en"];
const fixture = previewFixture("Differ: grandfather and full brother");

let dom: Window;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let calls: { url: string; method: string; body?: string }[];
let patchGate: Promise<void> | null = null;
let onLine = true;

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
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "PATCH") {
      const reply = json({ case: { ...fixture.case, madhab: "hanafi" } });
      return patchGate ? patchGate.then(() => reply) : Promise.resolve(reply);
    }
    if (url.includes("/api/v1/case/preview/")) return Promise.resolve(json(fixture.response));
    if (url.includes("/api/v1/case/")) return Promise.resolve(json({ case: fixture.case }));
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
