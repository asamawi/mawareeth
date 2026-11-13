---
title: 'Fill empty English catalog entries blanking the error and login pages'
type: 'bugfix'
created: '2026-11-12'
status: 'done'
route: 'one-shot'
---

# Fill empty English catalog entries blanking the error and login pages

## Intent

**Problem:** Seven English msgids (the 404 and 500 page text and the login "no access" message) had an empty `msgstr` in `locale/en/LC_MESSAGES/django.po`, and the ad-hoc script that compiled `django.mo` (no `msgfmt` on the dev box) copied those empty strings into the catalog. gettext returned `""`, so the English pages rendered blank headings and links, and four `calc` tests (`ErrorPageTests` ×3, `TemplateTagTests.test_login_no_access_message_is_translated`) failed at baseline.

**Approach:** Set each of the seven English `msgstr` to its `msgid` (the English catalog's convention), rebuild the English `.mo` (its catalog differs from the old one in exactly those seven keys), and add a test that fails when any compiled catalog maps a message to an empty string.

## Suggested Review Order

**Catalog fix**

- The seven English entries now carry their own text instead of an empty translation.
  [`django.po:2277`](../../locale/en/LC_MESSAGES/django.po#L2277)

**Regression guard**

- Fails on any compiled catalog with an empty translation; verified red on the old `.mo`.
  [`tests.py:1310`](../../calc/tests.py#L1310)
