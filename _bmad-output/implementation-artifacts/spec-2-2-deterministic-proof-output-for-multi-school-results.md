---
title: 'Story 2.2: Deterministic Proof Output for Multi-School Results'
type: 'feature'
created: '2026-11-09'
status: 'done'
baseline_commit: '1c68064a8b49e011f9f89dd2da1e9c80f0c89fe0'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A result carries no proof. Each heir has only one free-text, already-translated `quote_reason`, so nobody can trace a share to the rule and school behind it, and Epic 3 has nothing stable to render.

**Approach:** `compute()` also builds a structured proof from stable codes: each heir's rule, its condition, who blocked it, the Quranic verse where the share is Quranic, and the school rule wherever schools diverge. It also records the steps: base, awl, radd, correction and unallocated. Every code has an ar/en/fr label. The preview API returns the proof under a contract. Nothing new is shown on screen.

## Boundaries & Constraints

**Always:**
- The proof is plain data with exact fractions as `{numerator, denominator}` and a `version: 1`. The same family and school give an identical proof in any entry order and on any number of runs. Heir references are the only difference.
- Every heir in a result has exactly one proof entry, and its final share equals `compute()`'s fraction for that heir.
- When a divergence predicate in `calc/schools.py` decides a family, the proof names the school rule that applied. This holds for both sides, so Hanafi says `grandfather_blocks_siblings` and the others say `grandfather_shares_with_siblings`.
- Verses are only these: 4:11 (children, parents), 4:12 (spouses, maternal siblings), 4:176 (full and paternal siblings). Every other entry has no verse.
- Each new code has a label in Arabic, English and French, enforced by test. The proof itself stays language-free. The preview attaches labels in the request's active language.
- `quote_reason`, results pages, `compute()`'s return value and no-argument behaviour stay unchanged.

**Ask First:** Any schema migration. Any verse other than those three. Hadith, ijma or scholar citations. Any change to an existing preview field.

**Never:** Showing the proof in the UI (deferred item and Epic 3). Storing the proof. Jafari. Changing any share. Pushing this work.

## I/O & Edge-Case Matrix

Deceased male unless noted. A per-heir row reads `rule / condition / blocked_by / verse / school_rule`.

| School | Family | Expected proof |
|--------|--------|----------------|
| Hanbali | Wife, son | wife `fixed 1/8 / descendant / – / 4:12 / –`; son `residuary / – / – / 4:11 / –`; steps `base 8` |
| Hanafi | Grandfather, brother | brother `blocked / – / grandfather / – / grandfather_blocks_siblings`; grandfather also tagged with that rule |
| Hanbali, Maliki, Shafi'i | Grandfather, brother | grandfather `grandfather_best_option` with option `muqasama`; both tagged `grandfather_shares_with_siblings` |
| Maliki, Shafi'i, deceased female | Husband, mother, 2 maternal brothers, brother | the siblings `mushtaraka`, tagged `mushtaraka` |
| Hanafi, Hanbali, same family | As above | brother `residuary`, final 0; the maternal siblings `fixed 1/3` 4:12; tagged `no_mushtaraka` |
| Any Sunni, deceased female | Husband, 2 sisters | steps `base 6`, `awl 7` |
| Hanbali | Mother, daughter | steps include `radd`; tagged `radd` |
| Any Sunni | Wife | step `unallocated 3/4` |
| Hanbali, deceased female | Husband, mother, grandfather, sister | grandfather and sister `akdariyya` |
| Any | Refused case | No proof; the preview stays `unavailable` exactly as today |

</frozen-after-approval>

## Code Map

- `calc/models.py:819` -- `compute()`. Set a transient `self.proof` at the end, like `madhab` at `:258`. Never a field.
- `calc/models.py:921-1607` -- every `get_quote()` sets `quote_reason`. Set a structured basis (rule, condition, blocked_by) beside each one and leave the text alone. Clear it in `Heir.clear` at `:914`.
- `calc/models.py:552-799` -- `distribute()`. Reasons are overridden here for mushtaraka (`:600`), the grandfather's options (`:608-625`), akdariyya (`:620`) and residuaries left with nothing (`:651-665`), applied at `:782`. Override the basis in the same places. The step facts are locals: `base` `:696`, `excess` `:678`, `radd` `:681`, `correction` `:755`, `extra` `:668`, `gf_mode` `:562`.
- `calc/schools.py` -- the divergence predicates `:49-95`. Add the school-rule codes here.
- `calc/models.py:381`, `:1614` -- `FIQH_ORDER`, which gives the proof's order.
- `api/preview.py:76-127` -- `_compute` maps pk to session id; `preview()` builds the available body. Add `proof` there.
- `api/contracts/preview-fixtures.json`, `api/tests.py:1252-1340` -- the contract fixtures and PreviewTests.
- `web/src/api/case.ts:437-551`, `web/src/interview/preview.test.ts:20` -- preview types, `parsePreview` and the fixture test.
- `calc/tests.py` -- `build_case` `:1432`, `run()` `:1915`, `SCHOOL_FIXTURES` `:1869`, `families()` `:1705`, `fingerprint` `:1728`, `test_reasons_are_translated` `:2000`.
- `locale/{ar,en,fr}/LC_MESSAGES/django.po`, `.mo` -- `msgfmt` is not installed, so build `.mo` by script as in Story 2.1.

