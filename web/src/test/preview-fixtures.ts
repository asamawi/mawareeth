import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Case } from "../api/case.ts";

const contracts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "api", "contracts");

export type PreviewFixture = { title: string; case: Case; response: unknown };

const legacy = (JSON.parse(readFileSync(join(contracts, "preview-fixtures.json"), "utf8")) as { fixtures: PreviewFixture[] }).fixtures;
const presented = (JSON.parse(readFileSync(join(contracts, "preview-presented-fixtures.json"), "utf8")) as {
  presented: Record<string, unknown>;
}).presented;

/**
 * The shared preview fixtures as the server serves them today: each legacy response with the
 * PresentedResult (v3, English) the preview adds beside it. The legacy bodies are unchanged.
 */
export const previewFixtures: PreviewFixture[] = legacy.map((fixture) =>
  fixture.title in presented ? { ...fixture, response: { ...(fixture.response as object), presented: presented[fixture.title] } } : fixture,
);

/**
 * What the server serves when no School is chosen and all four refuse for different reasons: the legacy
 * `unavailable` envelope (outer reason is the Hanbali one) with the compare-Basis presentation naming each reason.
 */
export function mixedRefusalFixture(): PreviewFixture {
  const base = previewFixture("Impossible family");
  const legacyBody = base.response as { basis: Record<string, unknown> };
  const presentedBody = presented["Impossible family"] as Record<string, unknown>;
  const refusals = [
    { school: null, reason: "manasikhat_unsupported", text: "Successive deaths of this kind are not supported yet." },
    { school: null, reason: "invalid_family", text: "This family is not possible, so no shares are shown." },
  ];
  return {
    ...base,
    title: "All four refuse for different reasons",
    response: {
      status: "unavailable", madhab: null, reason: "invalid_family", revision: 7,
      basis: { ...legacyBody.basis, madhab: null },
      presented: { ...presentedBody, basis: { kind: "compare" }, state: "refused", comparison_outcome: "all_refused", school_line: null, refusals },
    },
  };
}

export function previewFixture(title: string): PreviewFixture {
  const fixture = previewFixtures.find((item) => item.title === title);
  if (!fixture) throw new Error(`no preview fixture titled ${title}`);
  return fixture;
}
