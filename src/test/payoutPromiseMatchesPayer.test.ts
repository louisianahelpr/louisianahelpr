/**
 * An approval notice promises what the payout will really send (10-30 jobs audit,
 * item 6). It quoted the job's take-home, so a first-time Helpr read "$89 will be
 * sent" on a $100 job and received $87: the unpaid setup fee comes off the transfer,
 * and so does money owed from an at-fault ruling. 303 of 311 profiles had the fee
 * unpaid (measured on prod 10-30), so this was the normal first payout.
 *
 * The figures run the shared arithmetic; the source checks tie it to both payers,
 * so changing how a payout takes the fee fails here until the promise follows.
 *
 * @mutate supabase/functions/_shared/payoutPromise.ts | const setupFeeCents = opts.giveaway ? 0 : Math.max(0, opts.setupFeeOwedCents); | const setupFeeCents = 0;
 * @mutate supabase/functions/_shared/payoutPromise.ts | return { cents: afterFee - debtCents, setupFeeCents, debtCents }; | return { cents: afterFee, setupFeeCents, debtCents };
 * @mutate supabase/functions/_shared/payoutPromise.ts | Math.min(Math.max(0, opts.debtOwedCents), helprFaultFeeCapCents(opts.unroundedCents - setupFeeCents)); | Math.max(0, opts.debtOwedCents);
 * @mutate supabase/functions/_shared/payoutPromise.ts |   if (!promised) return `Your pay will be sent to your account${payDay}.`; |   if (!promised) return `$0 will be sent to your account${payDay}.`;
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | const payoutCents = roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0)) - helprFaultFeeCents; | const payoutCents = roundPayoutDownCents(unroundedPayoutCents - helprFaultFeeCents);
 * @mutate supabase/functions/create-payment/index.ts | payoutPromiseSentence(await readPromisedPayout(supabaseAdmin, job.helper_id, job, helperPayout), payDay) | `$${formatPayoutDollars(helperPayout)} will be sent to your account ${payDay}.`
 * @mutate supabase/functions/auto-release-payment/index.ts | payoutPromiseSentence(await readPromisedPayout(supabaseAdmin, job.helper_id, job, helperPayout), payDay) | `$${helperPayout} will be sent to your account ${payDay}.`
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { payoutPromiseSentence, promisedPayoutCents } from "../../supabase/functions/_shared/payoutPromise";

const read = (rel: string) => blankComments(readFileSync(resolve(process.cwd(), rel), "utf8"));
const DAY = "Tue, Nov 3";
const base = { setupFeeOwedCents: 0, debtOwedCents: 0, giveaway: false };

describe("what the notice promises", () => {
  it("a first payout: $100 job at 10% + 70c, setup fee unpaid", () => {
    const p = promisedPayoutCents({ ...base, unroundedCents: 8930, setupFeeOwedCents: 200 });
    expect(p).toEqual({ cents: 8700, setupFeeCents: 200, debtCents: 0 });
    expect(payoutPromiseSentence(p, DAY)).toBe("$87 will be sent to your account Tue, Nov 3, after the one-time $2 account setup fee.");
  });

  it("no fee and no debt: the plain figure, floored to whole dollars like the transfer", () => {
    const p = promisedPayoutCents({ ...base, unroundedCents: 8930 });
    expect(p.cents).toBe(8900);
    expect(payoutPromiseSentence(p, DAY)).toBe("$89 will be sent to your account Tue, Nov 3.");
    // No known day: the sentence leaves it out, and never prints "null".
    expect(payoutPromiseSentence(p, null)).toBe("$89 will be sent to your account.");
    expect(payoutPromiseSentence(null, null)).toBe("Your pay will be sent to your account.");
    expect(payoutPromiseSentence(null, DAY)).toBe("Your pay will be sent to your account Tue, Nov 3.");
  });

  it("a debt comes off in exact cents after the whole-dollar floor", () => {
    const p = promisedPayoutCents({ ...base, unroundedCents: 8930, debtOwedCents: 350 });
    expect(p).toEqual({ cents: 8550, setupFeeCents: 0, debtCents: 350 });
    expect(payoutPromiseSentence(p, DAY)).toBe("$85.50 will be sent to your account Tue, Nov 3, after $3.50 owed from a job you were ruled at fault on.");
  });

  it("a debt larger than the payout leaves $1, and the rest waits", () => {
    expect(promisedPayoutCents({ ...base, unroundedCents: 1000, debtOwedCents: 5000 })).toEqual({ cents: 100, setupFeeCents: 0, debtCents: 900 });
  });

  it("fee and debt together name both", () => {
    const p = promisedPayoutCents({ ...base, unroundedCents: 8930, setupFeeOwedCents: 200, debtOwedCents: 350 });
    expect(p.cents).toBe(8350);
    expect(payoutPromiseSentence(p, DAY)).toBe("$83.50 will be sent to your account Tue, Nov 3, after the one-time $2 account setup fee and $3.50 owed from a job you were ruled at fault on.");
  });

  it("the giveaway sends its exact amount: the fee and any debt do not touch it", () => {
    const p = promisedPayoutCents({ unroundedCents: 5000, setupFeeOwedCents: 200, debtOwedCents: 350, giveaway: true });
    expect(p).toEqual({ cents: 5000, setupFeeCents: 0, debtCents: 0 });
    expect(payoutPromiseSentence(p, DAY)).toBe("$50 will be sent to your account Tue, Nov 3.");
  });

  it("a payout too small to cover the fee promises nothing to send", () => {
    expect(promisedPayoutCents({ ...base, unroundedCents: 150, setupFeeOwedCents: 200 }).cents).toBe(0);
  });

  it("when the fee or debt cannot be read it names the day and no figure", () => {
    const s = payoutPromiseSentence(null, DAY);
    expect(s).toBe("Your pay will be sent to your account Tue, Nov 3.");
    expect(s).not.toContain("$");
  });
});

describe("the arithmetic is the payers'", () => {
  const scheduled = read("supabase/functions/process-scheduled-payouts/index.ts");

  it("process-scheduled-payouts: whole dollars after the fee, then the exact debt, under the same cap", () => {
    expect(scheduled).toContain("const payoutCents = roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0)) - helprFaultFeeCents;");
    expect(scheduled).toContain("helprFaultFeeCapCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0))");
    expect(scheduled).toContain("if (!isGiveawayFixedPayJob(job)) {");
  });

  it("both approval notices promise through it", () => {
    for (const file of ["supabase/functions/create-payment/index.ts", "supabase/functions/auto-release-payment/index.ts"]) {
      expect(read(file), file).toContain("readPromisedPayout(supabaseAdmin, job.helper_id, job, helperPayout)");
      expect(read(file), file).not.toMatch(/\$\$\{formatPayoutDollars\(helperPayout\)\} will be sent to your account/);
    }
  });
});
