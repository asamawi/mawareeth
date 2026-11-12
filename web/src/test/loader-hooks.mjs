/**
 * ESM hooks for Node.js module loading:
 * - resolve: rewrites `@/*` path aliases and handles .ts/.tsx extension inference.
 * - load: transforms .tsx files (TypeScript + JSX) using sucrase.
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath, extname } from "node:path";

const require = createRequire(import.meta.url);
const { transform } = require("sucrase");

// Absolute path to web/src/
const srcDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

function tryExtensions(base) {
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  return null;
}

const stubsDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "stubs");

export async function resolve(specifier, context, nextResolve) {
  // Redirect Next.js modules to lightweight stubs so component tests work in Node.
  if (specifier === "next/navigation") {
    return { url: pathToFileURL(resolvePath(stubsDir, "next-navigation.mjs")).href, format: "module", shortCircuit: true };
  }
  if (specifier === "next/link") {
    return { url: pathToFileURL(resolvePath(stubsDir, "next-link.mjs")).href, format: "module", shortCircuit: true };
  }

  // Rewrite @/* aliases to absolute src/ paths.
  let resolved = specifier;
  if (specifier.startsWith("@/")) {
    resolved = pathToFileURL(resolvePath(srcDir, specifier.slice(2))).href;
  }

  // For relative/absolute file specifiers without an extension, try .ts/.tsx.
  if (resolved !== specifier || specifier.startsWith("file://") || specifier.startsWith("./") || specifier.startsWith("../")) {
    const url = resolved.startsWith("file://") ? resolved : null;
    // Try extension inference only when there's no extension in the specifier.
    if (!extname(specifier) || specifier.startsWith("@/")) {
      let basePath;
      if (resolved.startsWith("file://")) {
        basePath = fileURLToPath(resolved);
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const parentDir = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : srcDir;
        basePath = resolvePath(parentDir, specifier);
      }
      if (basePath && !existsSync(basePath)) {
        const withExt = tryExtensions(basePath);
        if (withExt) resolved = withExt;
      }
    }
  }

  // If we rewrote the specifier, resolve the new URL directly.
  if (resolved !== specifier) {
    try {
      const result = await nextResolve(resolved, context);
      if (result.url.endsWith(".tsx") && !result.url.includes("/node_modules/")) {
        return { ...result, format: "module" };
      }
      return result;
    } catch {
      // Fall through to default resolution.
    }
  }

  try {
    const result = await nextResolve(specifier, context);
    if (result.url.endsWith(".tsx") && !result.url.includes("/node_modules/")) {
      return { ...result, format: "module" };
    }
    return result;
  } catch (err) {
    // Last resort: try extension inference from the parent directory.
    if (err.code === "ERR_MODULE_NOT_FOUND" && context.parentURL && (specifier.startsWith("./") || specifier.startsWith("../"))) {
      const parentDir = dirname(fileURLToPath(context.parentURL));
      const withExt = tryExtensions(resolvePath(parentDir, specifier));
      if (withExt) {
        const result = await nextResolve(withExt, context);
        if (result.url.endsWith(".tsx") && !result.url.includes("/node_modules/")) {
          return { ...result, format: "module" };
        }
        return result;
      }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".tsx") && !url.includes("/node_modules/")) {
    const path = fileURLToPath(new URL(url));
    const source = readFileSync(path, "utf8");
    const result = transform(source, {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "automatic",
      filePath: path,
    });
    return { format: "module", source: result.code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
