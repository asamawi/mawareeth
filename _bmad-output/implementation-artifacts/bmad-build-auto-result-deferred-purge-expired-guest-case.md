---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: intent gap. The chosen deferred item ("An expired guest Case is not deleted from the session on read; it reads as no Case until replaced", Story 8.9 follow-ups in `deferred-work.md`) has two defensible designs with different observable behaviour, and most of its value is already covered by session expiry.

## Evidence (codex investigation, 2026-11-22)

- Anonymous visitors: `touch()` (`api/anonymous_case.py:480`) sets the session expiry to `ANONYMOUS_CASE_IDLE_SECONDS` (24 h) on every case write, the same clock that expires the case. So the Django session row expires at about the same moment, loads as empty, and the daily `clearsessions` timer (`deploy/README.md:619`) deletes it. For guests the case data is already gone within about a day.
- The only real gap is a guest (unsaved) case in a **logged-in** session. That session keeps Django's default age (`SESSION_COOKIE_AGE`, 2 weeks), so the expired case data stays in the session row until that session ends.
- Purging on read means writing the session on GET requests (case GET, preview, draft report). Today these never modify the session, and they bypass `CaseWriteLockMiddleware` (`mawareeth/middleware.py:50,69-114`). A GET-time save writes the whole session row back. It could overwrite a concurrent start or saved-case open from another tab, and it would refresh the session expiry and send a new `Set-Cookie`.
- Keeping today's responses (`{"case": null, "code": "expired"}`, `404 ... "code": "expired"` in `api/views.py:65-69,197-206,305-311,360-370`, `reports/views.py:34-49`) needs a boolean tombstone in place of the case, cleared by `start()` and by opening a saved case, and carried through login (`api/signals.py:13`).

## Questions for the owner

1. Is it worth purging expired guest cases at all, given that guest sessions already expire with the case and only logged-in sessions keep them (up to 2 weeks)?
2. If yes, choose one:
   - (a) Purge on any read, behind a tombstone, with a conditional session save that does not overwrite a concurrent start or open and keeps the expiry and cookie unchanged. This is the most complete option and also the most complex.
   - (b) Purge only on writes that already run under the case lock (mutations, save, start), plus on login. This is simpler and has no GET-time session writes, but an expired case that is only read stays until the next write or the session's end.
   - (c) Cap logged-in sessions that hold only a guest case. Or drop the item, and record in `deferred-work.md` that guest sessions already expire with the case.
