/**
 * Dark mode is WARM charcoal, not cool grey (HELPR-DESIGN-SPEC v2 §2, board 12,
 * owner-approved 2026-10-20; the lead's review of 749474db8 found 1440/375 dark
 * still cool hue-220 grey). Every dark token below must land on the spec hex
 * (each channel within 2/255, the rounding of an HSL triplet), and the dark
 * card surfaces must paint --surface, not a neutral or cool literal.
 *
 * @mutate src/index.css |   --parchment:    36 10% 10%; |   --parchment:    220 14% 9%;
 * @mutate src/index.css |   --ivory-sand:   40 9% 14%; |   --ivory-sand:   220 12% 13%;
 * @mutate src/index.css |   --bark:         66 19% 60%; |   --bark:         72 22% 52%;
 * @mutate src/index.css |   --accent-ink:   21 62% 70%; |   --accent-ink:   19 70% 66%;
 * @mutate src/index.css |   background-color: hsl(var(--ivory-sand)) !important; |   background-color: hsl(0 0% 11%) !important;
 * @mutate src/index.css |   --nav-pill-bg:       hsl(40 9% 14% / 0.72); |   --nav-pill-bg:       hsl(220 14% 12% / 0.72);
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const start = css.indexOf('[data-theme="dark"] {');
const block = css.slice(start, css.indexOf("\n}", start));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}
const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
function token(name: string): [number, number, number] {
  const m = block.match(new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?) (\\d+(?:\\.\\d+)?)% (\\d+(?:\\.\\d+)?)%;`));
  expect(m, `--${name} is an HSL triplet in the dark block`).toBeTruthy();
  return hslToRgb(Number(m![1]), Number(m![2]), Number(m![3]));
}
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 2);

describe("warm dark tokens (spec v2 §2, board 12)", () => {
  it("found the dark block", () => {
    expect(start).toBeGreaterThan(0);
    expect(block.length).toBeGreaterThan(2000);
  });

  const SPEC: Record<string, string> = {
    parchment: "#1C1A17", // --ground
    "ivory-sand": "#262420", // --surface
    sand: "#3A3731", // --subtle / --line
    popover: "#2F2C27", // --sheet
    border: "#4A4842", // --line-strong
    olivewood: "#F1EEE7", // --ink
    "stormy-sky": "#B8B2A6", // --muted
    bark: "#A9AD86", // --action
    "accent-ink": "#E2A585", // --money (text)
  };
  for (const [name, want] of Object.entries(SPEC)) {
    it(`--${name} is ${want}`, () => {
      const got = token(name);
      expect(near(got, hex(want)), `--${name} = rgb(${got}) vs ${want}`).toBe(true);
    });
  }

  it("dark cards and the dock paint the warm surface, never a cool or neutral literal", () => {
    const cards = css.match(/:root\[data-theme="dark"\] \[data-activity-card\] \{[^}]*\}/)?.[0] ?? "";
    expect(cards).toContain("background-color: hsl(var(--ivory-sand)) !important;");
    expect(block).toContain("--nav-pill-bg:       hsl(40 9% 14% / 0.72);");
    // No hue-220 canvas literal left in the dark token block.
    expect(blankComments(block)).not.toMatch(/\b220 1\d% \d+%/);
  });
});
