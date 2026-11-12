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

// acceptInvite POSTs to /api/v1/invites/accept/; use 500 so it returns "failed" (not "unavailable"),
// which means forgetToken() is NOT called and the sessionStorage value survives the render.
function acceptInviteFailedResp() {
  return new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } });
}

const { InviteView } = await import("./invite-view.tsx");

test("hash token moves to sessionStorage and replaceState removes the hash", async () => {
  const dom = installDom("http://localhost/en/invite/#tok123");
  (globalThis as Record<string, unknown>).__mockRouter = { push() {}, replace() {}, prefetch() {} };
  document.cookie = "csrftoken=test-csrf-token";

  const replaceStateCalls: string[] = [];
  const origReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (_state: unknown, _title: unknown, url?: string | URL | null) => {
    if (url) replaceStateCalls.push(String(url));
    return origReplaceState(_state, String(_title), url);
  };

  (globalThis as Record<string, unknown>).fetch = (): Promise<Response> => {
    return Promise.resolve(acceptInviteFailedResp());
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    const allMessages = (await import("@/i18n/messages")).messages["en"];
    await act(() => {
      root.render(<InviteView messages={allMessages} locale="en" />);
    });
    await settle();

    assert.strictEqual(sessionStorage.getItem("mawareeth.invite-token"), "tok123", "token should be in sessionStorage");
    assert.ok(replaceStateCalls.some((u) => !u.includes("#")), "replaceState should have been called with a hash-free URL");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    await teardownDom(dom);
  }
});

test("sessionStorage fallback: token read from storage, acceptInvite called with the token", async () => {
  const dom = installDom("http://localhost/en/invite/");
  (globalThis as Record<string, unknown>).__mockRouter = { push() {}, replace() {}, prefetch() {} };
  document.cookie = "csrftoken=test-csrf-token";
  sessionStorage.setItem("mawareeth.invite-token", "tok456");

  const postBodies: string[] = [];
  (globalThis as Record<string, unknown>).fetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") postBodies.push(String(init?.body ?? ""));
    return Promise.resolve(acceptInviteFailedResp());
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
      root.render(<InviteView messages={allMessages} locale="en" />);
    });
    await settle();

    assert.equal(postBodies.length, 0, "loading must not accept the invitation");
    assert.ok(container.querySelector("button"));
    await act(async () => container.querySelector("button")!.click());
    await settle();
    assert.ok(postBodies.some((b) => b.includes("tok456")), `acceptInvite POST body should include the stored token; bodies: ${JSON.stringify(postBodies)}`);
    // No replaceState with a hash (there was no hash to remove)
    assert.ok(!replaceStateCalls.some((u) => u.includes("#")), "replaceState should not add a hash when reading from storage");
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    await teardownDom(dom);
  }
});


test("accept success forgets the token and routes to received; sign-in keeps it", async () => {
  for (const authenticated of [false, true]) {
    const dom = installDom("http://localhost/en/invite/#secret");
    document.cookie = "csrftoken=test";
    const redirects: string[] = [];
    (globalThis as Record<string, unknown>).__mockRouter = { push() {}, replace(url: string) { redirects.push(url); }, prefetch() {} };
    globalThis.fetch = async () => authenticated ? Response.json({ id: 7 }) : Response.json({ code: "sign_in_required" }, { status: 403 });
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    try {
      const text = (await import("@/i18n/messages")).messages.en;
      await act(async () => root.render(<InviteView messages={text} locale="en" />)); await settle();
      assert.deepEqual(redirects, []);
      assert.ok(node.querySelector("button"), "explicit acceptance is offered before sign-in");
      await act(async () => node.querySelector("button")!.click()); await settle();
      if (authenticated) {
        assert.deepEqual(redirects, ["/en/received/#7"]);
        assert.equal(sessionStorage.getItem("mawareeth.invite-token"), null);
      } else {
        assert.equal(sessionStorage.getItem("mawareeth.invite-token"), "secret");
        assert.ok(node.querySelector('a[href="/app/en/login/?next=%2Fapp%2Fen%2Finvite%2F"]'));
        assert.ok(node.textContent?.includes(text.shared.createAccount));
      }
    } finally { await act(async () => root.unmount()); await teardownDom(dom); }
  }
});
