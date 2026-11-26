import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { installDom, teardownDom } from "@/test/dom";

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
  });
}

// viewShare POSTs to /api/v1/shares/view/; use 500 so it returns "failed" (not "unavailable"),
// which means forgetToken() is NOT called and the sessionStorage value survives the render.
function viewShareFailedResp() {
  return new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } });
}

const { SharedView } = await import("./shared-view.tsx");

test("hash token moves to sessionStorage and replaceState removes the hash", async () => {
  const dom = installDom("http://localhost/en/shared/#tok123");
  document.cookie = "csrftoken=test-csrf-token";

  const replaceStateCalls: string[] = [];
  const origReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (_state: unknown, _title: unknown, url?: string | URL | null) => {
    if (url) replaceStateCalls.push(String(url));
    return origReplaceState(_state, String(_title), url);
  };

  (globalThis as Record<string, unknown>).fetch = (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    return Promise.resolve(viewShareFailedResp());
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    const allMessages = (await import("@/i18n/messages")).messages["en"];
    await act(() => {
      root.render(<SharedView messages={allMessages} locale="en" />);
    });
    await settle();

    assert.strictEqual(sessionStorage.getItem("mawareeth.share-token"), "tok123", "token should be in sessionStorage");
    assert.ok(replaceStateCalls.some((u) => !u.includes("#")), "replaceState should have been called with a hash-free URL");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    await teardownDom(dom);
  }
});

test("sessionStorage fallback: token read from storage, viewShare called with the token", async () => {
  const dom = installDom("http://localhost/en/shared/");
  document.cookie = "csrftoken=test-csrf-token";
  sessionStorage.setItem("mawareeth.share-token", "tok456");

  const postBodies: string[] = [];
  (globalThis as Record<string, unknown>).fetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") postBodies.push(String(init?.body ?? ""));
    return Promise.resolve(viewShareFailedResp());
  };

  const replaceStateCalls: string[] = [];
  const origReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (_state: unknown, _title: unknown, url?: string | URL | null) => {
    if (url) replaceStateCalls.push(String(url));
    return origReplaceState(_state, String(_title), url);
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    const allMessages = (await import("@/i18n/messages")).messages["en"];
    await act(() => {
      root.render(<SharedView messages={allMessages} locale="en" />);
    });
    await settle();

    assert.ok(postBodies.some((b) => b.includes("tok456")), `viewShare POST body should include the stored token; bodies: ${JSON.stringify(postBodies)}`);
    // No replaceState with a hash (there was no hash to remove)
    assert.ok(!replaceStateCalls.some((u) => u.includes("#")), "replaceState should not add a hash when reading from storage");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    await teardownDom(dom);
  }
});

const { previewFixture } = await import("@/test/preview-fixtures");
const fixture = previewFixture("Grandfather and brother under Hanafi");

async function renderShared(respond: () => Response, locale = "en") {
  const dom = installDom(`http://localhost/${locale}/shared/#tok789`);
  document.cookie = "csrftoken=test-csrf-token";
  (globalThis as Record<string, unknown>).fetch = () => Promise.resolve(respond());
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const all = (await import("@/i18n/messages")).messages[locale as "en"];
  await act(() => { root.render(<SharedView messages={all} locale={locale} />); });
  await settle();
  return {
    container,
    all,
    done: async () => { await act(async () => { root.unmount(); }); container.remove(); await teardownDom(dom); },
  };
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const buttonNames = (container: HTMLElement) => [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");

test("a shared case shows the read-only banner first, with its tokens, and no edit controls", async () => {
  const view = await renderShared(() => ok({ status: "ok", visibility: "private", case: fixture.case, preview: fixture.response }));
  try {
    assert.ok(view.container.querySelector("#results-family"), "family shown");
    const first = view.container.firstElementChild!.firstElementChild!;
    assert.equal(first.getAttribute("role"), "note");
    assert.equal(first.getAttribute("data-component"), "shared-case-banner");
    for (const token of ["bg-accent-soft", "border", "border-accent", "rounded-node", "p-3"]) assert.ok(first.classList.contains(token), token);
    assert.ok(first.textContent!.startsWith(view.all.shared.readOnly));
    assert.ok(first.textContent!.includes(view.all.shared.banner));
    assert.ok(view.container.textContent!.includes(view.all.shared.privateBadge));
    const names = buttonNames(view.container);
    for (const word of ["Save", "Share", "WhatsApp", "Rename", "Open"]) assert.ok(!names.some((n) => n.includes(word) && !n.includes("PDF")), `${word} control: ${names.join("|")}`);
    assert.ok(!/Country|version/i.test(first.textContent!));
  } finally { await view.done(); }
});

test("a shared compare case shows the read-only banner and the agreement line, with no Country text", async () => {
  const compareFixture = {
    ...fixture,
    response: {
      ...(fixture.response as Record<string, unknown>),
      presented: {
        ...((fixture.response as { presented: Record<string, unknown> }).presented),
        basis: { kind: "compare" },
        comparison_outcome: "agreement",
        school_line: { code: "same_in_all_schools", text: "Same result in all four Sunni schools" },
      },
    },
  };
  const view = await renderShared(() => ok({ status: "ok", visibility: "private", case: compareFixture.case, preview: compareFixture.response }));
  try {
    const banner = view.container.querySelector("[data-component=shared-case-banner]")!;
    assert.equal(view.container.firstElementChild!.firstElementChild, banner);
    assert.equal(banner.getAttribute("role"), "note");
    assert.ok(banner.textContent!.startsWith(view.all.shared.readOnly));
    assert.ok(view.container.textContent!.includes("Same result in all four Sunni schools"));
    assert.ok(!/Country|version/i.test(banner.textContent!));
    const names = buttonNames(view.container);
    for (const word of ["Save", "Share", "WhatsApp", "Rename", "Open"]) assert.ok(!names.some((n) => n.includes(word)), `${word} control: ${names.join("|")}`);
  } finally { await view.done(); }
});

test("a shared case whose preview is not available shows the banner then the error alert and no family", async () => {
  const unavailable = {
    status: "not_ready",
  };
  const view = await renderShared(() => ok({ status: "ok", visibility: "private", case: fixture.case, preview: unavailable }));
  try {
    const banner = view.container.querySelector("[data-component=shared-case-banner]")!;
    assert.equal(view.container.firstElementChild!.firstElementChild, banner);
    assert.ok(banner.textContent!.startsWith(view.all.shared.readOnly));
    assert.equal(view.container.querySelector('[role="alert"]')?.textContent, view.all.shared.error);
    assert.equal(view.container.querySelector("#results-family"), null);
    for (const selector of ["#results-shares", "#results-steps", "li", "table", "dl"]) {
      assert.equal(view.container.querySelector(selector), null, `${selector} must not render`);
    }
    for (const heir of fixture.case.heirs) {
      assert.ok(!view.container.textContent!.includes(view.all.interview.relationships[heir.relationship as keyof typeof view.all.interview.relationships] ?? " "), `heir relationship shown: ${heir.relationship}`);
    }
  } finally { await view.done(); }
});

test("unavailable, sign-in and failed shared states render no banner and no family", async () => {
  for (const [status, body] of [[404, {}], [403, { code: "sign_in_required" }], [500, {}]] as const) {
    const view = await renderShared(() => ok(body, status));
    try {
      assert.equal(view.container.querySelector("[data-component=shared-case-banner]"), null, String(status));
      assert.equal(view.container.querySelector("#results-family"), null, String(status));
      if (status === 404) assert.equal(view.container.textContent, view.all.shared.unavailable);
    } finally { await view.done(); }
  }
});
