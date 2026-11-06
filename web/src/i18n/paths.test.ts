import assert from "node:assert/strict";
import { test } from "node:test";

import { authLinks, loginHref, pathForLocale } from "./paths.ts";

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
    "/accounts/login/?next=%2Fapp%2Far%2Finterview%2F",
  );
});

test("login and signup show for anyone not logged in, and hide for a logged-in visitor", () => {
  assert.deepEqual(authLinks(false, "fr", "/fr/interview/"), [
    { kind: "login", href: "/accounts/login/?next=%2Fapp%2Ffr%2Finterview%2F" },
    { kind: "signup", href: "/fr/signup/" },
  ]);
  assert.deepEqual(authLinks(true, "fr", "/fr/interview/"), []);
});
