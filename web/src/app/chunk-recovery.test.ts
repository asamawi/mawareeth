import assert from "node:assert/strict";
import { test } from "node:test";

import { isChunkLoadError, reloadForChunkError, RELOAD_KEY, shouldAutoReload } from "./chunk-recovery.ts";

test("isChunkLoadError recognises each chunk-failure signature", () => {
  const named = new Error("x");
  named.name = "ChunkLoadError";
  assert.equal(isChunkLoadError(named), true);
  for (const message of [
    "Loading chunk 123 failed.",
    "Loading chunk app-page_abc failed",
    "Loading CSS chunk 7 failed.",
    "Failed to fetch dynamically imported module: https://x/y.js",
    "Importing a module script failed.",
    "error loading dynamically imported module",
  ]) {
    assert.equal(isChunkLoadError(new Error(message)), true, message);
  }
});

test("isChunkLoadError is false for anything else", () => {
  assert.equal(isChunkLoadError(new Error("boom")), false);
  assert.equal(isChunkLoadError("Loading chunk 1 failed"), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
});

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

test("shouldAutoReload allows one reload per 30 seconds", () => {
  const storage = memory();
  assert.equal(shouldAutoReload(storage, 1_000_000), true);
  assert.equal(storage.getItem("mawareeth.chunk-reload-at"), "1000000");
  assert.equal(shouldAutoReload(storage, 1_029_999), false);
  assert.equal(shouldAutoReload(storage, 1_030_000), true);
});

test("shouldAutoReload is false when storage is unavailable or throws", () => {
  assert.equal(shouldAutoReload(undefined, 1), false);
  const throwing = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(shouldAutoReload(throwing, 1), false);
  assert.equal(shouldAutoReload({ getItem: () => null, setItem: () => { throw new Error("full"); } }, 1), false);
});

test("isChunkLoadError duck-types non-Error objects", () => {
  assert.equal(isChunkLoadError({ name: "ChunkLoadError" }), true);
  assert.equal(isChunkLoadError({ message: "Loading chunk 5 failed." }), true);
  assert.equal(isChunkLoadError({ name: 3, message: 4 }), false);
  assert.equal(isChunkLoadError({ message: "boom" }), false);
  assert.equal(isChunkLoadError(42), false);
});

test("shouldAutoReload treats a stored time in the future as stale", () => {
  const storage = memory();
  storage.setItem(RELOAD_KEY, "9000000");
  assert.equal(shouldAutoReload(storage, 1_000_000), true);
  assert.equal(storage.getItem(RELOAD_KEY), "1000000");
});

function stubWindow(sessionStorage: unknown) {
  const calls = { reload: 0 };
  const g = globalThis as Record<string, unknown>;
  const previous = g.window;
  g.window = { sessionStorage, location: { reload: () => (calls.reload += 1) } };
  return { calls, restore: () => (g.window = previous) };
}

test("reloadForChunkError reloads once per 30 seconds, only for chunk errors", () => {
  const stub = stubWindow(memory());
  try {
    const chunk = new Error("Loading chunk 9 failed.");
    assert.equal(reloadForChunkError(chunk), true);
    assert.equal(stub.calls.reload, 1);
    assert.equal(reloadForChunkError(chunk), false);
    assert.equal(stub.calls.reload, 1);
  } finally {
    stub.restore();
  }
});

test("reloadForChunkError ignores other errors and unavailable storage", () => {
  const stub = stubWindow(memory());
  try {
    assert.equal(reloadForChunkError(new Error("boom")), false);
    assert.equal(stub.calls.reload, 0);
  } finally {
    stub.restore();
  }
  const blocked = {};
  Object.defineProperty(blocked, "sessionStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const g = globalThis as Record<string, unknown>;
  const previous = g.window;
  let reloads = 0;
  Object.defineProperty(blocked, "location", { value: { reload: () => (reloads += 1) } });
  g.window = blocked;
  try {
    assert.equal(reloadForChunkError(new Error("Loading chunk 1 failed")), false);
    assert.equal(reloads, 0);
  } finally {
    g.window = previous;
  }
});
