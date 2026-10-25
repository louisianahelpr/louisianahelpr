import { describe, it, expect } from "vitest";
import * as client from "./posterJobFee";
import * as edge from "../../supabase/functions/_shared/posterJobFee";
import { checkoutAmounts } from "./declutter/money";
import { stripeProcessingCostCents } from "../../supabase/functions/_shared/stripeFees";
import { TAXABLE_CATEGORIES, salesTaxCeilingCents } from "../../supabase/functions/_shared/salesTax";
import { helprFlatFeeCents, isFlatFeeJob } from "../../supabase/functions/_shared/helprFlatFee";
import * as edgeFlat from "../../supabase/functions/_shared/helprFlatFee";
import * as clientFlat from "./helprFlatFee";
import { cancellationHelperShare } from "./cancellationHelperShare";
import { jobHelprCommissionDollars } from "../../supabase/functions/_shared/helperFees";

// Owner decision 2026-10-18 ("one fee everywhere", the Declutter rule): the
// poster pays 5% of the job price + $0.70, the card cost comes out of it, and
// the Helpr keeps 100%.
// @mutate supabase/functions/_shared/posterJobFee.ts | export const POSTER_JOB_FEE_CENTS = 70; | export const POSTER_JOB_FEE_CENTS = 60;
// @mutate src/lib/posterJobFee.ts |   return Math.round((base * pct) / 100) + flat; |   return Math.round((base * pct) / 100);
// @mutate supabase/functions/_shared/posterJobFee.ts |   if (v === null \|\| v === undefined \|\| v === "") return false; |   if (v === undefined \|\| v === "") return false;
// @mutate supabase/functions/_shared/helprFlatFee.ts |   if (helprPaysNoFee(job)) return 0;\n  // Only |   // Only
// @mutate src/lib/helprFlatFee.ts |   return Number(job!.helper_fee_flat_cents) === 0 && (pctAbsent \|\| Number(pct) === 0); |   return false;

/** The stamps create-payment writes on a poster-fee job. */
const P_STAMP = { poster_fee_flat_cents: 70, platform_fee_percent: 5, helper_fee_flat_cents: 0, helper_fee_percent: 0 };

