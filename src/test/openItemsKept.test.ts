/**
 * A landing must never lose or REPLACE an item that is on main (2026-10-04: a
 * batch merge overwrote main's Q1208/Q1209/Q1210 with new items that reused the
 * numbers). scripts/check-open-items-kept.mjs, run by scripts/land.sh.
 */
// @mutate scripts/check-open-items-kept.mjs |   return both / (A.size + B.size - both) >= 0.12; |   return true;
// @mutate scripts/check-open-items-kept.mjs |     if (!now) out.push( |     if (false) out.push(
// @mutate scripts/land.sh |   node scripts/check-open-items-kept.mjs --base origin/main |   true
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { lostItems } from "../../scripts/check-open-items-kept.mjs";

const base = [
  "- [ ] **Q1210 MEDIUM A job paid partly by a gift card and partly by card may never pay out (found by the lh-money-escrow review of Q454).**",
  "- [~] **Q1142 MEDIUM Tests that walk src/ race vacuityGate's temporary fixture (ENOENT).**",
  "- [ ] **Q700 LOW The dock pill blinks on slow devices.**",
].join("\n");

describe("no landing loses or overwrites an item on main", () => {
  it("flags an item whose number now names a different open item (the 2026-10-04 loss)", () => {
    const tree = base.replace(/Q1210 MEDIUM A job paid partly[^\n]*/, "Q1210 MEDIUM socialAuthOutcomes.test.ts survives its src/lib/ rename.**");
    expect(lostItems(base, tree)).toEqual([expect.stringMatching(/^Q1210 now names a DIFFERENT item/)]);
  });

  it("flags an item that is gone", () => {
    const tree = base.split("\n").filter((l) => !l.includes("Q700")).join("\n");
    expect(lostItems(base, tree)).toEqual([expect.stringMatching(/^Q700 is on the base and gone/)]);
  });

  it("accepts a tick, a status note and a done rewrite", () => {
    const tree = base
      .replace("- [ ] **Q700 LOW The dock pill blinks on slow devices.**", "- [~] **Q700 LOW The dock pill blinks on slow devices.** STATUS 2026-10-04: fixed")
      .replace(/- \[~\] \*\*Q1142[^\n]*/, "- [x] **Q1142 DONE 2026-10-04: tests list src/ from the git index.**");
    expect(lostItems(base, tree)).toEqual([]);
  });

  it("land.sh runs it after renumbering", () => {
    const land = readFileSync(join(__dirname, "..", "..", "scripts", "land.sh"), "utf8");
    expect(land.indexOf("node scripts/check-open-items-kept.mjs --base origin/main")).toBeGreaterThan(land.indexOf("node scripts/open-renumber.mjs"));
  });
});
