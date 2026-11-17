/**
 * The guest "Jobs | Declutter" switch (GuestSectionSwitch, M13 iOS design audit 11-16) is drawn with the shared
 * FilterChips row, whose `.chip-row > button` chips are 36px. On /browse that put two sub-44px controls on a guest's
 * first screen, and e2e-journeys feed-chrome failed "guest sub-44px controls" at 320, 375 and 1440 (run 44101977703,
 * 2026-11-17: "Jobs @36px", "Declutter @36px"). The switch's chips keep the 44px floor (2.75rem) by a rule scoped to
 * the switch, so the Inbox's filter chips are unchanged. Source-scan of index.css: the scoped rule exists, it outranks
 * `.chip-row > button` (an attribute selector on top of the same class + element), and its floor is at least 44px.
 *
 * @mutate src/index.css | [data-guest-section-switch] .chip-row > button {\n  min-height: 2.75rem; | [data-guest-section-switch] .chip-row > button {\n  min-height: 2.25rem;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankCssComments } from "./helpers/blankNonCode";

const css = blankCssComments(readFileSync(join(__dirname, "..", "index.css"), "utf8"));
const src = readFileSync(join(__dirname, "..", "components", "sections", "GuestSectionSwitch.tsx"), "utf8");

function minHeightPx(block: string): number {
  const m = /min-height:\s*([\d.]+)(rem|px)/.exec(block);
  if (!m) throw new Error(`no min-height in: ${block}`);
  return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
}

describe("the guest Jobs | Declutter switch clears the 44px tap floor", () => {
  it("a rule scoped to the switch gives its chips at least 44px", () => {
    const rules = [...css.matchAll(/\[data-guest-section-switch\] \.chip-row > button \{([^}]*)\}/g)];
    // Inventory floor: the scoped rule is found and read.
    expect(rules.length).toBeGreaterThan(0);
    expect(minHeightPx(rules[rules.length - 1][1])).toBeGreaterThanOrEqual(44);
  });
  it("the shared chip row is still the 36px Inbox chip, so the scoped rule is what lifts the switch", () => {
    const shared = /\.category-chip-row > button,\s*\.chip-row > button \{([^}]*)\}/.exec(css);
    expect(shared, "shared chip rule").toBeTruthy();
    expect(minHeightPx(shared![1])).toBeLessThan(44);
  });
  it("the switch still renders inside the element the rule names", () => {
    expect(src).toContain('data-guest-section-switch=""');
    expect(src).toContain("<FilterChips");
  });
});
