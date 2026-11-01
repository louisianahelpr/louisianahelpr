/**
 * IdentityCheckMount is one of bootReach's EVERY_PAGE_ROOTS (B86, 11-01). App.tsx mounts it beside every
 * signed-in page. Unlisted, the two switch modules it imports (identityCheck.ts, payoutAfterHireSwitch.ts) were
 * classed as other screens' code and grouped into signed-in-pages, so a cold /home preloaded that 53 KB gz chunk
 * and its closure (~225 KB gz in all) in the dock's window to mount a sheet that almost never shows (lab build:
 * IdentityCheckMount's static closure 225 KB -> 11 KB gz).
 *
 * @mutate scripts/perf/bootReach.mjs |   "src/components/identity/IdentityCheckMount.tsx",\n | \n
 */
import { describe, expect, it } from "vitest";
import { EVERY_PAGE_ROOTS, signedInSplit } from "../../scripts/perf/bootReach.mjs";

describe("IdentityCheckMount's reads ride with the every-page chrome", () => {
  it("is listed as an every-page root", () => {
    expect(EVERY_PAGE_ROOTS.length).toBeGreaterThan(4);
    expect(EVERY_PAGE_ROOTS).toContain("src/components/identity/IdentityCheckMount.tsx");
  });

  it("so its switch read is not grouped with other screens' code", () => {
    const { homeOff } = signedInSplit(process.cwd());
    expect(homeOff.size).toBeGreaterThan(20);
    expect([...homeOff].some((f) => f.endsWith("src/lib/identityCheck.ts"))).toBe(false);
  });
});
