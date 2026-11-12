import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createInvite, listInvites, revokeInvite, acceptInvite, listReceived, viewReceived, downloadReceivedReport } from "./invites.ts";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const signal = () => new AbortController().signal;
const options = { cookie: () => "csrftoken=csrf" };
const row = { id: 7, email: "friend@example.com", status: "pending", expires_at: "2026-12-01" };
test("owner invite operations use CSRF and never return a token", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/saved-cases/5/invites/");
    assert.equal(init?.body, JSON.stringify({ email: row.email }));
    assert.equal((init?.headers as Record<string, string>)["X-CSRFToken"], "csrf");
    return Response.json(row, { status: 201 });
  };
  assert.deepEqual(await createInvite(signal(), 5, row.email, "en", options), row);
  globalThis.fetch = async () => Response.json({ invites: [row] });
  assert.deepEqual(await listInvites(signal(), 5), [row]);
  globalThis.fetch = async () => Response.json({ invites: [{ id: "bad" }] });
  await assert.rejects(listInvites(signal(), 5));
  globalThis.fetch = async (url, init) => { assert.equal(url, "/api/v1/invites/7/"); assert.equal(init?.method, "DELETE"); return new Response(null, { status: 204 }); };
  assert.equal(await revokeInvite(signal(), 7, options), true);
});
test("accept posts token only in body and maps access errors", async () => {
  globalThis.fetch = async (url, init) => { assert.equal(url, "/api/v1/invites/accept/"); assert.equal(init?.body, JSON.stringify({ token: "secret" })); return Response.json({ id: 7 }); };
  assert.deepEqual(await acceptInvite(signal(), "secret", options), { kind: "accepted", id: 7 });
  for (const [status, body, kind] of [[403, { code: "sign_in_required" }, "sign_in"], [404, {}, "unavailable"], [429, {}, "throttled"], [503, {}, "failed"]] as const) {
    globalThis.fetch = async () => Response.json(body, { status });
    assert.equal((await acceptInvite(signal(), "secret", options)).kind, kind);
    assert.equal((await viewReceived(signal(), 7, "en", options)).kind, kind);
  }
});
test("received listing, preview and report use account endpoints", async () => {
  const received = { id: 7, owner: "owner", updated_at: "t", expires_at: "u" };
  globalThis.fetch = async () => Response.json({ received: [received] });
  assert.deepEqual(await listReceived(signal()), [received]);
  globalThis.fetch = async (url) => { assert.equal(url, "/api/v1/received/7/view/"); return Response.json({ status: "draft", owner: "owner", case: { id: "invite-7", started_at: "t", madhab: null, deceased: null, heirs: [], heir_options: { blocked: [], invalid: {} }, deaths: [] }, preview: { status: "not_ready" } }); };
  assert.equal((await viewReceived(signal(), 7, "en", options)).kind, "view");
  globalThis.fetch = async (url) => { assert.equal(url, "/api/v1/received/7/report/"); return new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }); };
  assert.equal((await downloadReceivedReport(7, "en", options)).kind, "download");
  for (const [status, kind] of [[404, "gone"], [403, "gone"], [409, "unavailable"], [429, "throttled"], [503, "failed"]] as const) {
    globalThis.fetch = async () => new Response("", { status });
    assert.equal((await downloadReceivedReport(7, "en", options)).kind, kind);
  }
});
