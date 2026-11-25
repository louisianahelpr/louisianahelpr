/**
 * Owner 2026-11-17 (signed-in tweaks, item 5): a job row's category tile is smaller (48 px) and wears ONE soft tint per
 * category from a small palette (src/lib/jobCategoryTint.mjs), a light background with a darker icon of the same hue,
 * consistent per category, passing contrast. This file holds: every category has a tint; the palette is small; each
 * tint's two tokens exist in BOTH themes in src/index.css; each pair's icon-on-background contrast is at least 4.5:1
 * (beyond the 3:1 WCAG 1.4.11 asks of a graphic); the real tile draws the tint.
 *
 * @mutate src/index.css |   --cat-tint-rose-bg:   350 65% 94%;  --cat-tint-rose-fg:   350 52% 34%; |   --cat-tint-rose-bg:   350 65% 94%;  --cat-tint-rose-fg:   350 52% 70%;
 * @mutate src/index.css |   --cat-tint-teal-bg:   178 28% 18%;  --cat-tint-teal-fg:   175 45% 68%; |   --cat-tint-teal-bg:   178 28% 18%;
 * @mutate src/lib/jobCategoryTint.mjs |   pet_care: "rose", |
 * @mutate src/components/dashboard/JobCardMedia.tsx | aria-hidden className="w-5 h-5" style={{ color: tint.color }} /> | aria-hidden className="w-5 h-5 text-primary" />
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { JOB_CATEGORY_TINT, JOB_CATEGORY_TINT_NAMES, jobCategoryTint, jobCategoryTintName } from "@/lib/jobCategoryTint.mjs";
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";
import { JobCardMedia } from "@/components/dashboard/JobCardMedia";
import { blankCssComments } from "./helpers/blankNonCode";
import { createElement } from "react";

const css = blankCssComments(readFileSync(resolve(__dirname, "../index.css"), "utf8"));

/** The body of the first top-level block whose selector is exactly `sel` and that declares the tint tokens. */
function tokens(sel: string): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  for (const m of css.matchAll(/(^|\n)([^{}\n][^{}]*)\{([^{}]*)\}/g)) {
    if (m[2].trim() !== sel || !m[3].includes("--cat-tint-")) continue;
    for (const d of m[3].matchAll(/--(cat-tint-[a-z]+-(?:bg|fg)):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) out.set(d[1], [Number(d[2]), Number(d[3]), Number(d[4])]);
  }
  return out;
}

function luminance([h, s, l]: [number, number, number]): number {
  const S = s / 100, L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => { const k = (n + h / 30) % 12; return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("job category tile tints (owner 11-17)", () => {
  it("every job category has a tint from the small palette", () => {
    const cats = Object.keys(JOB_CATEGORY_LABELS);
    expect(cats.length).toBeGreaterThan(10);
    for (const c of cats) expect(JOB_CATEGORY_TINT_NAMES).toContain(JOB_CATEGORY_TINT[c]);
    expect(JOB_CATEGORY_TINT_NAMES.length).toBeLessThanOrEqual(8);
    expect(jobCategoryTintName("not_a_category")).toBe("stone");
    // Consistent: one category always gets the same pair.
    expect(jobCategoryTint("pet_care")).toEqual(jobCategoryTint("pet_care"));
    expect(jobCategoryTint("pet_care")).not.toEqual(jobCategoryTint("cleaning"));
  });

  for (const [theme, sel] of [["light", ":root"], ["dark", '[data-theme="dark"]']] as const) {
    it(`${theme}: each tint's icon on its background is at least 4.5:1`, () => {
      const t = tokens(sel);
      expect(t.size).toBe(JOB_CATEGORY_TINT_NAMES.length * 2);
      for (const n of JOB_CATEGORY_TINT_NAMES) {
        const bg = t.get(`cat-tint-${n}-bg`), fg = t.get(`cat-tint-${n}-fg`);
        expect(bg, `${theme} ${n} bg`).toBeTruthy();
        expect(fg, `${theme} ${n} fg`).toBeTruthy();
        expect(contrast(bg!, fg!), `${theme} ${n}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("the real tile draws its category's background and icon colour, at 40 px (owner 11-25; 48 from 11-17)", () => {
    const { container } = render(createElement(JobCardMedia, { photo: null, category: "pet_care" }));
    const tile = container.querySelector<HTMLElement>("[data-testid=job-card-media]")!;
    expect(tile.getAttribute("style")).toContain(jobCategoryTint("pet_care").background);
    expect(tile.className.split(/\s+/)).toEqual(expect.arrayContaining(["w-10", "h-10"]));
    const icon = tile.querySelector<SVGElement>("svg")!;
    expect(icon.getAttribute("style")).toContain(jobCategoryTint("pet_care").color);
  });
});
