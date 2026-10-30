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
 * rendered un-dimmed across the Delete account dialog (Q300 owner-path run,
 * ~/.lh-shots/q281/owner-path/4-after-delete.png).
 *
 * Inventory from source: every `fixed` element whose z-index is above 50 and
 * that is not itself a full-screen layer (`inset-0`). Each must carry a class
 * that src/index.css drops below 50 while a Radix modal holds the scroll lock
 * (`body[data-scroll-locked] .<class> { z-index: <50 }`), or be listed in
 * KNOWN_ABOVE_MODAL — exact, two-way.
 *
 * DC-10 (Declutter selling audit 2026-10-30): the scan read only className strings, so chrome whose fixed position and
 * z-index live in src/index.css slipped past it. `.compact-title-bar` (largeTitles.ts, z-index 60) stayed bright over
 * the Manage listing sheet's scrim on a scrolled item page (~/.lh-shots/declutter-audit-1030/selling/dc-mg-sheet-1-375wk.png).
 * The CSS rules are inventoried too: every rule that sets `position: fixed` and a z-index above 50 and is not a
 * full-screen layer (`inset: 0`) must name a class that is lowered the same way.
 */

// Empty since Q313 (2026-09-25): OfflineBanner was the one entry, and it now
// dims under the modal like StrikeBanner (decision and measurement in the
// src/index.css comment beside `.offline-banner`). A new entry needs a reason
// written here.
// @two-way src/test/persistentChromeUnderModalBackdrop.test.ts:const staleKnown =
const KNOWN_ABOVE_MODAL: string[] = [];

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

// CSS-declared fixed chrome (DC-10): rules in src/index.css that set position: fixed with a z-index above 50.
type CssHit = { selector: string; z: number; classes: string[] };
const cssHits: CssHit[] = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const body = m[2];
  if (!/position:\s*fixed/.test(body) || /(^|[;\s])inset:\s*0\b/.test(body)) continue;
  const z = /z-index:\s*(\d+)/.exec(body);
  if (!z || Number(z[1]) <= 50) continue;
  const selector = m[1].trim().replace(/\s+/g, " ");
  cssHits.push({ selector, z: Number(z[1]), classes: [...selector.matchAll(/\.([\w-]+)/g)].map((c) => c[1]) });
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

  it("every CSS-declared fixed rule above z-50 is lowered under a scroll-locked body (DC-10)", () => {
    // @mutate src/index.css | body[data-scroll-locked] .compact-title-bar { | body[data-scroll-lockedx] .compact-title-bar {
    expect(cssHits.length).toBeGreaterThan(0);
    const offenders = cssHits
      .filter((h) => !h.classes.some((c) => (lowered.get(c) ?? 99) < 50))
      .map((h) => `src/index.css: ${h.selector} (z-index ${h.z})`);
    expect(offenders).toEqual([]);
  });

  it("the compact title bar is in the CSS inventory and lowered (DC-10)", () => {
    const bar = cssHits.filter((h) => h.classes.includes("compact-title-bar"));
    expect(bar.length).toBe(1);
    expect(lowered.get("compact-title-bar")).toBeLessThan(50);
  });

  it("StrikeBanner's two variants are both lowered", () => {
    const strike = hits.filter((h) => h.file === "src/components/StrikeBanner.tsx");
    expect(strike.length).toBe(2);
    for (const h of strike) expect(isLowered(h)).toBe(true);
  });

  it("OfflineBanner is lowered (Q313)", () => {
    // @mutate src/index.css | body[data-scroll-locked] .offline-banner { | body[data-scroll-lockedx] .offline-banner {
    const offline = hits.filter((h) => h.file === "src/components/OfflineBanner.tsx");
    expect(offline.length).toBe(1);
    expect(isLowered(offline[0])).toBe(true);
  });

  it("KNOWN_ABOVE_MODAL is exact (every entry still offends)", () => {
    const stillAbove = new Set(hits.filter((h) => !isLowered(h)).map((h) => h.file));
    const staleKnown = KNOWN_ABOVE_MODAL.filter((f) => !stillAbove.has(f)).map(
      (f) => `stale baseline entry ${f} — remove it (lower the baseline)`,
    );
    expect(staleKnown).toEqual([]);
  });
});
