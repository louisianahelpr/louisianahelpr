/**
 * Q1013: the availability popover's time suffix clears AA on the idle segment.
 *
 * The overlay sweep reported `#83837c` on `#ffffff` (3.82:1) in the
 * availability time popover and nobody could say what painted it; it is no
 * token. Measured on prod 2026-10-07 (/profile?tab=availability, 375): the
 * idle "End" segment's ink is `--olivewood` at 0.85 (.segmented-option) and
 * TimeRangeField's TimeSuffix multiplied that by `opacity-70`, i.e. olivewood
 * at 0.595 over the white popover = #82837b, 3.82:1 for 11px text.
 *
 * This computes the ratio from the source: the idle segment alpha in
 * src/index.css, the suffix's opacity class in TimeRangeField.tsx, and
 * --olivewood / --popover in both themes. (The selected segment is parchment
 * on the olive gloss, where a lower opacity only lightens a light colour.)
 *
 * @mutate src/components/TimeRangeField.tsx | tabular-nums opacity-80"> | tabular-nums opacity-70">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const css = readFileSync(join(ROOT, "src", "index.css"), "utf8");
const field = readFileSync(join(ROOT, "src", "components", "TimeRangeField.tsx"), "utf8");

function token(name: string, theme: "light" | "dark"): string {
  const block = theme === "light" ? css.slice(0, css.indexOf('[data-theme="dark"] {')) : css.slice(css.indexOf('[data-theme="dark"] {'));
  const m = new RegExp(`--${name}:\\s*([0-9.]+\\s+[0-9.]+%\\s+[0-9.]+%)`).exec(block);
  if (m) return m[1];
  const v = new RegExp(`--${name}:\\s*var\\(--([\\w-]+)\\)`).exec(block);
  if (v) return token(v[1], theme);
  throw new Error(`--${name} (${theme}) not found`);
}
function rgb(hsl: string): number[] {
  const [h, s, l] = hsl.split(/\s+/).map((v) => parseFloat(v));
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function ratio(a: number[], b: number[]): number {
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("availability time suffix contrast (Q1013)", () => {
  const idle = /\.segmented-option\s*\{\s*color:\s*hsl\(var\(--olivewood\)\s*\/\s*([0-9.]+)\)/.exec(css);
  const suffix = /const TimeSuffix[\s\S]{0,200}?opacity-(\d+)/.exec(field);

  it("reads the idle segment alpha and the suffix opacity from source", () => {
    expect(idle, ".segmented-option colour not found").not.toBeNull();
    expect(suffix, "TimeSuffix opacity class not found").not.toBeNull();
  });

  for (const theme of ["light", "dark"] as const) {
    it(`the idle segment's 11px time clears 4.5:1 on the ${theme} popover`, () => {
      const a = Number(idle![1]) * (Number(suffix![1]) / 100);
      const bg = rgb(token("popover", theme));
      const ink = rgb(token("olivewood", theme)).map((c, i) => c * a + bg[i] * (1 - a));
      expect(ratio(ink, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
