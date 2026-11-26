import assert from "node:assert/strict";
import { test } from "node:test";
import { takeOpenHandoff, writeOpenHandoff } from "./open-handoff.ts";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}

test("the hand-off is taken once", () => {
  const store = memory();
  writeOpenHandoff("abc", () => store);
  assert.equal(takeOpenHandoff(() => store), "abc");
  assert.equal(takeOpenHandoff(() => store), null);
});

test("missing or failing storage reads as none and never throws", () => {
  const broken = () => { throw new Error("blocked"); };
  assert.doesNotThrow(() => writeOpenHandoff("abc", broken));
  assert.equal(takeOpenHandoff(broken), null);
});
