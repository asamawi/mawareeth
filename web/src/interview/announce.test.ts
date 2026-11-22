import assert from "node:assert/strict";
import { test } from "node:test";

import { createCoalescer } from "./announce.ts";

function fake() {
  let now = 0;
  let next = 1;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const said: string[] = [];
  const c = createCoalescer<number>(
    (text) => said.push(text),
    (fn, ms) => { const id = next++; jobs.set(id, { at: now + ms, fn }); return id; },
    (id) => { jobs.delete(id); },
  );
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      jobs.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { c, said, advance };
}

test("nothing is said until 800ms after the last post", () => {
  const { c, said, advance } = fake();
  c.post("action", "Son 2 added.");
  advance(799);
  assert.deepEqual(said, []);
  advance(1);
  assert.deepEqual(said, ["Son 2 added."]);
});

test("a post restarts the timer", () => {
  const { c, said, advance } = fake();
  c.post("action", "A");
  advance(500);
  c.post("zoom", "Zoom 125%");
  advance(500);
  assert.deepEqual(said, []);
  advance(300);
  assert.deepEqual(said, ["A Zoom 125%"]);
});

test("a post of the same kind replaces the pending one", () => {
  const { c, said, advance } = fake();
  c.post("action", "first");
  advance(300);
  c.post("action", "second");
  advance(800);
  assert.deepEqual(said, ["second"]);
});

test("parts are joined in the order action, zoom, preview, progress", () => {
  const { c, said, advance } = fake();
  c.post("progress", "Updating");
  c.post("preview", "Heirs: 7. Shares ready.");
  c.post("zoom", "Zoom 125%");
  c.post("action", "Son 2 added.");
  advance(800);
  assert.deepEqual(said, ["Son 2 added. Zoom 125% Heirs: 7. Shares ready. Updating"]);
});

test("the same sentence is emitted again and the coalescer is idle between", () => {
  const { c, said, advance } = fake();
  c.post("action", "Undone.");
  advance(800);
  c.post("action", "Undone.");
  advance(800);
  assert.deepEqual(said, ["Undone.", "Undone."]);
  advance(5000);
  assert.equal(said.length, 2);
});

test("a slow preview speaks the action first and the result later", () => {
  const { c, said, advance } = fake();
  c.post("action", "Son 2 added.");
  advance(800);
  c.post("progress", "Updating the preview…");
  advance(800);
  c.post("preview", "Heirs: 7. Shares ready.");
  advance(800);
  assert.deepEqual(said, ["Son 2 added.", "Updating the preview…", "Heirs: 7. Shares ready."]);
});

test("cancel drops what is pending", () => {
  const { c, said, advance } = fake();
  c.post("action", "A");
  c.cancel();
  advance(2000);
  assert.deepEqual(said, []);
});

test("drop removes pending parts of the given kinds only", () => {
  const { c, said, advance } = fake();
  c.post("action", "Son 3 added.");
  c.post("preview", "Heirs: 7. Shares ready.");
  c.post("progress", "Updating the preview…");
  c.drop("preview", "progress");
  advance(800);
  assert.deepEqual(said, ["Son 3 added."]);
  c.post("progress", "Updating the preview…");
  c.drop("progress");
  advance(800);
  assert.deepEqual(said, ["Son 3 added."]);
});
