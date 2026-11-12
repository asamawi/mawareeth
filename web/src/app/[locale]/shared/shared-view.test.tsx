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
