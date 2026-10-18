/**
 * The job-checkout rule (fee model, stale-quote check, Pay in 4, payment
 * methods): the app's mirror equals the edge module, and the rule says what
 * the owner decided (2026-10-18).
 *
 * @mutate src/lib/jobCheckout.ts |   return i.switchOn && !i.recurring ? "poster" : "flat"; |   return i.switchOn ? "poster" : "flat";
 * @mutate supabase/functions/_shared/jobCheckout.ts |   if (q.totalShown === false) return null; |   if (q.totalShown !== true) return null;
 * @mutate supabase/functions/_shared/jobCheckout.ts |     return expected.model === "flat" && !expected.payInFour ? null : STALE_FEE_QUOTE_MESSAGE; |     return null;
 * @mutate supabase/functions/_shared/jobCheckout.ts | export const PAY_IN_FOUR_FEE_PERCENT = 9; | export const PAY_IN_FOUR_FEE_PERCENT = 8;
 * @mutate supabase/functions/_shared/jobCheckout.ts |   klarna: { minCents: 100, maxCents: 200_000 }, |   klarna: { minCents: 100, maxCents: 400_000 },
 * @mutate supabase/functions/_shared/jobCheckout.ts |   return country !== null && country !== "US" ? country : null; |   return null;
 */
import { describe, it, expect } from "vitest";
import * as client from "./jobCheckout";
import * as edge from "../../supabase/functions/_shared/jobCheckout";
import { posterJobFeeCents } from "../../supabase/functions/_shared/posterJobFee";

const SWITCH_CASES = [true, false].flatMap((switchOn) =>
  [true, false].map((recurring) => ({ switchOn, recurring })));

