/**
 * THE TERMS QUOTE THE FEE THE PAYOUT CHARGES (owner 2026-10-20). Terms said the
 * Helpr's platform fee was "8–12%, set by their own plan" (the retired tier
 * ladder) while every job since 2026-10-15 pays a flat 5% + 70c. The Terms,
 * the Help Center and the payout math now share ONE phrase, HELPR_FLAT_FEE_PHRASE
 * (src/lib/helprFlatFee.ts), and this guard derives the phrase from the fee
 * FUNCTION itself (helprFlatFeeCents), so the words and the money fail together
 * if either changes alone.
 *
 * @mutate src/lib/helprFlatFee.ts | export const HELPR_FLAT_FEE_PHRASE = `${HELPR_FLAT_FEE_PERCENT}% + $${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)}`; | export const HELPR_FLAT_FEE_PHRASE = "8–12%";
 * @mutate src/pages/info/legal/TermsSection.tsx | the Helpr fee above. | the Helpr's plan-based fee.
 * @mutate src/pages/info/legal/TermsSection.tsx | The Helpr's fee (${fee.phrase} of their pay | The Helpr's fee (12% of their pay
 * @mutate src/pages/info/legal/TermsSection.tsx | <p><strong className="text-foreground">Helpr fee:</strong> {fee.phrase} of each | <p><strong className="text-foreground">Helpr fee:</strong> {TIER_PERKS.free.platformFeePercent}% of each
 * @mutate src/pages/info/legal/TermsSection.tsx |   const fee = useHelprJobFee(); |   const fee = { phrase: "8–12%", paypal: false };
 *
 * PayPal phase 5 (owner fee ruling 2026-10-23): the jobs fee in the Terms and the Help Center is the
 * VIEWER's (useHelprJobFee / helprJobFeeFor): 8% + $0.70 on the PayPal path, else this phrase.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { HELPR_FLAT_FEE_PHRASE, helprFlatFeeCents } from "@/lib/helprFlatFee";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("the Terms quote the fee the payout charges", () => {
  it("the shared phrase is what helprFlatFeeCents actually charges", () => {
    const on100 = helprFlatFeeCents(10_000);
    const on200 = helprFlatFeeCents(20_000);
    const pct = (on200 - on100) / 100; // percent of each extra $100
    const fixed = on100 - pct * 100; // cents on top
    expect(pct).toBeGreaterThan(0);
    expect(HELPR_FLAT_FEE_PHRASE).toBe(`${pct}% + $${(fixed / 100).toFixed(2)}`);
  });

  it("Terms and the Help Center read the phrase; no tier ladder is quoted", () => {
    const terms = read("pages/info/legal/TermsSection.tsx");
    expect(terms).toContain("The Helpr's fee (${fee.phrase} of their pay");
    expect(terms).toContain('<p><strong className="text-foreground">Helpr fee:</strong> {fee.phrase} of each');
    expect(terms).toContain("const fee = useHelprJobFee();");
    expect(terms).not.toMatch(/platformFeePercent|\bFEE_FLOOR\b|plan-based/);
    expect(read("pages/info/helpCenter/helpCenterContent.ts")).toContain("const FLAT_FEE_PHRASE = fee.phrase;");
    expect(read("pages/info/helpCenter/helpCenterContent.ts")).toContain("export const FAQ_SECTIONS: FaqSection[] = faqSectionsFor(helprJobFeeFor(false));");
  });
});
