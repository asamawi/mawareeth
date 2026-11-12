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
