/**
 * The job-checkout rule (the flat model only, the stale-quote check, the
 * payment methods): the app's mirror equals the edge module, and the rule says
 * what the owner decided. The poster-fee model and Pay in 4 were removed (owner
 * 2026-10-23, #3556): a quote naming either is refused.
 *
 * @mutate supabase/functions/_shared/jobCheckout.ts |   if (q.totalShown === false) return null; |   if (q.totalShown !== true) return null;
 * @mutate supabase/functions/_shared/jobCheckout.ts |   if (fee !== 0) return STALE_FEE_QUOTE_MESSAGE; |
 * @mutate supabase/functions/_shared/jobCheckout.ts |   return country !== null && country !== "US" ? country : null; |   return null;
 */
import { describe, it, expect } from "vitest";
import * as client from "./jobCheckout";
import * as edge from "../../supabase/functions/_shared/jobCheckout";

describe("job checkout rule (flat model only)", () => {
  it("client mirror == edge module, for every input", () => {
    expect(client.JOB_CHECKOUT_PAYMENT_METHOD_TYPES).toEqual(edge.JOB_CHECKOUT_PAYMENT_METHOD_TYPES);
    expect(client.STALE_FEE_QUOTE_MESSAGE).toBe(edge.STALE_FEE_QUOTE_MESSAGE);
    for (const i of [{}, { jobPriceCents: 0 }, { jobPriceCents: 12_345 }, { jobPriceCents: 10_000.4 }]) {
      expect(client.buildFeeQuote(i)).toEqual(edge.buildFeeQuote(i));
    }
    const quotes: unknown[] = [undefined, null, "x", 42, {}, { model: "poster", payInFour: false, totalShown: false },
      { model: "poster", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 570 },
      { model: "flat", payInFour: true, totalShown: false },
      { model: "flat", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 0 },
      { model: "flat", payInFour: false, totalShown: true, jobPriceCents: 9_000, serviceFeeCents: 0 }];
    for (const q of quotes) {
      for (const jobPriceCents of [9_000, 10_000]) {
        expect(client.feeQuoteRefusal(q, { jobPriceCents })).toBe(edge.feeQuoteRefusal(q, { jobPriceCents }));
      }
    }
    const charges: unknown[] = [null, {}, { payment_method_details: { type: "card", card: { country: "us" } } },
      { payment_method_details: { type: "card", card: { country: "GB" } } }, { payment_method_details: { card: { country: "" } } }];
    for (const ch of charges) {
      expect(client.chargeCardCountry(ch)).toBe(edge.chargeCardCountry(ch));
      expect(client.nonUsCardCountry(ch)).toBe(edge.nonUsCardCountry(ch));
    }
    for (const pm of [null, {}, { card: { country: "US" } }, { card: { country: "ca" } }, { card: { country: "" } }]) {
      expect(client.nonUsPaymentMethodCountry(pm)).toBe(edge.nonUsPaymentMethodCountry(pm));
    }
  });

  it("every job checkout offers card (incl. Apple/Google Pay), Link and ACH, nothing else", () => {
    expect(edge.JOB_CHECKOUT_PAYMENT_METHOD_TYPES).toEqual(["card", "link", "us_bank_account"]);
  });

  it("the quote the app sends: the flat model, the job price, no service fee", () => {
    expect(edge.buildFeeQuote({ jobPriceCents: 10_000 })).toEqual({ model: "flat", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 0 });
    expect(edge.buildFeeQuote()).toEqual({ model: "flat", payInFour: false, totalShown: false });
  });

  it("a quote is accepted only when it is the flat model at the server's price; a missing quote is accepted", () => {
    const P = { jobPriceCents: 10_000 };
    expect(edge.feeQuoteRefusal(undefined, P)).toBeNull();
    expect(edge.feeQuoteRefusal(null, P)).toBeNull();
    expect(edge.feeQuoteRefusal(edge.buildFeeQuote(P), P)).toBeNull();
    expect(edge.feeQuoteRefusal(edge.buildFeeQuote(), P)).toBeNull();
    for (const bad of [
      { model: "poster", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 570 },
      { model: "poster", payInFour: false, totalShown: false },
      { model: "flat", payInFour: true, totalShown: false },
      { ...edge.buildFeeQuote(P), jobPriceCents: 9_000 },
      { ...edge.buildFeeQuote(P), serviceFeeCents: 570 },
      { ...edge.buildFeeQuote(P), jobPriceCents: "10000" },
      "flat", 42,
    ]) {
      expect(edge.feeQuoteRefusal(bad, P), JSON.stringify(bad)).toBe(edge.STALE_FEE_QUOTE_MESSAGE);
    }
  });

  it("a non-US card is named (to page ops), a US card or a non-card payment is not", () => {
    expect(edge.nonUsCardCountry({ payment_method_details: { type: "card", card: { country: "GB" } } })).toBe("GB");
    expect(edge.nonUsCardCountry({ payment_method_details: { type: "card", card: { country: "us" } } })).toBeNull();
    expect(edge.nonUsCardCountry({ payment_method_details: { type: "us_bank_account" } })).toBeNull();
    expect(edge.nonUsCardCountry(null)).toBeNull();
  });
});
