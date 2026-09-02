/**
 * /analytics text contrast, MEASURED — not eyeballed, and not asserted from a
 * hardcoded copy of the token.
 *
 * axe reported `color-contrast` at SERIOUS on 14 nodes of this one route on
 * 2026-09-01: every 11px quiet line sat at `hsl(var(--olivewood) / 0.55|0.62|
 * 0.65)` on a panel whose surface (`--ivory-sand`) is pure white, measuring
 * 3.36 / 4.10 / 4.46 against a 4.5:1 WCAG AA floor for normal-size text.
 *
 * This test reads the REAL token out of `src/index.css` and the REAL alphas out
 * of the components, then computes the composite. It therefore fails if either
 * side drifts — a darker token, a re-lightened alpha, or a new panel copying a
 * failing shade from its neighbour.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");

/** WCAG AA for text below 18.66px bold / 24px regular. Every line here is 11px. */
const AA_NORMAL = 4.5;

/** The light-mode `--olivewood`, read from the stylesheet rather than copied. */
function olivewoodRgb(): [number, number, number] {
  // The FIRST declaration is `:root` (light); the dark override comes later.
  const m = css.match(/--olivewood:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) throw new Error("--olivewood not found in src/index.css");
  return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
      : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast of `fg` at `alpha` composited over `bg`. */
function ratioOver(fg: [number, number, number], alpha: number, bg: [number, number, number]): number {
  const over = fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as [number, number, number];
  const l1 = luminance(over);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The panels sit on `--ivory-sand`, which the stylesheet defines as pure white. */
const WHITE: [number, number, number] = [255, 255, 255];

const PANEL_FILES = [
  "src/components/analytics/AnalyticsPanel.tsx",
  "src/components/analytics/NotEnoughYet.tsx",
  "src/components/analytics/CategoryPanel.tsx",
  "src/components/analytics/ApplicationsPanel.tsx",
  "src/components/analytics/DemandPanel.tsx",
];

/** Every `color: hsl(var(--olivewood) / N)` on an element that also carries
 *  `text-ds-11`, paired with its alpha. */
function quietTextAlphas(file: string): number[] {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  const out: number[] = [];
  // Match a text-ds-11 element and the olivewood alpha within the same tag.
  const re = /text-ds-11[\s\S]{0,400}?color:\s*"hsl\(var\(--olivewood\)\s*\/\s*([\d.]+)\)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(Number(m[1]));
  return out;
}

describe("/analytics quiet 11px text meets WCAG AA on the white panel", () => {
  const fg = olivewoodRgb();

  it("--ivory-sand really is white, so white is the worst case to measure against", () => {
    expect(css).toMatch(/--ivory-sand:\s*0 0% 100%/);
  });

  it("reproduces the failures axe reported, proving the measurement is right", () => {
    // axe: 3.35 / 4.10 / 4.46 for 0.55 / 0.62 / 0.65 (#8c8d85, #7d7e76, #77786f
    // on #ffffff). Within 0.02 confirms this calculator agrees with axe-core.
    expect(ratioOver(fg, 0.55, WHITE)).toBeCloseTo(3.36, 1);
    expect(ratioOver(fg, 0.62, WHITE)).toBeCloseTo(4.1, 1);
    expect(ratioOver(fg, 0.65, WHITE)).toBeCloseTo(4.46, 1);
    // …and every one of them is under the bar.
    for (const a of [0.55, 0.62, 0.65]) expect(ratioOver(fg, a, WHITE)).toBeLessThan(AA_NORMAL);
  });

  it("every quiet 11px line in every analytics panel now passes", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const file of PANEL_FILES) {
      for (const alpha of quietTextAlphas(file)) {
        checked++;
        const r = ratioOver(fg, alpha, WHITE);
        if (r < AA_NORMAL) failures.push(`${file} @ ${alpha} = ${r.toFixed(2)}:1`);
      }
    }
    // Guard the guard: if the regex stops matching, this test would pass by
    // measuring nothing.
    expect(checked).toBeGreaterThanOrEqual(8);
    expect(failures).toEqual([]);
  });

  it("0.7 is the value chosen, and it clears the bar with margin", () => {
    expect(ratioOver(fg, 0.7, WHITE)).toBeGreaterThan(5);
  });
});
