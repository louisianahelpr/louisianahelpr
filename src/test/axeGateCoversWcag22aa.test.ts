/*
 * GUARD (Q181, docs/OPEN.md; overlaps Q71): the prod route sweep's axe scan
 * must run WCAG 2.2 AA + best-practice, not just 2.0/2.1 — and every axe
 * caller in the repo must read the tag set from the ONE shared constant
 * (axeTags.ts) rather than a private hardcoded list that can silently drift
 * behind it, which is exactly how the previous four-tag list (wcag2a/2aa/
 * 21a/21aa, unchanged since it was written) never grew the 2.2 additions.
 *
 * Read as TEXT, not imported: this file lives in src/test, and importing an
 * e2e/ module from src/test requires listing it in tsconfig.app.json's
 * "include" (see src/test/e2eImportsInAppTsconfig.test.ts) purely for
 * typecheck's sake — unnecessary for a guard that only needs to know what
 * string literals a file contains.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

describe("the axe tag set covers WCAG 2.2 AA + best-practice, from one shared constant", () => {
  it("axeTags.ts declares wcag22aa and best-practice", () => {
    const src = read("e2e/happy-path/axeTags.ts");
    expect(src).toMatch(/AXE_TAGS[^=]*=\s*\[[^\]]*"wcag22aa"[^\]]*\]/);
    expect(src).toMatch(/AXE_TAGS[^=]*=\s*\[[^\]]*"best-practice"[^\]]*\]/);
    // Also still every earlier tag — this is additive, not a replacement.
    for (const tag of ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]) {
      expect(src, `AXE_TAGS dropped "${tag}"`).toMatch(new RegExp(`"${tag}"`));
    }
  });

  it("the prod route sweep (sweepCore.ts) scans with AXE_TAGS, not a private tag list", () => {
    const src = read("e2e/happy-path/sweepCore.ts");
    expect(src).toMatch(/import\s*\{\s*AXE_TAGS\s*\}\s*from\s*"\.\/axeTags"/);
    expect(src).toMatch(/\.withTags\(AXE_TAGS\)/);
    // The old hardcoded call must be GONE, not just shadowed by a new one —
    // a leftover second axe scan at the narrower tag set would still pass
    // the two assertions above while never actually widening what runs.
    expect(src).not.toMatch(/\.withTags\(\s*\[\s*"wcag2a"/);
  });

  it("the journey spot-check helper (fixtures.ts checkA11y) defaults to AXE_TAGS too", () => {
    const src = read("e2e/happy-path/fixtures.ts");
    expect(src).toMatch(/import\s*\{\s*AXE_TAGS\s*\}\s*from\s*"\.\/axeTags"/);
    expect(src).toMatch(/options\.tags\s*\?\?\s*AXE_TAGS/);
  });
});

// @mutate e2e/happy-path/axeTags.ts | "wcag22aa" |
