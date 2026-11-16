import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { MADHAB_IDS, RELATIONSHIP_IDS, isGender } from "../api/case.ts";

import {
  CODES, CONTRACT_VERSIONS, ContractError, dumpBasis, dumpCatalog, dumpComparison, dumpFamily, dumpPresentedResult,
  dumpPreset, dumpResult, parseBasis, parseCatalog, parseComparison, parseFamily, parsePresentedResult, parsePreset,
  parseResult,
} from "./index.ts";

const contractsUrl = (path: string) => new URL(`../../../contracts/${path}`, import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(contractsUrl(path), "utf8"));

const PARSERS: Record<string, [(data: unknown) => unknown, (value: never) => unknown]> = {
  family: [parseFamily, dumpFamily],
  basis: [parseBasis, dumpBasis],
  result: [parseResult, dumpResult],
  comparison: [parseComparison, dumpComparison],
  presented_result: [parsePresentedResult, dumpPresentedResult],
  preset: [parsePreset, dumpPreset],
  catalog: [parseCatalog, dumpCatalog],
};

test("every valid fixture round-trips", () => {
  for (const [name, [parse, dump]] of Object.entries(PARSERS)) {
    const files = readdirSync(contractsUrl(`fixtures/${name}/`)).filter((f) => f.endsWith(".json"));
    assert.ok(files.length > 0, name);
    for (const file of files) {
      const document = readJson(`fixtures/${name}/${file}`);
      assert.deepEqual(dump(parse(document) as never), document, `${name}/${file}`);
    }
  }
});

test("every invalid fixture throws its exact code, except resolver-only cases", () => {
  for (const [name, [parse]] of Object.entries(PARSERS)) {
    const cases: { name: string; input: unknown; error: string; presets?: unknown }[] = readJson(`fixtures/invalid/${name}.json`);
    assert.ok(cases.length > 0, name);
    for (const c of cases) {
      if (c.presets !== undefined && c.error === "preset_unavailable") continue;
      assert.throws(
        () => parse(c.input),
        (error: unknown) => {
          assert.ok(error instanceof ContractError, `${name}: ${c.name}`);
          assert.equal(error.code, c.error, `${name}: ${c.name}`);
          assert.deepEqual(Object.keys(error.toDict()).sort(), ["detail", "error"]);
          assert.equal(typeof error.detail, "string");
          return true;
        },
        `${name}: ${c.name}`,
      );
    }
  }
});

test("fractions are exact and never normalised", () => {
  const blocked = readJson("fixtures/result/blocked.json");
  const withShare = (share: unknown) => {
    const copy = structuredClone(blocked);
    copy.allocations[0].share = share;
    return copy;
  };
  assert.deepEqual(parseResult(withShare({ numerator: 1, denominator: 6 })).allocations[0].share, { numerator: 1, denominator: 6 });
  for (const share of [
    0.5, { numerator: 2, denominator: 4 }, { numerator: 1, denominator: 0 }, { numerator: -1, denominator: 6 },
    { numerator: true, denominator: 6 }, { numerator: 2 ** 53, denominator: 1 },
  ]) {
    assert.throws(() => parseResult(withShare(share)), (e: unknown) => e instanceof ContractError && e.code === "invalid_contract");
  }
});

test("codes.ts equals codes.json and the versions equal the manifest", () => {
  assert.deepEqual(CODES, readJson("codes.json"));
  assert.deepEqual(CONTRACT_VERSIONS, readJson("manifest.json"));
});

test("the web app's own code lists equal the shared vocabulary", () => {
  const shared = readJson("codes.json");
  assert.deepEqual([...MADHAB_IDS], shared.schools);
  assert.deepEqual([...RELATIONSHIP_IDS], shared.relationships);
  for (const gender of shared.genders) assert.ok(isGender(gender), gender);
  for (const other of ["other", "", "Male", null]) assert.ok(!isGender(other), String(other));
});
