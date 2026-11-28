import assert from "node:assert/strict";
import test from "node:test";

import { terms } from "@/i18n/catalog.generated";
import { suppliedFactsText } from "./notices";

test("the supplied-facts text depends on the locale and on whether an amount was entered", () => {
  for (const locale of ["ar", "en", "fr"]) {
    const catalog = (terms as Record<string, Record<string, string>>)[locale];
    assert.equal(suppliedFactsText(locale, true), catalog["notice.supplied_facts"]);
    assert.equal(suppliedFactsText(locale, false), catalog["notice.supplied_facts_no_amount"]);
    assert.notEqual(suppliedFactsText(locale, true), suppliedFactsText(locale, false));
  }
  assert.equal(suppliedFactsText("xx", true), null);
});
