import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { installDom, teardownDom } from "@/test/dom";
import { messages, type Locale } from "@/i18n/messages";

import GlobalError from "./global-error.tsx";

async function render(path: string, error: unknown) {
  const dom = installDom(`http://localhost${path}`);
  let reloads = 0;
  const location = dom.location as unknown as { reload: () => void };
  Object.defineProperty(location, "reload", { value: () => (reloads += 1), configurable: true });
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  const root = createRoot(dom.document as unknown as Document);
  try {
    await act(async () => {
      root.render(<GlobalError error={error} />);
    });
    return { dom, root, reloads: () => reloads, errors, restore: () => (console.error = original) };
  } catch (failure) {
    console.error = original;
    throw failure;
  }
}

for (const [locale, dir] of [["fr", "ltr"], ["ar", "rtl"]] as [Locale, string][]) {
  test(`global-error renders the ${locale} fallback without reloading for a plain error`, async () => {
    const view = await render(`/${locale}/results/`, new Error("boom"));
    try {
      const html = view.dom.document.documentElement;
      assert.equal(html.getAttribute("lang"), locale);
      assert.equal(html.getAttribute("dir"), dir);
      const text = messages[locale].pageError;
      assert.equal(view.dom.document.querySelector("h1")?.textContent, text.title);
      const button = [...view.dom.document.querySelectorAll("button")].find((b) => b.textContent === text.reload);
      assert.ok(button);
      const link = view.dom.document.querySelector("a");
      assert.equal(link?.getAttribute("href"), `/${locale}/interview/`);
      assert.equal(link?.textContent, text.interview);
      assert.equal(view.reloads(), 0);
      await act(async () => {
        button.dispatchEvent(new view.dom.MouseEvent("click", { bubbles: true }));
      });
      assert.equal(view.reloads(), 1);
    } finally {
      view.restore();
      await act(async () => view.root.unmount());
      await teardownDom(view.dom);
    }
  });
}

test("global-error reloads once for a chunk error", async () => {
  const view = await render("/en/", new Error("Loading chunk 4 failed."));
  try {
    assert.equal(view.reloads(), 1);
  } finally {
    view.restore();
    await act(async () => view.root.unmount());
    await teardownDom(view.dom);
  }
});
