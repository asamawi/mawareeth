import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const css = readFileSync(join(import.meta.dirname, "globals.css"), "utf8");
const light = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)"));
const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline"));

function value(block: string, name: string): string {
  const match = new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(block);
  assert.ok(match, `--${name} missing`);
  return match[1].trim().toLowerCase();
}

const expected = {
  light: { background: "#ffffff", foreground: "#171717", muted: "#4b5563", surface: "#f2f7f5", border: "#d3dfd9", accent: "#0f766e", "accent-foreground": "#ffffff", graphic: "#76887f", "accent-soft": "#e3f1ee", "blocked-stripe": "#e8efec", scrim: "rgb(23 23 23 / 0.4)", "toast-focus": "#ffffff" },
  dark: { background: "#0a0a0a", foreground: "#ededed", muted: "#a8b0ad", surface: "#101a17", border: "#25352f", accent: "#5eead4", "accent-foreground": "#042f2e", graphic: "#5f7a6e", "accent-soft": "#0f2a26", "blocked-stripe": "#16231f", scrim: "rgb(0 0 0 / 0.6)", "toast-focus": "#0a0a0a" },
};

test("light and dark token values match DESIGN, existing ones unchanged", () => {
  for (const [name, hex] of Object.entries(expected.light)) assert.equal(value(light, name), hex, `light ${name}`);
  for (const [name, hex] of Object.entries(expected.dark)) assert.equal(value(dark, name), hex, `dark ${name}`);
});

test("type, radius and font tokens are declared; no web font is loaded", () => {
  for (const line of ["--text-node-name: 0.84rem", "--text-node-name--font-weight: 700", "--text-node-meta: 0.72rem", "--text-badge: 0.68rem", "--text-badge--line-height: 1.3", "--text-badge--font-weight: 600", "--radius-node: 10px", "--radius-sheet: 18px", "--radius-full: 9999px"]) {
    assert.ok(css.includes(line), line);
  }
  assert.ok(css.includes('"Segoe UI", Tahoma, "Noto Naskh Arabic", "Geeza Pro", system-ui, sans-serif'));
  assert.ok(!css.includes("@font-face"));
  assert.ok(!/--breakpoint/.test(css));
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("contrast of the new tokens", () => {
  for (const [mode, t] of [["light", expected.light], ["dark", expected.dark]] as const) {
    assert.ok(ratio(t.graphic, t.background) >= 3, `${mode} graphic/background`);
    assert.ok(ratio(t.graphic, t.surface) >= 3, `${mode} graphic/surface`);
    assert.ok(ratio(t.graphic, t["accent-soft"]) >= 3, `${mode} graphic/accent-soft`);
    assert.ok(ratio(t.accent, t["accent-soft"]) >= 4.5, `${mode} accent/accent-soft`);
    assert.ok(ratio(t["toast-focus"], t.foreground) >= 3, `${mode} toast-focus/toast fill`);
  }
});

test("the pinned contrast ratios hold in light and dark", () => {
  const pins = { light: { accentSoft: 4.71, toast: 17.93 }, dark: { accentSoft: 10.29, toast: 16.91 } };
  for (const [mode, t] of [["light", expected.light], ["dark", expected.dark]] as const) {
    assert.equal(ratio(t.accent, t["accent-soft"]).toFixed(2), pins[mode].accentSoft.toFixed(2), `${mode} accent/accent-soft`);
    assert.equal(ratio(t["toast-focus"], t.foreground).toFixed(2), pins[mode].toast.toFixed(2), `${mode} toast-focus/foreground`);
    for (const text of [t.foreground, t.muted]) {
      assert.ok(ratio(text, t.background) >= 4.5, `${mode} text/background`);
      assert.ok(ratio(text, t.surface) >= 4.5, `${mode} text/surface`);
    }
    assert.ok(ratio(t.graphic, t.surface) >= 3 && ratio(t.graphic, t.background) >= 3, `${mode} graphic`);
  }
});

test("the toast utilities and the obstruction padding are defined", () => {
  const theme = css.slice(css.indexOf("@theme inline"));
  assert.ok(theme.includes("--color-foreground: var(--foreground)"));
  assert.ok(theme.includes("--color-background: var(--background)"));
  assert.match(css, /scroll-padding-block-end:\s*var\(--interview-obstruction, 0px\)/);
});