## Tasks & Acceptance

**Execution:**
- [x] `calc/proof.py` -- new pure module: the closed code vocabulary (rules, conditions, school rules, steps), `VERSES` by rule and relationship, `LABELS` (gettext_lazy) and `build()`, which assembles the proof dict from per-heir bases and step facts. This keeps the proof contract in one place.
- [x] `calc/schools.py` -- add the school-rule codes and one pure function per divergence that reports which code applies.
- [x] `calc/models.py` -- record a basis at every `quote_reason` site and in `distribute()`'s overrides, collect the step facts, and set `self.proof` in `compute()`.
- [x] `locale/{ar,en,fr}/LC_MESSAGES/django.po` and `.mo` -- add a label for every code.
- [x] `calc/tests.py` -- one test per matrix row. Over `families()` and every Sunni school, assert each heir has one entry, its share equals `compute()`'s, the proof is identical across entry orders and repeated runs, and every code has a translated label.
- [x] `api/preview.py` -- add `proof` to the available body, with heir ids mapped to session ids and a `label` on each code in the active language.
- [x] `api/contracts/preview-fixtures.json`, `api/tests.py` -- add the proof to each available fixture with English labels, add the matrix's school pairs, and test that an Arabic request gets Arabic labels.
- [x] `web/src/api/case.ts`, `web/src/interview/preview.test.ts` -- add a `PreviewProof` type, validate it in `parsePreview` and reject a malformed proof.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- note the deferred hadith and ijma citations and the qualified review of codes, labels and verses.

**Acceptance Criteria:**
- Given any supported result, when it is returned, then it carries a version-1 proof for the selected school.
- Given one family under two schools that differ for it, when the proofs are compared, then each names its own school rule.
- Given a saved case, when its results page opens, then it looks exactly as before.

## Design Notes

Proof shape (heir is the engine pk, or the session id in the preview):

```python
{'version': 1, 'madhab': 'hanafi', 'school_rules': ['grandfather_blocks_siblings'],
 'heirs': [{'heir': 7, 'relationship': 'brother', 'rule': 'blocked', 'condition': None,
            'blocked_by': 'grandfather', 'fraction': None, 'share': {'numerator': 0, 'denominator': 1},
            'verse': None, 'school_rule': 'grandfather_blocks_siblings', 'option': None}],
 'steps': [{'step': 'base', 'value': 1}]}
```

The basis lives beside `quote_reason`, not derived from it, because `quote_reason` is translated at the point it is set. School codes are sorted so the order is fixed.

## Verification

**Commands:**
- `DATABASE_URL='sqlite://:memory:' DJANGO_ENV=test .venv/Scripts/python.exe manage.py test calc api` -- expected: all pass.
- `npm test` in `web/` -- expected: all pass.

**Manual checks:**
- A qualified reviewer reads the codes, verse assignments and Arabic and French labels.

## Suggested Review Order

**The proof contract**

- Start here: the closed code vocabulary, verses and labels that form the version-1 contract.
  [`proof.py:52`](../../calc/proof.py#L52)

- Assembles the language-free proof dict; fails loudly on a missing basis or class.
  [`proof.py:170`](../../calc/proof.py#L170)

- Built at the end of `compute()`; reset first so refusals never leave a stale proof.
  [`models.py:877`](../../calc/models.py#L877)

**Where schools differ**

- Each divergence reports its own school-rule code, for both sides.
  [`schools.py:82`](../../calc/schools.py#L82)

- Tags heirs with the school rule that decided them; spouses excluded from radd.
  [`models.py:830`](../../calc/models.py#L830)

**Rules recorded in the engine**

- Basis set beside every `quote_reason`; reason text stays untouched.
  [`models.py:948`](../../calc/models.py#L948)

- Grandfather's three options, each named, the best one recorded.
  [`models.py:615`](../../calc/models.py#L615)

- Residuaries and father/grandfather left with no remainder say so.
  [`models.py:706`](../../calc/models.py#L706)

- Radd step reports the base the final shares actually use.
  [`models.py:824`](../../calc/models.py#L824)

**Preview contract**

- Maps pks to session ids and attaches labels in the request language.
  [`preview.py:74`](../../api/preview.py#L74)

- Strict client parser: exact keys, typed steps, ids and shares cross-checked.
  [`case.ts:638`](../../web/src/api/case.ts#L638)

**Tests and translations**

- One test per matrix row; the qualified reviewer should read these first.
  [`tests.py:2150`](../../calc/tests.py#L2150)

- Invariants over every family and school: one entry per heir, determinism, option formula.
  [`tests.py:2374`](../../calc/tests.py#L2374)

- Labels follow the request language at the API.
  [`tests.py:1374`](../../api/tests.py#L1374)

- New labels; the Arabic and French are unreviewed. `.mo` built by script.
  [`django.po:2350`](../../locale/ar/LC_MESSAGES/django.po#L2350)
