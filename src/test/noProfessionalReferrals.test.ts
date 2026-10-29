/**
 * Audit 2026-10-28 P5-11: the app told people to ask a professional the owner
 * does not have: Admin's tax card said "Confirm the exact rate with your CPA.",
 * the earnings statement PDF "provide this statement to your CPA", and the
 * Terms and Community Rules "Consult a CPA for advice specific to your
 * situation." The owner's rule: follow the published law and cite its source,
 * never "ask your CPA". Each now names the IRS page it follows.
 *
 * Every tracked non-test source file under src/ (comments blanked) is scanned
 * for "CPA", "accountant" and "attorney". "attorney" stays only where it is
 * part of a legal definition, never a referral; that list is exact both ways.
 *
 * @mutate src/components/admin/dashboard/TaxReserveCard.tsx |         A set-aside, not the bill. | Confirm the exact rate with your CPA.
 * @mutate src/components/EarningsExport.tsx | Keep this statement for your taxes. | For tax-prep — provide this statement to your CPA.
 * @mutate src/pages/info/legal/LegalChrome.tsx |     Tax laws change. The IRS explains | Consult an accountant. The IRS explains
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "..", "..");

/** Where "attorney" is a legal definition, not advice to go and see one. */
const ATTORNEY_IN_A_DEFINITION: Record<string, string> = {
  "src/lib/rentals/leaseTemplate.ts": "the lease's own clause 26, Attorney's fees",
  "src/pages/info/legal/TermsSection.tsx": "the indemnity clause, reasonable attorneys' fees",
  "src/lib/rentals/listingCopy.ts": "how a Louisiana home sale closes: a title company or attorney",
  "src/components/rentals/HomesBrowse.tsx": "the same closing fact on Homes Browse",
  "src/components/rentals/listings/SaleListingEditor.tsx": "the same closing fact in the sale editor",
};

const files = trackedFiles("src").filter((f) => /\.(tsx?|mjs)$/.test(f) && !/\.(test|spec)\.|^src\/test\//.test(f));
const code = new Map(files.map((f) => [f, blankComments(readFileSync(join(ROOT, f), "utf8"))]));

describe("no referral to a CPA, accountant or attorney (P5-11)", () => {
  it("scans the whole source tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("no 'CPA' or 'accountant' anywhere", () => {
    const hits = files.filter((f) => /\bCPAs?\b|accountant/i.test(code.get(f)!));
    expect(hits).toEqual([]);
  });

  it("'attorney' only inside a legal definition, and that list is exact", () => {
    const hits = files.filter((f) => /attorney/i.test(code.get(f)!));
    expect(hits.sort()).toEqual(Object.keys(ATTORNEY_IN_A_DEFINITION).sort());
  });

  it("the tax lines cite the IRS pages they follow", () => {
    expect(code.get("src/components/admin/dashboard/TaxReserveCard.tsx")).toContain("https://www.irs.gov/forms-pubs/about-form-1040-es");
    expect(code.get("src/pages/info/legal/LegalChrome.tsx")).toContain("https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center");
    for (const f of ["src/pages/info/legal/TermsSection.tsx", "src/pages/info/legal/CommunitySection.tsx"]) {
      expect(code.get(f)).toMatch(/<TaxGuidanceLine \/>/);
    }
  });
});