describe("job checkout rule (owner 2026-10-18)", () => {
  it("client mirror == edge module, for every input", () => {
    expect(SWITCH_CASES.length).toBe(4);
    for (const i of SWITCH_CASES) expect(client.jobFeeModelFor(i)).toBe(edge.jobFeeModelFor(i));
    for (let c = 0; c <= 160_000; c += 13) {
      for (const p4 of [false, true]) {
        expect(client.serviceFeeCentsFor("poster", c, p4)).toBe(edge.serviceFeeCentsFor("poster", c, p4));
        expect(client.payInFourMethodsFor(c * 3)).toEqual(edge.payInFourMethodsFor(c * 3));
      }
    }
    expect([...client.JOB_CHECKOUT_PAYMENT_METHOD_TYPES]).toEqual([...edge.JOB_CHECKOUT_PAYMENT_METHOD_TYPES]);
    expect([...client.PAY_IN_FOUR_PAYMENT_METHOD_TYPES]).toEqual([...edge.PAY_IN_FOUR_PAYMENT_METHOD_TYPES]);
    expect(client.STALE_FEE_QUOTE_MESSAGE).toBe(edge.STALE_FEE_QUOTE_MESSAGE);
    expect(client.JOBS_POSTER_FEE_SWITCH).toBe(edge.JOBS_POSTER_FEE_SWITCH);
    expect(client.PAY_IN_FOUR_FEE_PERCENT).toBe(edge.PAY_IN_FOUR_FEE_PERCENT);
    expect(client.PAY_IN_FOUR_LIMITS).toEqual(edge.PAY_IN_FOUR_LIMITS);
    for (const p4 of [false, true]) expect(client.posterFeePercentFor(p4)).toBe(edge.posterFeePercentFor(p4));
    const quotes: unknown[] = [undefined, null, "x", {}, { model: "poster", payInFour: false, totalShown: false },
      { model: "poster", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 570 },
      { model: "flat", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 0 }];
    for (const q of quotes) {
      for (const model of ["poster", "flat"] as const) {
        for (const payInFour of [false, true]) {
          const e = { model, payInFour, jobPriceCents: 10_000 };
          expect(client.feeQuoteRefusal(q, e)).toBe(edge.feeQuoteRefusal(q, e));
        }
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

  it("the poster-fee model needs the switch, and gift / recurring checkouts stay flat until their slices land", () => {
    for (const i of SWITCH_CASES) {
      expect(edge.jobFeeModelFor(i)).toBe(i.switchOn && !i.recurring ? "poster" : "flat");
    }
  });

  it("5% + 70c is the shared poster fee rule at every price; Pay in 4 is 9% + 70c; the flat model charges no fee", () => {
    for (let c = 1; c <= 125_000; c += 7) {
      expect(edge.serviceFeeCentsFor("poster", c, false)).toBe(posterJobFeeCents(c));
      expect(edge.serviceFeeCentsFor("poster", c, true)).toBe(Math.round(c * 0.09) + 70);
      expect(edge.serviceFeeCentsFor("flat", c, false)).toBe(0);
    }
    expect(edge.serviceFeeCentsFor("poster", 10_000, true)).toBe(970);
  });

  it("a quote is accepted only when it matches exactly; a missing quote only on the flat model", () => {
    const P = { model: "poster" as const, payInFour: false, jobPriceCents: 10_000 };
    const ok = edge.buildFeeQuote({ switchOn: true, recurring: false, jobPriceCents: 10_000 });
    expect(ok).toEqual({ model: "poster", payInFour: false, totalShown: true, jobPriceCents: 10_000, serviceFeeCents: 570 });
    expect(edge.feeQuoteRefusal(ok, P)).toBeNull();
    expect(edge.feeQuoteRefusal(undefined, P)).toBe(edge.STALE_FEE_QUOTE_MESSAGE);
    expect(edge.feeQuoteRefusal(undefined, { ...P, model: "flat" })).toBeNull();
    expect(edge.feeQuoteRefusal(undefined, { ...P, model: "flat", payInFour: true })).toBe(edge.STALE_FEE_QUOTE_MESSAGE);
    for (const bad of [
      { ...ok, serviceFeeCents: 569 }, { ...ok, serviceFeeCents: 571 }, { ...ok, jobPriceCents: 9_999 },
      { ...ok, model: "flat" }, { ...ok, payInFour: true }, { ...ok, serviceFeeCents: 570.5 }, { ...ok, jobPriceCents: "10000" }, 42,
      // A quote that never says whether it showed a total is checked in full.
      { model: "poster", payInFour: false, jobPriceCents: 10_000, serviceFeeCents: 569 },
    ]) {
      expect(edge.feeQuoteRefusal(bad, P), JSON.stringify(bad)).toBe(edge.STALE_FEE_QUOTE_MESSAGE);
    }
    // A screen with no total: model + Pay-in-4 choice only.
    const modelOnly = edge.buildFeeQuote({ switchOn: true, recurring: false });
    expect(modelOnly).toEqual({ model: "poster", payInFour: false, totalShown: false });
    expect(edge.feeQuoteRefusal(modelOnly, P)).toBeNull();
    expect(edge.feeQuoteRefusal({ ...modelOnly, model: "flat" }, P)).toBe(edge.STALE_FEE_QUOTE_MESSAGE);
  });

  it("Pay in 4 is offered only where a provider takes the amount (Klarna $1-$2,000, Afterpay $1-$4,000), never Affirm", () => {
    expect(edge.payInFourMethodsFor(99)).toEqual([]);
    expect(edge.payInFourMethodsFor(100)).toEqual(["klarna", "afterpay_clearpay"]);
    expect(edge.payInFourMethodsFor(200_000)).toEqual(["klarna", "afterpay_clearpay"]);
    expect(edge.payInFourMethodsFor(200_001)).toEqual(["afterpay_clearpay"]);
    expect(edge.payInFourMethodsFor(400_001)).toEqual([]);
    expect(edge.PAY_IN_FOUR_PAYMENT_METHOD_TYPES).not.toContain("affirm");
  });

  it("a non-US card is named (to page ops), a US card or a non-card payment is not", () => {
    expect(edge.nonUsCardCountry({ payment_method_details: { type: "card", card: { country: "GB" } } })).toBe("GB");
    expect(edge.nonUsCardCountry({ payment_method_details: { type: "card", card: { country: "us" } } })).toBeNull();
    expect(edge.nonUsCardCountry({ payment_method_details: { type: "us_bank_account" } })).toBeNull();
    expect(edge.nonUsCardCountry(null)).toBeNull();
  });
});
