---
title: 'Remove completed work from the deferred-work backlog and tidy it'
type: 'chore'
created: '2026-11-10'
status: 'done'
route: 'one-shot'
---

# Remove completed work from the deferred-work backlog and tidy it

## Intent

**Problem:** `deferred-work.md` had grown to 137 entries in 449 lines, with no grouping. About half were already done, either marked `resolved_by` or shipped without the entry being updated, so the open work was hard to see.

**Approach:** Check each entry against the code and git history. Remove the done and obsolete ones, cut partly-done ones down to what is still open, merge duplicates, and group the 68 that remain under nine area headings, keeping the entry format. Git history keeps the removed entries.

## Suggested Review Order

**Header and format**

- [deferred-work.md:1](deferred-work.md#L1): new preamble that states the entry format and the removal policy.

**Partly-shipped entries cut down to the open remainder**

- [deferred-work.md:30](deferred-work.md#L30): config rotation; the candidate-slot rotation shipped in `0a35899`.
- [deferred-work.md:168](deferred-work.md#L168): row lock for heir edits and the 404 path; case deletion locking shipped in `42181ce`.
- [deferred-work.md:241](deferred-work.md#L241): relationship list; grandmother lines shipped.

**Scope corrections**

- [deferred-work.md:175](deferred-work.md#L175): Hanbali label scoped to the legacy results views.

**Grouping**

- [deferred-work.md:7](deferred-work.md#L7): area sections, from Deploy & host through Product scope.
