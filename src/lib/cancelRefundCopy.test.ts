// lh-money-escrow review of 7166349cd, #4: the confirmation a poster reads
// after cancelling names what happens to their money, per fee model. A legacy
// job's late-fee refund also keeps the service fee paid at checkout
// (void-cancelled-payments customerFeeCents), so "the rest returns to your
// card" was false for it; a flat job keeps only Stripe's card fee.
// @mutate src/lib/cancelRefundCopy.ts | "the rest, less the service fee you paid at checkout, returns to your card." | "the rest returns to your card."
// @mutate src/lib/cancelRefundCopy.ts | "the rest, less the card-processing fee Stripe keeps, returns to your card." | "the rest returns to your card."
// @mutate src/lib/cancelRefundCopy.ts |   if (!wasFunded) { |   if (false) {
// @mutate src/components/CancellationDialog.tsx |         cancelRefundToast({ wasFunded, appliedFee, flatModel, keptFeeSentence, gift }), |         cancelRefundToast({ wasFunded, appliedFee, flatModel: false, keptFeeSentence, gift }),
// Q?gift-cancel-copy (lh-money-escrow review of 7166349cd, #7, and the Q1806
// design review, 2026-10-17): a gift-paid job's money goes back to the GIFT
// balance; the card copy ("returns to your card, less ...") was false for it.
// @mutate src/lib/cancelRefundCopy.ts |   if (gift === "redeemed") { |   if (false) {
// @mutate src/lib/cancelRefundCopy.ts |   if (gift === "unknown") { |   if (false) {
// @mutate src/lib/cancelRefundCopy.ts |     if (gift === "reserved") { |     if (false) {
// @mutate src/lib/cancelRefundCopy.ts |   if (error) return "unknown"; |   if (error) return "none";
// @mutate src/components/CancellationDialog.tsx |         cancelRefundToast({ wasFunded, appliedFee, flatModel, keptFeeSentence, gift }), |         cancelRefundToast({ wasFunded, appliedFee, flatModel, keptFeeSentence }),
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cancelRefundToast, giftOnJobFromRead } from "./cancelRefundCopy";
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

  it("a gift paid toward the job: it goes back to the gift balance, never 'to your card' alone", () => {
    for (const flatModel of [true, false]) {
      const keeps = flatModel ? "the card-processing fee Stripe keeps" : "the service fee you paid at checkout";
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 0, flatModel, keptFeeSentence: "", gift: "redeemed" }))
        .toBe(`Job cancelled — your gift goes back to your gift balance within the hour, and any card payment returns to your card, less ${keeps}.`);
      // A late fee: the gift/card split is Q1806's, so "up to" the fee and the exact amounts follow.
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: kept, gift: "redeemed" }))
        .toBe(`Job cancelled. Your gift goes back to your gift balance and any card payment returns to your card, less up to the $25 cancellation fee and ${keeps}. We'll send you the exact amounts.${kept}`);
    }
    // A gift set aside for a checkout that never completed.
    expect(cancelRefundToast({ wasFunded: false, appliedFee: 0, flatModel: true, keptFeeSentence: "", gift: "reserved" }))
      .toBe("Job cancelled. Your checkout was never completed, so your card was never charged, and the gift you set aside goes back to your gift balance within the hour.");
    // The read failed: neutral, never the card copy.
    const neutral = cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel: true, keptFeeSentence: "", gift: "unknown" });
    expect(neutral).toBe("Job cancelled. We'll send you a note with exactly what comes back to you within the hour.");
  });

  it("the gift read: a read error is 'unknown', never 'none'", () => {
    expect(giftOnJobFromRead(null, { code: "57014" })).toBe("unknown");
    expect(giftOnJobFromRead([], null)).toBe("none");
    expect(giftOnJobFromRead([{ status: "reserved" }], null)).toBe("reserved");
    expect(giftOnJobFromRead([{ status: "reserved" }, { status: "redeemed" }], null)).toBe("redeemed");
  });

  it("CancellationDialog passes the job's own fee model and gift to it", () => {
    const src = blankComments(readFileSync("src/components/CancellationDialog.tsx", "utf8"));
    expect(src).toMatch(/cancelRefundToast\(\{ wasFunded, appliedFee, flatModel, keptFeeSentence, gift \}\)/);
    expect(src).toMatch(/gift = giftOnJobFromRead\(giftRows, giftErr\);/);
    expect(src).toMatch(/const flatModel = isFlatFeeJob\(feeStamp\);/);
    // No second, hand-written copy of the refund sentence left in the dialog.
    expect(src).not.toMatch(/returns to your card/);
  });
});
