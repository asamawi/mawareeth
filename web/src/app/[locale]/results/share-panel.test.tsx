import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { installDom, teardownDom } from "@/test/dom";
import type { Window } from "happy-dom";
import { messages } from "@/i18n/messages";
import type { CreatedShare } from "@/api/shares";

const text = messages["en"].share;

let dom: Window;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const created: CreatedShare = {
  id: 1,
  token: "tok123",
  visibility: "private",
  created_at: "2026-11-01T00:00:00Z",
  expires_at: "2026-12-01T00:00:00Z",
  expired: false,
};

const shareRow = { id: 1, visibility: "private", created_at: "2026-11-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z", expired: false };

before(() => {
  dom = installDom("http://localhost/en/results/");
  document.cookie = "csrftoken=test-csrf-token";
  // navigator is getter-only on Node globalThis; use defineProperty
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: () => Promise.resolve() } },
    configurable: true,
    writable: true,
  });
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

// listShares expects { shares: [...] }
function listSharesResp(rows: typeof shareRow[]) {
  return new Response(JSON.stringify({ shares: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
}

const { SharePanel } = await import("./share-panel.tsx");

test("Make public click opens warning dialog without calling updateShare", async () => {
  const patchCalls: string[] = [];
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    if (init?.method === "PATCH") patchCalls.push(url);
    return Promise.resolve(listSharesResp([shareRow]));
  };

  await act(() => {
    root.render(<SharePanel savedId={1} created={created} locale="en" text={text} />);
  });
  await settle();

  const makePublicBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === text.makePublic,
  );
  assert.ok(makePublicBtn, `"Make public" button should be present; buttons: ${Array.from(container.querySelectorAll("button")).map((b) => b.textContent).join(", ")}`);

  await act(() => { makePublicBtn!.click(); });

  assert.equal(container.querySelector("input[type=email]"), null);
  const dlg = container.querySelector("dialog")!;
  assert.ok(dlg.open, "warning dialog should open after clicking Make public");
  assert.strictEqual(patchCalls.length, 0, "updateShare PATCH should NOT be sent before confirming");
});

test("confirm Make public sends PATCH with accept_public_warning", async () => {
  const patchBodies: string[] = [];
  (globalThis as Record<string, unknown>).fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
    if (init?.method === "PATCH") {
      patchBodies.push(String(init?.body ?? ""));
      return Promise.resolve(new Response(JSON.stringify({ ...shareRow, visibility: "public" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return Promise.resolve(listSharesResp([shareRow]));
  };

  await act(() => {
    root.render(<SharePanel savedId={1} created={created} locale="en" text={text} />);
  });
  await settle();

  const makePublicBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === text.makePublic,
  )!;
  assert.ok(makePublicBtn, "Make public button should be present");
  await act(() => { makePublicBtn.click(); });

  const confirmBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === text.warningConfirm,
  )!;
  assert.ok(confirmBtn, "confirm button should be present in dialog");
  await act(() => { confirmBtn.click(); });
  await settle();

  assert.ok(patchBodies.length > 0, "PATCH should have been sent after confirming");
  const body = patchBodies[0];
  assert.ok(
    body.includes("accept_public_warning") && body.includes("true"),
    `PATCH body should include accept_public_warning:true; got: ${body}`,
  );
});


/** Types like a user: the native setter bypasses React's value tracker, then the events React listens for fire. */
function typeInto(input: HTMLInputElement, value: string) {
  input.focus();
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
  for (const type of ["input", "keyup", "change"]) input.dispatchEvent(new Event(type, { bubbles: true }));
}

test("email invitation form sends and revokes an invite", async () => {
  document.cookie = "csrftoken=test";
  const { InvitePanel } = await import("./invite-panel");
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let active = false;
  globalThis.fetch = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const row = { id: 9, email: "friend@example.com", status: "pending", expires_at: "2026-12-01" };
    if (init?.method === "POST") { bodies.push(JSON.parse(String(init.body))); active = true; return Response.json(row, { status: 201 }); }
    if (init?.method === "DELETE") { active = false; return new Response(null, { status: 204 }); }
    return Response.json({ invites: active ? [row] : [] });
  };
  const node = container;
  try {
    await act(async () => root.render(<InvitePanel savedId={5} locale="en" />));
    await settle();
    const input = node.querySelector<HTMLInputElement>("input[type=email]")!;
    assert.ok(node.querySelector(`label[for="${input.id}"]`));
    await act(async () => {
      typeInto(input, "friend@example.com");
    });
    await act(async () => node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await settle();
    assert.deepEqual(bodies, [{ email: "friend@example.com" }]);
    assert.ok(node.textContent?.includes("Invitation sent."));
    assert.ok(node.textContent?.includes("Pending"));
    const revoke = Array.from(node.querySelectorAll("button")).find((button) => button.textContent === "Revoke invitation")!;
    await act(async () => revoke.click()); await settle();
    assert.ok(!node.textContent?.includes("friend@example.com"));
    assert.ok(calls.includes("DELETE /api/v1/invites/9/"));
    assert.equal(calls.filter((call) => call === "GET /api/v1/saved-cases/5/invites/").length, 3);
  } finally { /* The suite hooks clean up the root and DOM. */ }
});


test("a stale initial invite list cannot overwrite the list refreshed after sending", async () => {
  const { InvitePanel } = await import("./invite-panel");
  let resolveInitial!: (response: Response) => void;
  let initialSignal: AbortSignal | null | undefined;
  let reads = 0;
  const row = { id: 9, email: "friend@example.com", status: "pending", expires_at: "2026-12-01" };
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") return Response.json(row, { status: 201 });
    if (++reads === 1) {
      initialSignal = init?.signal;
      return new Promise<Response>((resolve) => { resolveInitial = resolve; });
    }
    return Response.json({ invites: [row] });
  };
  await act(async () => root.render(<InvitePanel savedId={5} locale="en" />));
  await settle();
  const input = container.querySelector<HTMLInputElement>("input[type=email]")!;
  await act(async () => {
    typeInto(input, row.email);
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle();
  assert.equal(initialSignal?.aborted, true);
  assert.equal(reads, 2);
  await act(async () => resolveInitial(Response.json({ invites: [] })));
  await settle();
  assert.ok(container.textContent?.includes(row.email));
});
