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

export function previewFixture(title: string): PreviewFixture {
  const fixture = previewFixtures.find((item) => item.title === title);
  if (!fixture) throw new Error(`no preview fixture titled ${title}`);
  return fixture;
}
