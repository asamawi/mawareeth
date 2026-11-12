import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { act } from "react";

let dom: Window;
before(() => {
  dom = new Window({ url: "http://localhost/" });
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    history: dom.history,
    sessionStorage: dom.sessionStorage,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLDialogElement: dom.HTMLDialogElement,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    clearTimeout: dom.clearTimeout.bind(dom),
    setTimeout: dom.setTimeout.bind(dom),
    clearInterval: dom.clearInterval.bind(dom),
    setInterval: dom.setInterval.bind(dom),
  });
  // Minimal stubs so that component imports don't blow up
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
});

after(async () => {
  await dom.happyDOM.close();
});

test("import auth-gate.tsx component", async () => {
  const { AuthGate } = await import("@/app/[locale]/results/auth-gate.tsx");
  assert.equal(typeof AuthGate, "function");
});
