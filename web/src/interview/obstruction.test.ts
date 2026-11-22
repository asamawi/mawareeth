import assert from "node:assert/strict";
import { test } from "node:test";

import { obstructionPx } from "./obstruction.ts";

test("the obstruction is the sum of the heights", () => {
  assert.equal(obstructionPx([60, 40], 800), 100);
  assert.equal(obstructionPx([], 800), 0);
});

test("the obstruction is capped at a quarter of the viewport", () => {
  assert.equal(obstructionPx([150, 150], 800), 200);
  assert.equal(obstructionPx([1000], 400), 100);
});

test("removing an entry lowers the sum", () => {
  assert.equal(obstructionPx([60, 40], 800), 100);
  assert.equal(obstructionPx([40], 800), 40);
});

test("a zero viewport covers nothing and negative heights are ignored", () => {
  assert.equal(obstructionPx([50], 0), 0);
  assert.equal(obstructionPx([-20, 30], 800), 30);
});

test("the registry writes the variable on the root element and recomputes on removal and resize", async () => {
  const style = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { documentElement: { style: { setProperty: (k: string, v: string) => style.set(k, v) } } };
  g.window = { innerHeight: 800, addEventListener: (n: string, f: () => void) => listeners.set(n, f), removeEventListener: (n: string) => listeners.delete(n) };
  try {
    const { setObstruction } = await import("./obstruction.ts");
    setObstruction("toast", 60);
    setObstruction("summary", 40);
    assert.equal(style.get("--interview-obstruction"), "100px");
    setObstruction("toast", null);
    assert.equal(style.get("--interview-obstruction"), "40px");
    (g.window as { innerHeight: number }).innerHeight = 100;
    listeners.get("resize")!();
    assert.equal(style.get("--interview-obstruction"), "25px");
    setObstruction("summary", null);
    assert.equal(style.get("--interview-obstruction"), "0px");
    assert.equal(listeners.size, 0);
  } finally {
    delete g.document;
    delete g.window;
  }
});
