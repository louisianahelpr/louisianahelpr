import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// OPS-4 (2026-11-23): the prod core-loop canary was red because searchFeed only looked for the magnifier inside
// [data-feed-strip]; on a phone it is the title-bar button, outside the strip.
const src = readFileSync("e2e/feedSearch.ts", "utf8");
const line = src.split("\n").find((l) => /const trigger = /.test(l)) ?? "";

describe("e2e searchFeed finds the phone Jobs magnifier", () => {
  // @mutate e2e/feedSearch.ts | page.locator('[data-search-trigger][aria-label="Search jobs"]') | page.locator("[data-feed-strip] [data-search-trigger]")
  it("the trigger is not scoped to the desktop feed strip", () => {
    expect(src.length).toBeGreaterThan(200); // floor
    expect(line).toMatch(/\[data-search-trigger\]\[aria-label="Search jobs"\]/);
    expect(line).not.toMatch(/data-feed-strip/);
  });
  // @mutate e2e/feedSearch.ts | .filter({ visible: true }).first(); | .first();
  it("only a visible trigger is pressed", () => {
    expect(line).toMatch(/filter\(\{ visible: true \}\)/);
  });
});
