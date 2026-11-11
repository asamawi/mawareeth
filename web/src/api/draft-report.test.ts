import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { downloadDraftReport } from "./case.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("draft download asks for a same-origin PDF in the page language", async () => {
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, "/api/v1/reports/draft/?case_id=case%20%26%201");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(init?.headers, { Accept: "application/pdf", "Accept-Language": "ar" });
    return new Response("%PDF-test", { headers: { "Content-Type": "application/pdf" } });
  }) as typeof fetch;
  const result = await downloadDraftReport("case & 1", "ar");
  assert.equal(result.kind, "download");
  if (result.kind === "download") assert.equal(await result.blob.text(), "%PDF-test");
});

for (const [status, body, kind] of [
  [404, {}, "gone"], [409, {}, "replaced"],
  [409, { status: "not_ready" }, "unavailable"],
  [409, { status: "unavailable", reason: "school_not_supported" }, "unavailable"],
  [429, {}, "throttled"], [503, {}, "failed"], [500, {}, "failed"],
] as const) {
  test(`draft download maps ${status} ${JSON.stringify(body)}`, async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    assert.deepEqual(await downloadDraftReport("c1", "en"), { kind });
  });
}

test("draft download times out and can retry with a fresh request", async () => {
  let calls = 0;
  globalThis.fetch = ((_url, init) => {
    calls++;
    if (calls === 1) return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    return Promise.resolve(new Response("%PDF-test", { headers: { "Content-Type": "application/pdf" } }));
  }) as typeof fetch;
  assert.deepEqual(await downloadDraftReport("c1", "en", { timeoutMs: 5 }), { kind: "timeout" });
  assert.equal((await downloadDraftReport("c1", "en")).kind, "download");
  assert.equal(calls, 2);
});

test("draft download handles network, malformed, wrong-type and empty answers", async () => {
  for (const response of [new Response("html"), new Response("", { headers: { "Content-Type": "application/pdf" } }), new Response("not json", { status: 409 })]) {
    globalThis.fetch = (async () => response) as typeof fetch;
    assert.deepEqual(await downloadDraftReport("c1", "fr"), { kind: "failed" });
  }
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.deepEqual(await downloadDraftReport("c1", "fr"), { kind: "failed" });
});

test("external abort cancels a pending draft without returning a download", async () => {
  const controller = new AbortController();
  globalThis.fetch = ((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as typeof fetch;
  const pending = downloadDraftReport("c1", "en", { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, { kind: "failed" });
});

test("external abort during blob reading prevents a download", async () => {
  const controller = new AbortController();
  globalThis.fetch = (async () => ({
    ok: true, status: 200, headers: new Headers({ "Content-Type": "application/pdf" }),
    blob: async () => { controller.abort(); return new Blob(["%PDF-test"]); },
  } as Response)) as typeof fetch;
  assert.deepEqual(await downloadDraftReport("c1", "en", { signal: controller.signal }), { kind: "failed" });
});
