import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MADHAB,
  MADHAB_IDS,
  initialPick,
  selectedMadhab,
  selectionFor,
  selectionStore,
  showDefaultNotice,
} from "./madhabs.ts";

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set("mawareeth.madhab-selection", initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

test("five schools in order, Hanbali the default", () => {
  assert.deepEqual([...MADHAB_IDS], ["hanafi", "maliki", "shafii", "hanbali", "jafari"]);
  assert.equal(DEFAULT_MADHAB, "hanbali");
});

test("the store round-trips a record and removes it", () => {
  const storage = memory();
  const store = selectionStore(() => storage);
  assert.equal(store.get(), null);
  store.set({ caseId: "c1", madhab: null });
  assert.deepEqual(store.get(), { caseId: "c1", madhab: null });
  store.set({ caseId: "c1", madhab: "maliki" });
  assert.deepEqual(store.get(), { caseId: "c1", madhab: "maliki" });
  store.set(null);
  assert.equal(store.get(), null);
});

test("garbage in storage reads as no record", () => {
  for (const raw of ["not json", "5", "null", '{"caseId":3,"madhab":null}', '{"caseId":"c","madhab":"zaydi"}', "{}"]) {
    assert.equal(selectionStore(() => memory(raw)).get(), null, raw);
  }
});

test("blocked storage never throws", () => {
  const blocked = () => {
    throw new DOMException("denied", "SecurityError");
  };
  const store = selectionStore(blocked);
  assert.equal(store.get(), null);
  store.set({ caseId: "c1", madhab: null });
  store.set(null);
  const throwing = selectionStore(() => ({
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  }));
  assert.equal(throwing.get(), null);
  throwing.set({ caseId: "c1", madhab: "hanafi" });
  throwing.set(null);
});

test("a record belongs to one case only", () => {
  const record = { caseId: "c1", madhab: "hanafi" as const };
  assert.equal(selectionFor(record, "c1"), record);
  assert.equal(selectionFor(record, "c2"), null);
  assert.equal(selectionFor(null, "c1"), null);
});

test("selected school: pick, then stored, then default", () => {
  assert.equal(selectedMadhab(null, null), "hanbali");
  assert.equal(selectedMadhab("maliki", null), "maliki");
  assert.equal(selectedMadhab("maliki", "jafari"), "jafari");
  assert.equal(selectedMadhab(null, "hanafi"), "hanafi");
});

test("the default notice shows only with nothing stored and nothing picked", () => {
  assert.equal(showDefaultNotice(null, null), true);
  assert.equal(showDefaultNotice(null, "hanbali"), false);
  assert.equal(showDefaultNotice("hanbali", null), false);
  assert.equal(showDefaultNotice("hanafi", "maliki"), false);
});

test("the initial pick comes from this case's record only", () => {
  const kase = { id: "c1", started_at: "t", madhab: null, deceased: null, heirs: [] };
  assert.equal(initialPick({ caseId: "c1", madhab: "jafari" }, kase), "jafari");
  assert.equal(initialPick({ caseId: "c1", madhab: null }, kase), null);
  assert.equal(initialPick({ caseId: "other", madhab: "jafari" }, kase), null);
  assert.equal(initialPick(null, kase), null);
});

test("the default store is sessionStorage, not localStorage", () => {
  const session = memory();
  const local = memory();
  const g = globalThis as Record<string, unknown>;
  const saved = { sessionStorage: g.sessionStorage, localStorage: g.localStorage };
  try {
    g.sessionStorage = session;
    g.localStorage = local;
    const store = selectionStore();
    store.set({ caseId: "c1", madhab: "shafii" });
    assert.deepEqual(store.get(), { caseId: "c1", madhab: "shafii" });
    assert.notEqual(session.getItem("mawareeth.madhab-selection"), null);
    assert.equal(local.getItem("mawareeth.madhab-selection"), null);
    store.set(null);
    assert.equal(session.getItem("mawareeth.madhab-selection"), null);
  } finally {
    g.sessionStorage = saved.sessionStorage;
    g.localStorage = saved.localStorage;
  }
});

test("the default store survives a throwing sessionStorage accessor", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  try {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    const store = selectionStore();
    assert.equal(store.get(), null);
    store.set({ caseId: "c1", madhab: null });
    store.set(null);
  } finally {
    if (saved) Object.defineProperty(globalThis, "sessionStorage", saved);
    else delete g.sessionStorage;
  }
});
