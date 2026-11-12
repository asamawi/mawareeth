import assert from "node:assert/strict";
import { test } from "node:test";

import { authLinks, loginHref, pathForLocale, signupHref, resultsResumePath } from "./paths.ts";

test("switching language keeps the page", () => {
  assert.equal(pathForLocale("/en/interview/", "ar"), "/ar/interview/");
  assert.equal(pathForLocale("/ar/interview", "fr"), "/fr/interview/");
});

test("the locale root stays the locale root", () => {
  assert.equal(pathForLocale("/en/", "fr"), "/fr/");
  assert.equal(pathForLocale("/en", "ar"), "/ar/");
});

test("login returns the visitor to the current page under /app", () => {
  assert.equal(
    loginHref("/ar/interview/"),
    "/app/ar/login/?next=%2Fapp%2Far%2Finterview%2F",
  );
});

test("login and signup show for anyone not logged in, and hide for a logged-in visitor", () => {
  assert.deepEqual(authLinks(false, "fr", "/fr/interview/"), [
    { kind: "login", href: "/app/fr/login/?next=%2Fapp%2Ffr%2Finterview%2F" },
    { kind: "signup", href: "/app/fr/signup/?next=%2Fapp%2Ffr%2Finterview%2F" },
  ]);
  assert.deepEqual(authLinks(true, "fr", "/fr/interview/"), []);
});

test("resume auth links encode their entire destination", () => {
  const path = resultsResumePath("en", "save");
  assert.equal(path, "/en/results/?resume=save");
  assert.equal(signupHref("en", path), "/app/en/signup/?next=%2Fapp%2Fen%2Fresults%2F%3Fresume%3Dsave");
  assert.equal(loginHref(resultsResumePath("ar", "share")), "/app/ar/login/?next=%2Fapp%2Far%2Fresults%2F%3Fresume%3Dshare");
});

test("the share link carries its token in the fragment under /app", async () => {
  const { shareUrl, sharedPath } = await import("./paths.ts");
  assert.equal(sharedPath("ar"), "/ar/shared/");
  assert.equal(shareUrl("https://x.test", "ar", "tok-1_a"), "https://x.test/app/ar/shared/#tok-1_a");
});
