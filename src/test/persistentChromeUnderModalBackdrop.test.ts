import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

/**
 * THE CLASS (Q303): persistent fixed chrome stacked ABOVE the modal backdrop.
 *
 * Dialog and sheet overlays are `z-50` (src/components/ui/dialog.tsx, sheet.tsx).
 * StrikeBanner is `z-[59]` so it clears the fixed page chrome, which also put
 * it over every backdrop: on /account-banned the red "Account suspended" strip
 * rendered un-dimmed across the Delete Account dialog (Q300 owner-path run,
 * ~/.lh-shots/q281/owner-path/4-after-delete.png).
 *
 * Inventory from source: every `fixed` element whose z-index is above 50 and
 * that is not itself a full-screen layer (`inset-0`). Each must carry a class
 * that src/index.css drops below 50 while a Radix modal holds the scroll lock
 * (`body[data-scroll-locked] .<class> { z-index: <50 }`), or be listed in
 * KNOWN_ABOVE_MODAL — exact, two-way.
 */

// Not fixed by Q303 (only StrikeBanner was named). Whether the offline notice
// should stay above a modal is an open question, not a decision.
// @two-way src/test/persistentChromeUnderModalBackdrop.test.ts:const staleKnown =
const KNOWN_ABOVE_MODAL = ["src/components/OfflineBanner.tsx"];

const css = blankComments(readFileSync("src/index.css", "utf8"));
const lowered = new Map<string, number>();
for (const m of css.matchAll(/body\[data-scroll-locked\]\s+\.([\w-]+)\s*\{([^}]*)\}/g)) {
  const z = /z-index:\s*(\d+)/.exec(m[2]);
  if (z) lowered.set(m[1], Number(z[1]));
}

const files = walkSource(["src"], [".tsx"]).filter((f) => !f.includes("/test/"));
type Hit = { file: string; classes: string[] };
const hits: Hit[] = [];
for (const file of files) {
  const src = readSource(file);
  if (src === null) continue;
  const code = blankComments(src);
  for (const m of code.matchAll(/className="([^"]*)"/g)) {
    const classes = m[1].split(/\s+/);
    if (!classes.includes("fixed") || classes.includes("inset-0")) continue;
    const z = classes.map((c) => /^z-(?:\[(\d+)\]|(\d+))$/.exec(c)).find(Boolean);
    const zn = z ? Number(z[1] ?? z[2]) : 0;
    if (zn > 50) hits.push({ file, classes });
  }
}

const isLowered = (h: Hit) => h.classes.some((c) => (lowered.get(c) ?? 99) < 50);

describe("persistent fixed chrome drops under the modal backdrop (Q303)", () => {
  it("scans the real component tree", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(hits.length).toBeGreaterThan(1);
  });

  it("every fixed non-overlay element above z-50 is lowered under a scroll-locked body", () => {
    // @mutate src/index.css | body[data-scroll-locked] .strike-banner { | body[data-scroll-lockedx] .strike-banner {
    // @mutate src/components/StrikeBanner.tsx | className="strike-banner fixed left-0 right-0 z-[59] w-full bg-destructive | className="fixed left-0 right-0 z-[59] w-full bg-destructive
    const offenders = hits
      .filter((h) => !KNOWN_ABOVE_MODAL.includes(h.file))
      .filter((h) => !isLowered(h))
      .map((h) => `${h.file}: ${h.classes.join(" ")}`);
    expect(offenders).toEqual([]);
  });

  it("StrikeBanner's two variants are both lowered", () => {
    const strike = hits.filter((h) => h.file === "src/components/StrikeBanner.tsx");
    expect(strike.length).toBe(2);
    for (const h of strike) expect(isLowered(h)).toBe(true);
  });

  it("KNOWN_ABOVE_MODAL is exact (every entry still offends)", () => {
    const stillAbove = new Set(hits.filter((h) => !isLowered(h)).map((h) => h.file));
    const staleKnown = KNOWN_ABOVE_MODAL.filter((f) => !stillAbove.has(f)).map(
      (f) => `stale baseline entry ${f} — remove it (lower the baseline)`,
    );
    expect(staleKnown).toEqual([]);
  });
});
