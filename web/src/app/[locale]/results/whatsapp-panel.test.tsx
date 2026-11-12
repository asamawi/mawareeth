import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { installDom, teardownDom } from "@/test/dom";
import type { Window } from "happy-dom";
import { messages } from "@/i18n/messages";
import { WhatsappPanel } from "./whatsapp-panel.tsx";

let dom: Window;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const url = "http://localhost/app/en/shared/#tok123";

let originalOpen: typeof window.open;
before(() => { dom = installDom("http://localhost/en/results/"); originalOpen = window.open; });
after(() => teardownDom(dom));
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  window.open = originalOpen;
});

async function render(locale: "ar" | "en" | "fr") {
  await act(() => { root.render(<WhatsappPanel url={url} locale={locale} text={messages[locale].share} />); });
}

for (const locale of ["en", "ar", "fr"] as const) {
  test(`opens wa.me with the ${locale} disclaimer and link, nulls opener, no alert`, async () => {
    await render(locale);
    const popup: { opener: unknown } = { opener: "set" };
    const calls: unknown[][] = [];
    (window as unknown as Record<string, unknown>).open = (...args: unknown[]) => { calls.push(args); return popup; };
    await act(() => { container.querySelector("button")!.click(); });
    assert.equal(calls.length, 1);
    const [target, name] = calls[0] as [string, string];
    assert.ok(target.startsWith("https://wa.me/?text="));
    assert.equal(decodeURIComponent(target.slice("https://wa.me/?text=".length)), `${messages[locale].shared.banner}\n${url}`);
    assert.equal(name, "_blank");
    assert.equal(popup.opener, null);
    assert.equal(container.querySelector("[role=alert]")!.textContent, "");
  });
}

test("shows the fallback alert when window.open returns null", async () => {
  await render("en");
  (window as unknown as Record<string, unknown>).open = () => null;
  await act(() => { container.querySelector("button")!.click(); });
  assert.equal(container.querySelector("[role=alert]")!.textContent, messages.en.share.whatsappUnavailable);
});

test("shows the fallback alert when window.open throws", async () => {
  await render("en");
  (window as unknown as Record<string, unknown>).open = () => { throw new Error("blocked"); };
  await act(() => { container.querySelector("button")!.click(); });
  assert.equal(container.querySelector("[role=alert]")!.textContent, messages.en.share.whatsappUnavailable);
});
