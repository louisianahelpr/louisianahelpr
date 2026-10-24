/**
 * THE TERMS SAY THE POSTER PAYS NOTHING ON TOP, AND IT IS TRUE (owner
 * 2026-10-20: the Terms describe the current flat model; the Helpr pays
 * 5% + $0.70, the poster pays the job price).
 *
 * The poster sentence in TermsSection is built from the checkout's own fee
 * functions at the DEFAULT switch state (jobs_poster_fee off): this guard fails
 * if that default ever charges a poster fee while the Terms still say "no fee",
 * and if any Terms line claims a poster service fee or a card-processing fee
 * "added on top" of the job.
 * If jobs_poster_fee is ever switched on for everyone, the Terms poster
 * sentence must change first (docs/OPEN.md Q2264).
 *
 * @mutate src/pages/info/legal/TermsSection.tsx | const POSTER_FEE_ON_DEFAULT_CENTS = serviceFeeCentsFor(jobFeeModelFor({ switchOn: false }), 10_000, false); | const POSTER_FEE_ON_DEFAULT_CENTS = 0;
 * @mutate src/lib/jobCheckout.ts |   return i.switchOn ? "poster" : "flat"; |   return "poster";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { jobFeeModelFor, serviceFeeCentsFor } from "@/lib/jobCheckout";

const terms = blankComments(readFileSync(resolve(__dirname, "../pages/info/legal/TermsSection.tsx"), "utf8"));

describe("the Terms poster sentence matches the default fee model", () => {
  it("the default (switch off) checkout charges the poster nothing on top", () => {
    expect(jobFeeModelFor({ switchOn: false })).toBe("flat");
    expect(serviceFeeCentsFor(jobFeeModelFor({ switchOn: false }), 10_000, false)).toBe(0);
    expect(serviceFeeCentsFor(jobFeeModelFor({ switchOn: false }), 10_000, true)).toBe(0);
  });

  it("the Terms read that default and claim no poster fee", () => {
    expect(terms).toContain("const POSTER_FEE_ON_DEFAULT_CENTS = serviceFeeCentsFor(jobFeeModelFor({ switchOn: false }), 10_000, false);");
    expect(terms).toMatch(/POSTER_FEE_ON_DEFAULT_CENTS === 0\s*\?\s*"Posting a job has no fee: the poster pays the job price/);
    // PayPal phase 5: the PayPal path reads its own sentence (taxable types not payable yet, setup
    // fee on the first checkout); the default path still reads POSTER_PAYS_SENTENCE.
    expect(terms).toContain("${fee.paypal ? POSTER_PAYS_SENTENCE_PAYPAL : POSTER_PAYS_SENTENCE}");
    expect(terms).toContain("{fee.paypal ? POSTER_PAYS_SENTENCE_PAYPAL : POSTER_PAYS_SENTENCE}");
    expect(terms).not.toMatch(/service fee that only covers card processing|Service fee \(covers card processing\)|The service fee goes to card processing|added on top and shown before they pay, and is never taken from the bonus/);
  });
});
