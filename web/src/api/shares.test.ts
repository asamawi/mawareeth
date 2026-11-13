import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createShare, downloadSharedReport, listShares, revokeShare, updateShare, viewShare } from "./shares.ts";

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const signal = () => new AbortController().signal;
const options = { cookie: () => "csrftoken=token" };
const share = { id: 7, visibility: "private", created_at: "t", expires_at: "u", expired: false };
const CASE = { id: "share-7", started_at: "t", madhab: null, deceased: null, heirs: [], heir_options: { blocked: [], invalid: {} }, deaths: [] };

test("create posts to the saved case, private by default, and returns the token once", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/saved-cases/5/shares/");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, JSON.stringify({ visibility: "private" }));
    assert.equal((init?.headers as Record<string, string>)["X-CSRFToken"], "token");
    return Response.json({ ...share, token: "abc" }, { status: 201 });
  };
  assert.deepEqual(await createShare(signal(), 5, "private", false, options), { ...share, token: "abc" });
  globalThis.fetch = async () => Response.json({ detail: "x" }, { status: 400 });
  assert.equal(await createShare(signal(), 5, "private", false, options), null);
  assert.equal(await createShare(signal(), 0, "private", false, options), null);
});

test("public carries the accepted warning flag; update and revoke hit the share", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/shares/7/");
    assert.equal(init?.method, "PATCH");
    assert.equal(init?.body, JSON.stringify({ visibility: "public", accept_public_warning: true }));
    return Response.json({ ...share, visibility: "public" });
  };
  assert.equal((await updateShare(signal(), 7, "public", true, options))?.visibility, "public");
  globalThis.fetch = async (url, init) => { assert.equal(init?.method, "DELETE"); return new Response(null, { status: 204 }); };
  assert.equal(await revokeShare(signal(), 7, options), true);
  globalThis.fetch = async () => new Response("", { status: 404 });
  assert.equal(await revokeShare(signal(), 7, options), false);
});

test("list reads shares and rejects malformed rows", async () => {
  globalThis.fetch = async () => Response.json({ shares: [share] });
  assert.deepEqual(await listShares(signal(), 5), [share]);
  globalThis.fetch = async () => Response.json({ shares: [{ id: "x" }] });
  await assert.rejects(listShares(signal(), 5));
  globalThis.fetch = async () => new Response("", { status: 404 });
  await assert.rejects(listShares(signal(), 5));
});

test("view sends the token in the body only and maps each outcome", async () => {
  const seen: string[] = [];
  globalThis.fetch = async (url, init) => { seen.push(String(url)); assert.equal(init?.body, JSON.stringify({ token: "tok" })); assert.equal((init?.headers as Record<string, string>)["Accept-Language"], "ar"); return Response.json({ status: "draft", visibility: "public", case: CASE, preview: { status: "not_ready" } }); };
  const ok = await viewShare(signal(), "tok", "ar", options);
  assert.equal(ok.kind, "view");
  assert.deepEqual(seen, ["/api/v1/shares/view/"]);
  const cases: [number, unknown, string][] = [[403, { code: "sign_in_required" }, "sign_in"], [403, { detail: "x" }, "failed"], [404, {}, "unavailable"], [429, {}, "throttled"], [500, {}, "failed"]];
  for (const [status, body, kind] of cases) {
    globalThis.fetch = async () => Response.json(body, { status });
    assert.equal((await viewShare(signal(), "tok", "en", options)).kind, kind);
  }
  globalThis.fetch = async () => Response.json({ status: "draft", visibility: "public", case: CASE, preview: { nonsense: true } });
  assert.equal((await viewShare(signal(), "tok", "en", options)).kind, "failed");
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal((await viewShare(signal(), "tok", "en", options)).kind, "failed");
});

test("shared PDF download maps statuses", async () => {
  globalThis.fetch = async (url, init) => { assert.equal(url, "/api/v1/shares/report/"); assert.equal(init?.body, JSON.stringify({ token: "tok" })); return new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }); };
  assert.equal((await downloadSharedReport("tok", "en", options)).kind, "download");
  for (const [status, kind] of [[404, "gone"], [409, "unavailable"], [429, "throttled"], [503, "failed"]] as const) {
    globalThis.fetch = async () => new Response("", { status });
    assert.equal((await downloadSharedReport("tok", "en", options)).kind, kind);
  }
});
