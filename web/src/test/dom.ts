/**
 * DOM setup helper for component tests using happy-dom.
 *
 * Usage:
 *   import { installDom, teardownDom } from "@/test/dom.ts";
 *   let dom = installDom("http://localhost/app/en/results/");
 *   // ...tests...
 *   await teardownDom(dom);
 */
import { Window } from "happy-dom";
export type { Window as TestDom };

const GLOBALS = [
  "window", "document", "location", "history", "sessionStorage", "localStorage",
  "HTMLElement", "HTMLDialogElement", "HTMLButtonElement", "HTMLInputElement", "HTMLDivElement",
  "Event", "MouseEvent", "CustomEvent", "MutationObserver", "IntersectionObserver",
  "requestAnimationFrame", "cancelAnimationFrame",
  "clearTimeout", "setTimeout", "clearInterval", "setInterval",
  "navigator",
] as const;

/** Install happy-dom globals and return the Window for cleanup. */
export function installDom(url = "http://localhost/"): Window {
  const dom = new Window({ url });
  const g = globalThis as Record<string, unknown>;
  const d = dom as unknown as Record<string, unknown>;
  for (const key of GLOBALS) {
    if (!(key in d)) continue;
    const val = typeof d[key] === "function" ? (d[key] as (...a: unknown[]) => unknown).bind(dom) : d[key];
    try {
      g[key] = val;
    } catch {
      Object.defineProperty(globalThis, key, { value: val, configurable: true, writable: true });
    }
  }
  g.window = dom;
  g.document = dom.document;
  g.location = dom.location;
  g.history = dom.history;
  // Let React know we are in a test environment.
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

/** Close the Window and strip DOM globals. */
export async function teardownDom(dom: Window): Promise<void> {
  await dom.happyDOM.close();
  const g = globalThis as Record<string, unknown>;
  for (const key of [...GLOBALS, "window", "document", "location", "history", "IS_REACT_ACT_ENVIRONMENT"]) {
    try {
      delete g[key];
    } catch {
      Object.defineProperty(globalThis, key, { value: undefined, configurable: true, writable: true });
    }
  }
}
