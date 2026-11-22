import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { messages } from "@/i18n/messages";
import { installDom, teardownDom } from "@/test/dom";

import { DeathBreadcrumb } from "./death-breadcrumb";

const crumbs = [
  { id: null, order: 1 as const, label: null },
  { id: "a", order: 2 as const, label: "Son" },
  { id: "x", order: 3 as const, label: "Wife of Son" },
];

test("the estate level nav has links for earlier levels and plain current text, and is absent at the root", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const text = messages.en.interview;
  const opened: (string | null)[] = [];
  try {
    await act(async () => root.render(<DeathBreadcrumb messages={text} crumbs={crumbs} active="x" disabled={false} onOpen={id => opened.push(id)} />));
    const nav = node.querySelector("nav")!;
    assert.equal(nav.getAttribute("aria-label"), text.estateLevel);
    assert.equal(nav.querySelectorAll("li").length, 3);
    const links = [...nav.querySelectorAll("a")];
    assert.equal(links.length, 2);
    const current = nav.querySelector('[aria-current="page"]')!;
    assert.equal(current.tagName, "SPAN");
    assert.ok(current.textContent?.includes("Wife of Son"));
    assert.equal(nav.querySelectorAll('svg[aria-hidden="true"]').length, 2);
    await act(async () => links[1].click());
    await act(async () => links[0].click());
    assert.deepEqual(opened, ["a", null]);
    await act(async () => root.render(<DeathBreadcrumb messages={text} crumbs={[crumbs[0]]} active={null} disabled={false} onOpen={() => {}} />));
    assert.equal(node.querySelector("nav"), null);
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});
