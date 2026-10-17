// lh-money-escrow review of 7166349cd, #4: the confirmation a poster reads
// after cancelling names what happens to their money, per fee model. A legacy
// job's late-fee refund also keeps the service fee paid at checkout
// (void-cancelled-payments customerFeeCents), so "the rest returns to your
// card" was false for it; a flat job keeps only Stripe's card fee.
// @mutate src/lib/cancelRefundCopy.ts | "the rest, less the service fee you paid at checkout, returns to your card." | "the rest returns to your card."
// @mutate src/lib/cancelRefundCopy.ts | "the rest, less the card-processing fee Stripe keeps, returns to your card." | "the rest returns to your card."
// @mutate src/lib/cancelRefundCopy.ts |   if (!wasFunded) { |   if (false) {
// @mutate src/components/CancellationDialog.tsx |         cancelRefundToast({ wasFunded, appliedFee, flatModel, keptFeeSentence }), |         cancelRefundToast({ wasFunded, appliedFee, flatModel: false, keptFeeSentence }),
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cancelRefundToast } from "./cancelRefundCopy";
import { blankComments } from "@/test/helpers/blankNonCode";

const kept = " The one-time $2.00 account setup fee is kept: it is paid once and never refunded.";

describe("cancelRefundToast", () => {
  it("never funded: nothing to refund, whatever the model", () => {
    for (const flatModel of [true, false]) {
      expect(cancelRefundToast({ wasFunded: false, appliedFee: 12, flatModel, keptFeeSentence: "" }))
        .toBe("Job cancelled. Your checkout was never completed, so you were never charged — there's nothing to refund.");
    }
  });

  it("a late fee on a flat job: the rest comes back less Stripe's card fee", () => {
    const t = cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel: true, keptFeeSentence: "" });
    expect(t).toBe("Job cancelled. The $25 cancellation fee applies — the rest, less the card-processing fee Stripe keeps, returns to your card.");
  });

  it("a late fee on a legacy job: the rest comes back less the service fee paid at checkout", () => {
    const t = cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel: false, keptFeeSentence: kept });
    expect(t).toBe(`Job cancelled. The $25 cancellation fee applies — the rest, less the service fee you paid at checkout, returns to your card.${kept}`);
    expect(t).not.toMatch(/— the rest returns to your card/);
  });

  it("no fee: flat refunds the payment less the card fee; legacy keeps the service fee", () => {
    expect(cancelRefundToast({ wasFunded: true, appliedFee: 0, flatModel: true, keptFeeSentence: "" }))
      .toBe("Job cancelled — your payment returns to your card, less the card-processing fee Stripe keeps.");
    expect(cancelRefundToast({ wasFunded: true, appliedFee: 0, flatModel: false, keptFeeSentence: "" }))
      .toBe("Job cancelled — your job budget returns to your card; the service fee isn't refundable.");
  });

  it("CancellationDialog passes the job's own fee model to it", () => {
    const src = blankComments(readFileSync("src/components/CancellationDialog.tsx", "utf8"));
    expect(src).toMatch(/cancelRefundToast\(\{ wasFunded, appliedFee, flatModel, keptFeeSentence \}\)/);
    expect(src).toMatch(/const flatModel = isFlatFeeJob\(feeStamp\);/);
    // No second, hand-written copy of the refund sentence left in the dialog.
    expect(src).not.toMatch(/returns to your card/);
  });
});
