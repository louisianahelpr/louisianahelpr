/**
 * THE TERMS SAY THE POSTER PAYS NOTHING ON TOP, AND IT IS TRUE (owner
 * 2026-10-20: the Terms describe the flat model; the Helpr pays 5% + $0.70,
 * the poster pays the job price). The flat model is the only one since the
 * poster-fee model was removed (owner 2026-10-23, #3556).
 *
 * The poster sentence in TermsSection is built from the checkout's own quote
 * (buildFeeQuote): this guard fails if that quote ever carries a poster fee
 * while the Terms still say "no fee", and if any Terms line claims a poster
 * service fee or a card-processing fee "added on top" of the job.
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | const POSTER_FEE_ON_DEFAULT_CENTS = buildFeeQuote({ jobPriceCents: 10_000 }).serviceFeeCents ?? 0; | const POSTER_FEE_ON_DEFAULT_CENTS = 0;
 * @mutate src/lib/jobCheckout.ts |   return { model: "flat", payInFour: false, totalShown: true, jobPriceCents, serviceFeeCents: 0 }; |   return { model: "flat", payInFour: false, totalShown: true, jobPriceCents, serviceFeeCents: 570 };
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { buildFeeQuote } from "@/lib/jobCheckout";

const terms = blankComments(readFileSync(resolve(__dirname, "../pages/info/legal/TermsSection.tsx"), "utf8"));

describe("the Terms poster sentence matches the checkout's fee", () => {
  it("the checkout quotes the poster nothing on top", () => {
    expect(buildFeeQuote({ jobPriceCents: 10_000 }).serviceFeeCents).toBe(0);
  });

  it("the Terms read that quote and claim no poster fee", () => {
    expect(terms).toContain("const POSTER_FEE_ON_DEFAULT_CENTS = buildFeeQuote({ jobPriceCents: 10_000 }).serviceFeeCents ?? 0;");
    expect(terms).toMatch(/POSTER_FEE_ON_DEFAULT_CENTS === 0\s*\?\s*"Posting a job has no fee: the poster pays the job price/);
    expect(terms).toContain("${POSTER_PAYS_SENTENCE}");
    expect(terms).toContain("{POSTER_PAYS_SENTENCE}");
    expect(terms).not.toMatch(/service fee that only covers card processing|Service fee \(covers card processing\)|The service fee goes to card processing|added on top and shown before they pay, and is never taken from the bonus/);
  });
});
