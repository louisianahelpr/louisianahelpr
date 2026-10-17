// lh-money-escrow review of 7166349cd, #4: the confirmation a poster reads
// after cancelling names what happens to their money, per fee model. A legacy
// job's late-fee refund also keeps the service fee paid at checkout
// (void-cancelled-payments customerFeeCents), so "the rest returns to your
// card" was false for it; a flat job keeps only Stripe's card fee.
// @mutate src/lib/cancelRefundCopy.ts | "the rest, less the service fee you paid at checkout, returns to your card." | "the rest returns to your card."
// @mutate src/lib/cancelRefundCopy.ts | "the rest, less the card-processing fee Stripe keeps, returns to your card." | "the rest returns to your card."
// @mutate src/lib/cancelRefundCopy.ts |   if (!wasFunded) { |   if (false) {
// @mutate src/components/CancellationDialog.tsx |         cancelRefundToast({ wasFunded, appliedFee, flatModel, keptFeeSentence, gift, cardShareCents, keptSetupCents: Math.round(keptFee * 100), crew: !!crew }), |         cancelRefundToast({ wasFunded, appliedFee, flatModel: false, keptFeeSentence, gift, cardShareCents, keptSetupCents: Math.round(keptFee * 100), crew: !!crew }),
// Q?gift-cancel-copy (lh-money-escrow review of 7166349cd, #7, and the Q1806
// design review, 2026-10-17): a gift-paid job's money goes back to the GIFT
// balance; the card copy ("returns to your card, less ...") was false for it.
// @mutate src/lib/cancelRefundCopy.ts |   if (gift === "redeemed") { |   if (false) {
// @mutate src/lib/cancelRefundCopy.ts |   if (gift === "unknown") return neutral; |   if (false) return neutral;
// @mutate src/lib/cancelRefundCopy.ts |   if (error) return "unknown"; |   if (error) return "none";
// lh-money-escrow review of 39279d3e5: #1 a reserved gift is decided before
// wasFunded (a declined card leaves the job 'failed', funded-looking, with the
// gift reserved); #2 a gift that paid the whole job says no card was charged;
// #4 a reversed donation's gift is not spendable, so neutral copy.
// @mutate src/lib/cancelRefundCopy.ts |   if (gift === "reserved") { |   if (false) {
// @mutate src/lib/cancelRefundCopy.ts |     return wasFunded\n      ? neutral | return !wasFunded\n      ? neutral
// @mutate src/lib/cancelRefundCopy.ts |   if (gift === "gift_only") { |   if (false) {
// @mutate src/lib/cancelRefundCopy.ts |   if (gift === "gift_and_card") { |   if (false) {
// @mutate src/lib/cancelRefundCopy.ts |     return giftCents >= costCents ? "gift_only" : "gift_and_card"; |     return "gift_only";
// @mutate src/lib/cancelRefundCopy.ts |     if (spent.payment_status != null && spent.payment_status !== "paid") return "unknown"; |     if (false) return "unknown";
// @mutate src/lib/cancelRefundCopy.ts |     if (costCents == null \|\| !Number.isFinite(costCents) | if (false
// @mutate src/components/job-card/ActivityDialogs.tsx |           jobUrgentFee={props.cancelDialogJob.urgent_fee} |           jobUrgentFee={0}
// Re-review of 1a2787c30: #1 a late fee the card share cannot cover is not
// "out of your card payment, the rest returns"; #4 a reserved gift whose
// donation was reversed is not back on the gift balance.
// @mutate src/lib/cancelRefundCopy.ts |       && Math.round(appliedFee * 100) + Math.max(0, args.keptSetupCents ?? 0) + 2 * stripeProcessingCostCents(cardShare) < cardShare; |       ;
// @mutate src/lib/cancelRefundCopy.ts |  + Math.max(0, args.keptSetupCents ?? 0) + 2 * | + 1 *
// @mutate src/lib/cancelRefundCopy.ts | const feeFitsInCard = cardShare != null && args.crew !== true | const feeFitsInCard = cardShare != null
// @mutate src/lib/cancelRefundCopy.ts |     return Math.max(0, costCents - giftCents); |     return costCents;
// @mutate src/lib/cancelRefundCopy.ts |     if (reserved.payment_status != null && reserved.payment_status !== "paid") return "unknown"; |     if (false) return "unknown";
// @mutate src/lib/cancelRefundCopy.ts |     return appliedFee > 0\n      ? neutral | return appliedFee < 0\n      ? neutral
// @mutate src/components/job-card/ActivityDialogs.tsx | &&\n            props.cancelDialogJob.payment_status !== "failed" | && true
// @mutate src/components/CancellationDialog.tsx |         cancelRefundToast({ wasFunded, appliedFee, flatModel, keptFeeSentence, gift, cardShareCents, keptSetupCents: Math.round(keptFee * 100), crew: !!crew }), |         cancelRefundToast({ wasFunded, appliedFee, flatModel, keptFeeSentence, cardShareCents, keptSetupCents: Math.round(keptFee * 100), crew: !!crew }),
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cancelRefundToast, cardShareCentsFromRead, giftOnJobFromRead } from "./cancelRefundCopy";
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

  const neutral = "Job cancelled. Anything that comes back to you is returned within the hour, to the card or gift balance it came from.";

  it("a gift that paid the whole job: back to the gift balance, and no card was charged", () => {
    for (const flatModel of [true, false]) {
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 0, flatModel, keptFeeSentence: "", gift: "gift_only" }))
        .toBe("Job cancelled. Your gift goes back to your gift balance within the hour. No card was charged.");
      // Q1806 (on main): the late fee is paid from the gift, the rest restored.
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: "", gift: "gift_only" }))
        .toBe("Job cancelled. The $25 cancellation fee is paid from your gift; the rest goes back to your gift balance within the hour. No card was charged.");
    }
  });

  it("a gift and a card: the card returns less its kept fee (and any late fee), the gift goes back to the gift balance", () => {
    for (const flatModel of [true, false]) {
      const keeps = flatModel ? "the card-processing fee Stripe keeps" : "the service fee you paid at checkout";
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 0, flatModel, keptFeeSentence: "", gift: "gift_and_card" }))
        .toBe(`Job cancelled. Your card payment returns to your card, less ${keeps}, and your gift goes back to your gift balance within the hour.`);
      // A $60 card share covers the $25 fee and twice Stripe's 2.9% + 30c on it (2 x 204c).
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: kept, gift: "gift_and_card", cardShareCents: 6000 }))
        .toBe(`Job cancelled. The $25 cancellation fee comes out of your card payment; the rest of it returns to your card, less ${keeps}, and your gift goes back to your gift balance within the hour.${kept}`);
      // Re-review #1: an $80 gift on a $100 job with a $50 fee: the $20 card
      // share cannot hold it (Q1806's open half), so nothing is promised.
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 50, flatModel, keptFeeSentence: "", gift: "gift_and_card", cardShareCents: 2000 })).toBe(neutral);
      // At the edge: 2500 + 2 x stripe(2700) = 2716 >= 2700 is neutral; 2500 + 2 x stripe(2800) = 2722 < 2800 fits.
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: "", gift: "gift_and_card", cardShareCents: 2700 })).toBe(neutral);
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: "", gift: "gift_and_card", cardShareCents: 2800 })).toMatch(/comes out of your card payment/);
      // The kept $2 setup fee counts (2800 fits alone, not with 200c more kept), and a crew's block fees are not known: neutral.
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: "", gift: "gift_and_card", cardShareCents: 2800, keptSetupCents: 200 })).toBe(neutral);
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: "", gift: "gift_and_card", cardShareCents: 6000, crew: true })).toBe(neutral);
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: "", gift: "gift_and_card" })).toBe(neutral);
      // The split is not known: a fee's source cannot be named.
      const unsure = cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel, keptFeeSentence: "", gift: "redeemed" });
      expect(unsure).toBe(neutral);
      expect(cancelRefundToast({ wasFunded: true, appliedFee: 0, flatModel, keptFeeSentence: "", gift: "redeemed" }))
        .toBe(`Job cancelled — your gift goes back to your gift balance within the hour, and any card payment returns to your card, less ${keeps}.`);
    }
  });

  it("a reserved gift comes back whatever the card did; funded AND reserved is neutral (review #1)", () => {
    expect(cancelRefundToast({ wasFunded: false, appliedFee: 0, flatModel: true, keptFeeSentence: "", gift: "reserved" }))
      .toBe("Job cancelled. Your checkout was never completed, so your card was never charged, and the gift you set aside goes back to your gift balance within the hour.");
    const both = cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel: true, keptFeeSentence: "", gift: "reserved" });
    expect(both).toBe(neutral);
    expect(both).not.toMatch(/less the card-processing fee/);
  });

  it("the read failed or the donation was reversed: neutral, never the card copy, and no promised note (review #5)", () => {
    const t = cancelRefundToast({ wasFunded: true, appliedFee: 25, flatModel: true, keptFeeSentence: "", gift: "unknown" });
    expect(t).toBe(neutral);
    expect(t).not.toMatch(/We'll send/);
  });

  it("the gift read: error -> unknown; a spent gift worth the cost -> gift_only, less -> gift_and_card; reversed donation -> unknown", () => {
    expect(giftOnJobFromRead(null, { code: "57014" }, 10000)).toBe("unknown");
    expect(giftOnJobFromRead([], null, 10000)).toBe("none");
    expect(giftOnJobFromRead([{ status: "reserved", amount: 40, payment_status: "paid" }], null, 10000)).toBe("reserved");
    // The job's cost is budget + urgent fee (redeem_gift_card's v_cost_cents).
    expect(giftOnJobFromRead([{ status: "redeemed", amount: 100, payment_status: "paid" }], null, 10000)).toBe("gift_only");
    expect(giftOnJobFromRead([{ status: "redeemed", amount: "150.00", payment_status: "paid" }], null, 10000)).toBe("gift_only");
    expect(giftOnJobFromRead([{ status: "redeemed", amount: 99.99, payment_status: "paid" }], null, 10000)).toBe("gift_and_card");
    expect(giftOnJobFromRead([{ status: "reserved" }, { status: "redeemed", amount: 40, payment_status: "paid" }], null, 10000)).toBe("gift_and_card");
    // Cost not known: a spent gift is just "redeemed".
    expect(giftOnJobFromRead([{ status: "redeemed", amount: 100, payment_status: "paid" }], null, null)).toBe("redeemed");
    expect(giftOnJobFromRead([{ status: "redeemed", amount: 100, payment_status: "paid" }], null)).toBe("redeemed");
    // revoke_gift_card_for_refund stamped the spent row: the restored gift cannot be spent.
    expect(giftOnJobFromRead([{ status: "redeemed", amount: 100, payment_status: "refunded" }], null, 10000)).toBe("unknown");
    // A reserved gift whose donation was reversed is not spendable either (re-review nit 4).
    expect(giftOnJobFromRead([{ status: "reserved", amount: 40, payment_status: "refunded" }], null, 10000)).toBe("unknown");
    // The card's part of the cost.
    expect(cardShareCentsFromRead([{ status: "redeemed", amount: 80, payment_status: "paid" }], 10000)).toBe(2000);
    expect(cardShareCentsFromRead([{ status: "redeemed", amount: 150, payment_status: "paid" }], 10000)).toBe(0);
    expect(cardShareCentsFromRead([{ status: "reserved", amount: 80 }], 10000)).toBeNull();
    expect(cardShareCentsFromRead([{ status: "redeemed", amount: 80 }], null)).toBeNull();
  });

  it("CancellationDialog passes the job's own fee model and gift to it", () => {
    const src = blankComments(readFileSync("src/components/CancellationDialog.tsx", "utf8"));
    expect(src).toMatch(/cancelRefundToast\(\{ wasFunded, appliedFee, flatModel, keptFeeSentence, gift, cardShareCents, keptSetupCents: Math\.round\(keptFee \* 100\), crew: !!crew \}\)/);
    expect(src).toMatch(/cardShareCents = cardShareCentsFromRead\(giftRows, costCents\);/);
    expect(src).toMatch(/gift = giftOnJobFromRead\(giftRows, giftErr, costCents\);/);
    expect(src).toMatch(/const flatModel = isFlatFeeJob\(feeStamp\);/);
    // The Activity caller hands it the cost and counts a declined card as unfunded (review #1, #2).
    const caller = blankComments(readFileSync("src/components/job-card/ActivityDialogs.tsx", "utf8"));
    expect(caller).toMatch(/jobUrgentFee=\{props\.cancelDialogJob\.urgent_fee\}/);
    expect(caller).toMatch(/props\.cancelDialogJob\.payment_status !== "failed"/);
    // No second, hand-written copy of the refund sentence left in the dialog.
    expect(src).not.toMatch(/returns to your card/);
  });
});
