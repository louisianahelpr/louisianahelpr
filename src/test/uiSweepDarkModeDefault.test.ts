/*
 * GUARD (Q256, 2026-09-23): the UI sweep's default variant set was
 * phone-light only — dark mode was opt-in via an explicit `variants:`
 * dispatch input or `SWEEP_VARIANTS=all/…dark…`. Audit finding #11
 * (docs/archive/FULL-SURFACE-2026-08-31.md) named the cost: the single
 * worst a11y defect the last audit found — 35 screens — lived only in dark
 * mode, and nothing scheduled without that input ever rendered it.
 *
 * Read as TEXT, not imported: sweepCore.ts pulls in @playwright/test and
 * @axe-core/playwright, and this file lives in src/test (see
 * src/test/axeGateCoversWcag22aa.test.ts for the same reasoning) — a guard
 * that only needs to know what a file's default resolves to does not need
 * the whole Playwright-composite project graph for it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

describe("UI sweep defaults to phone-light AND phone-dark", () => {
  it("sweepCore.ts's VARIANTS resolves to [phone-light, phone-dark] when SWEEP_VARIANTS is unset", () => {
    const src = read("e2e/happy-path/sweepCore.ts");
    // ALL_VARIANTS[0] is phone-light, ALL_VARIANTS[1] is phone-dark — pinned
    // by the assertion right below, so a reorder of ALL_VARIANTS is caught
    // here too rather than silently changing what "unset" means.
    expect(src).toMatch(/if \(!want\) return \[ALL_VARIANTS\[0\], ALL_VARIANTS\[1\]\];/);
    const variantsBlock = /export const ALL_VARIANTS: Variant\[\] = \[([\s\S]*?)\];/.exec(src);
    expect(variantsBlock, "could not find ALL_VARIANTS declaration").not.toBeNull();
    const entries = [...variantsBlock![1].matchAll(/tag:\s*"([a-z-]+)"/g)].map((m) => m[1]);
    expect(entries[0], "ALL_VARIANTS[0] must be phone-light").toBe("phone-light");
    expect(entries[1], "ALL_VARIANTS[1] must be phone-dark").toBe("phone-dark");
  });

  it("ui-sweep.yml's own default (used when no dispatch input is given) includes phone-dark", () => {
    const src = read(".github/workflows/ui-sweep.yml");
    expect(src).toMatch(/VARIANTS:\s*\$\{\{\s*github\.event\.inputs\.variants\s*\|\|\s*'phone-light,phone-dark'\s*\}\}/);
  });
});

// @mutate e2e/happy-path/sweepCore.ts | if (!want) return [ALL_VARIANTS[0], ALL_VARIANTS[1]]; | if (!want) return [ALL_VARIANTS[0]];
