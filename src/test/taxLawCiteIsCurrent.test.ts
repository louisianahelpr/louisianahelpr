/**
 * Q2722: the member-facing tax lines cite the CURRENT Louisiana list of taxed
 * services. Act 11 (2024 3rd Extraordinary Session) moved the list from
 * La. R.S. 47:301(14) to 47:301.3, and cleaning carpets, rugs and furniture
 * (47:301.3(5)) is taxed; the old lines said cleaning was not.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | (La. R.S. 47:301.3), such as repairing a movable item | (LA R.S. 47:301(14)), such as repairing a movable item
 * @mutate src/pages/info/legal/CommunitySection.tsx | (house cleaning, yard work, | (cleaning, yard work,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FILES = ["src/pages/info/legal/TermsSection.tsx", "src/pages/info/legal/CommunitySection.tsx"];
const read = (f: string) => blankComments(readFileSync(resolve(process.cwd(), f), "utf8"));

describe("the legal tax lines cite La. R.S. 47:301.3 (Q2722)", () => {
  it("no member-facing legal page cites the old 47:301(14) list", () => {
    for (const f of FILES) expect(read(f), f).not.toMatch(/47:301\(14\)/);
  });

  it("both pages cite 47:301.3 and name cleaning carpets, rugs or furniture as taxed", () => {
    let cites = 0;
    for (const f of FILES) {
      const src = read(f);
      expect(src, f).toMatch(/La\. R\.S\. 47:301\.3/);
      expect(src, f).toMatch(/cleaning carpets, rugs, furniture or clothes/);
      cites++;
    }
    expect(cites).toBeGreaterThan(1);
  });

  it("no page says cleaning in general is untaxed (only house cleaning is)", () => {
    for (const f of FILES) expect(read(f), f).not.toMatch(/\(cleaning, yard work/);
  });
});
