import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

/**
 * THE CLASS (Q254): motion that keeps running for a user who turned on the OS
 * "Reduce Motion" setting.
 *
 * The app answers that setting with ONE shared rule — src/index.css
 * "GLOBAL REDUCE-MOTION CATCH-ALL": under `prefers-reduced-motion: reduce`,
 * every element and both pseudo-elements get animation/transition durations of
 * ~0 and a single iteration, all `!important`. 94 `animate-spin` /
 * `animate-pulse` sites in 60 files carry no `motion-safe:` prefix (counted
 * 2026-09-25) and are stopped by that rule alone, so deleting or weakening it
 * turns every spinner and pulsing dot back on for those users with nothing
 * else going red. Until this file nothing pinned it.
 *
 * Two ways to lose it, both checked here:
 *   1. the catch-all itself goes (deleted, narrowed off `*`/pseudo-elements,
 *      or a duration raised);
 *   2. another `!important` motion declaration out-ranks it — `*` has zero
 *      specificity, so any `.x { animation: spin 1s infinite !important }`
 *      wins. The only `!important` motion values allowed anywhere in the
 *      stylesheet are ones that STOP motion (`none`, ~0 durations, 1 iteration).
 *
 * The runtime half — every route loaded with Reduce Motion emulated, in
 * Chromium and WebKit — is e2e/a11y-prod/reduced-motion.spec.ts.
 */

const css = blankComments(readFileSync("src/index.css", "utf8"));

/** Top-level `@media (prefers-reduced-motion: reduce) { ... }` bodies. */
function reduceBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  for (const m of src.matchAll(re)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

const toMs = (v: string) => (v.trim().endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000);

/** A rule inside a reduce block whose selector list is `*`, `::before`, `::after`. */
function catchAll(): { selectors: string[]; decls: Map<string, string> } | null {
  for (const block of reduceBlocks(css)) {
    for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(",").map((s) => s.trim().replace(/^\*(?=::)/, ""));
      if (!selectors.includes("*")) continue;
      const decls = new Map<string, string>();
      for (const d of m[2].split(";")) {
        const [k, ...v] = d.split(":");
        if (k && v.length) decls.set(k.trim(), v.join(":").trim());
      }
      return { selectors, decls };
    }
  }
  return null;
}

const importantMotion = [...css.matchAll(/(animation[\w-]*|transition[\w-]*)\s*:\s*([^;{}]*!important)/g)].map((m) => ({
  prop: m[1],
  value: m[2].replace(/\s*!important$/, "").trim(),
}));

describe("the reduce-motion catch-all (Q254)", () => {
  it("reads the real stylesheet", () => {
    expect(reduceBlocks(css).length).toBeGreaterThan(10);
    expect(importantMotion.length).toBeGreaterThan(3);
  });

  it("covers every element and both pseudo-elements with ~0 durations and one iteration", () => {
    // @mutate src/index.css |     animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n    scroll-behavior: auto !important; |     animation-duration: 2s !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n    scroll-behavior: auto !important;
    const rule = catchAll();
    expect(rule, "no `*` rule inside @media (prefers-reduced-motion: reduce) in src/index.css").not.toBeNull();
    expect(rule!.selectors).toEqual(expect.arrayContaining(["*", "::before", "::after"]));
    const d = rule!.decls;
    for (const prop of ["animation-duration", "transition-duration"]) {
      const v = d.get(prop) ?? "";
      expect(v, `${prop} must be !important`).toMatch(/!important$/);
      expect(toMs(v.replace(/!important$/, "")), `${prop} must be ~0`).toBeLessThanOrEqual(0.01);
    }
    expect(d.get("animation-iteration-count")).toBe("1 !important");
  });

  it("no other !important motion declaration can out-rank it", () => {
    const stops = (p: { prop: string; value: string }) =>
      p.value === "none" ||
      (/duration$/.test(p.prop) && toMs(p.value) <= 0.01) ||
      (p.prop === "animation-iteration-count" && p.value === "1") ||
      (p.prop === "scroll-behavior" && p.value === "auto");
    const offenders = importantMotion.filter((p) => !stops(p)).map((p) => `${p.prop}: ${p.value} !important`);
    expect(offenders).toEqual([]);
  });
});
