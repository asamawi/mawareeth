/**
 * Node.js module hook that enables importing .tsx files in `node --test` suites.
 *
 * Usage: node --import ./src/test/loader.mjs --test "src/**\/*.test.{ts,tsx}"
 *
 * This file (the --import file) registers the hook module, which runs in a
 * separate context. The hook module (loader-hooks.mjs) handles resolve and load.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL("./src/test/loader-hooks.mjs").href, import.meta.url);
