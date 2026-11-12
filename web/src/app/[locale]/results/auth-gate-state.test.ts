import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, parseResume } from "./auth-gate-state.ts";
test("only authenticated sessions skip the sign-in dialog", () => {
  for (const auth of ["loading", "anonymous", "error"] as const) assert.equal(decide(auth), "dialog");
  assert.equal(decide("authenticated"), "notice");
});
test("resume accepts save/share, strips unknown values, and keeps other parameters", () => {
  for (const action of ["save", "share"]) assert.deepEqual(parseResume(`?resume=${action}&keep=a%26b`), { action, search: "?keep=a%26b" });
  assert.deepEqual(parseResume("?resume=unknown&keep=1"), { action: null, search: "?keep=1" });
  assert.deepEqual(parseResume(""), { action: null, search: "" });
});


test("an authenticated session performs the action it asked for", async () => {
  const { authorizedAction } = await import("./auth-gate-state.ts");
  assert.equal(authorizedAction("authenticated", "save"), "save");
  assert.equal(authorizedAction("authenticated", "share"), "share");
  for (const state of ["loading", "anonymous", "error"] as const) {
    assert.equal(authorizedAction(state, "save"), "dialog");
    assert.equal(authorizedAction(state, "share"), "dialog");
  }
});
