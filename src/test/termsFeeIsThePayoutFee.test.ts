/**
 * THE TERMS STATE THE HELPR FEE IN ONE GENERAL SENTENCE (owner 2026-10-25).
 *
 * History: on 2026-10-20 the Terms quoted the retired tier ladder ("8–12%")
 * while every job paid a flat fee, so this guard tied the Terms' number to the
 * fee function. On 2026-10-25 the owner ruled that members never see a fee
 * number, name or maths anywhere, and that the Terms keep ONE general
 * sentence: Louisiana Helpr keeps a service fee from each Helpr payout. So the
 * Terms carry that sentence and no rate: no fee phrase, no tier ladder, no
 * percent next to the fee. The fee itself (10% + 70c on new jobs) is held by
 * helprFlatFee.parity.test.ts; the member-wide class by membersSeeNoFeeWords.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | Louisiana Helpr keeps a service fee from each Helpr payout; | Louisiana Helpr keeps 10% + $0.70 of each Helpr payout;
 * @mutate src/pages/info/legal/TermsSection.tsx | the one-time account setup fee and the service fee above. | the one-time account setup fee and the Helpr's plan-based fee.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { HELPR_FLAT_FEE_CENTS, HELPR_FLAT_FEE_PERCENT, helprFlatFeeCents } from "@/lib/helprFlatFee";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("the Terms state the Helpr fee in one general sentence", () => {
  it("the fee new jobs pay is 10% + 70c (the number the Terms no longer quote)", () => {
    expect(HELPR_FLAT_FEE_PERCENT).toBe(10);
    expect(HELPR_FLAT_FEE_CENTS).toBe(70);
    expect(helprFlatFeeCents(10_000)).toBe(1070);
  });

  it("Terms carry the general sentence and no rate", () => {
    const terms = read("pages/info/legal/TermsSection.tsx");
    expect(terms).toContain("Louisiana Helpr keeps a service fee from each Helpr payout; a Helpr always sees what they will take home before they apply.");
    expect(terms).not.toMatch(/HELPR_FLAT_FEE|platformFeePercent|\bFEE_FLOOR\b|plan-based/);
    expect(terms).not.toMatch(/\d+%\s*\+\s*\$0\.70 of/);
  });
});