describe("jobs poster fee (owner 2026-10-18)", () => {
  it("$100 job: the poster pays $105.70 and the Helpr receives $100", () => {
    for (const m of [client, edge]) expect(m.posterJobFeeCents(10_000)).toBe(570);
    expect(10_000 - jobHelprCommissionDollars(P_STAMP, 100, 12, 0) * 100).toBe(10_000);
  });

  it("is the Declutter buyer's fee to the cent at every price (one fee everywhere)", () => {
    for (let c = 1; c <= 125_000; c += 7) {
      expect(edge.posterJobFeeCents(c)).toBe(checkoutAmounts([c]).premiumCents);
    }
  });

  it("the card cost comes out of the fee: it covers Stripe's 2.9% + 30c and Stripe Tax's 0.5% on the WHOLE charge (fee, tax ceiling and $2 setup included) at every allowed price", () => {
    // Budget $10-$1,000 (jobs_budget_range) plus an urgent bonus up to $250 (jobs_urgent_fee_ceiling).
    const taxable = [...TAXABLE_CATEGORIES][0];
    let checked = 0;
    for (let base = 1_000; base <= 125_000; base += 11) {
      const fee = edge.posterJobFeeCents(base);
      // The tax ceiling on the whole base (an upper bound: only the labor line is taxed).
      const tax = salesTaxCeilingCents(base, taxable);
      expect(tax).toBeGreaterThan(0);
      const charge = base + fee + tax + 200;
      // Stripe Tax: the account's LA registration is active (live
      // /v1/tax/registrations, 2026-10-17), and Tax on Checkout costs 0.5% of
      // each transaction (stripe.com/tax/pricing), on top of the card cost.
      expect(fee).toBeGreaterThanOrEqual(stripeProcessingCostCents(charge) + Math.ceil(charge * 0.005));
      checked++;
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it("constants and every price agree between the two runtimes, stamped or not", () => {
    expect(client.POSTER_JOB_FEE_PERCENT).toBe(edge.POSTER_JOB_FEE_PERCENT);
    expect(client.POSTER_JOB_FEE_CENTS).toBe(edge.POSTER_JOB_FEE_CENTS);
    expect(client.POSTER_JOB_FEE_DESCRIPTION).toBe(edge.POSTER_JOB_FEE_DESCRIPTION);
    for (let c = 0; c <= 200_000; c += 13) {
      expect(client.posterJobFeeCents(c)).toBe(edge.posterJobFeeCents(c));
      expect(client.posterJobFeeCents(c, P_STAMP)).toBe(edge.posterJobFeeCents(c, P_STAMP));
    }
  });

  it("a job keeps the numbers it was stamped with; an unstamped job's platform_fee_percent is never read", () => {
    for (const m of [client, edge]) {
      expect(m.isPosterFeeJob(P_STAMP)).toBe(true);
      expect(m.isPosterFeeJob({ poster_fee_flat_cents: null, platform_fee_percent: 12 })).toBe(false);
      expect(m.isPosterFeeJob(null)).toBe(false);
      expect(m.posterJobFeeCents(10_000, { poster_fee_flat_cents: 50, platform_fee_percent: 4 })).toBe(450);
      // A legacy job's 12% service fee is NOT this model's percent.
      expect(m.posterJobFeeCents(10_000, { poster_fee_flat_cents: null, platform_fee_percent: 12 })).toBe(570);
      expect(m.posterJobFeeCents(0)).toBe(0);
    }
  });

  it("the Helpr pays nothing on a poster-fee job through the shared payout rule (the 0/0 stamp), on budget and bonus, alone or in a crew share", () => {
    expect(isFlatFeeJob(P_STAMP)).toBe(true); // the trap the module header names
    for (let share = 0; share <= 125_000; share += 17) {
      expect(helprFlatFeeCents(share, P_STAMP)).toBe(0);
      expect(jobHelprCommissionDollars(P_STAMP, share / 100, 12, 25)).toBe(0);
    }
  });

  // lh-money-escrow review of the jobs-fee plan, #1: six client selects and the
  // three browse RPCs carry helper_fee_flat_cents WITHOUT helper_fee_percent,
  // so a 0c flat stamp alone would have fallen back to the 5% default and shown
  // a poster-fee Helpr losing 5% (JobPrice, ApplyEarningsBreakdown, the
  // cancellation share). Every read shape a P job can arrive in prices 0.
  it("a poster-fee job's Helpr pays 0 in every read shape: full stamp, flat stamp without the percent, poster stamp alone", () => {
    const shapes = [
      P_STAMP,
      { helper_fee_flat_cents: 0 },
      { helper_fee_flat_cents: 0, helper_fee_percent: null },
      { poster_fee_flat_cents: 70 },
      { poster_fee_flat_cents: 70, helper_fee_flat_cents: 0 },
    ];
    let checked = 0;
    for (const m of [edgeFlat, clientFlat]) {
      for (const job of shapes) {
        expect(m.helprPaysNoFee(job), JSON.stringify(job)).toBe(true);
        expect(m.flatFeePercentOf({ helper_fee_flat_cents: 0, ...job }), JSON.stringify(job)).toBe(0);
        for (const share of [100, 1_000, 10_000, 125_000]) {
          expect(m.helprFlatFeeCents(share, job), JSON.stringify(job)).toBe(0);
          checked++;
        }
      }
      // An F3 job read without its percent still pays the flat fee (10% + 70c from 2026-10-25).
      expect(m.helprPaysNoFee({ helper_fee_flat_cents: 70 })).toBe(false);
      expect(m.helprFlatFeeCents(10_000, { helper_fee_flat_cents: 70 })).toBe(1_070);
      expect(m.helprPaysNoFee({ helper_fee_flat_cents: null, helper_fee_percent: 12 })).toBe(false);
    }
    expect(checked).toBeGreaterThan(30);
    expect(cancellationHelperShare(25, { helper_fee_flat_cents: 0 }).platformCut).toBe(0);
    expect(cancellationHelperShare(25, { helper_fee_flat_cents: 0 }).helperPayout).toBe(25);
    // Review #4: the label says "No fee" (never "0% + $0.00") and the dialog hides the line.
    // @mutate src/lib/cancellationHelperShare.ts |   if (helprPaysNoFee(job)) { |   if (false) {
    expect(cancellationHelperShare(25, P_STAMP)).toEqual({ platformCut: 0, helperPayout: 25, noFee: true });
    expect(cancellationHelperShare(25, { helper_fee_flat_cents: 70, helper_fee_percent: 5 }).noFee).toBe(false);
  });
});
