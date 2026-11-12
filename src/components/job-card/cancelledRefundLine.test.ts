/**
 * The poster's cancelled line says their money came back, only when it did
 * (owner, 2026-10-06).
 *
 * F105 (owner UI audit 2026-11-09, data): the card said "Your payment was refunded" while Receipts showed a kept
 * charge on the same job (53c98775 "Pick up packages/ deliver to UPS": $28.83 refunded, $1.17 kept, read on prod).
 * The card now says the Receipts numbers when it has them, and never a bare "Your payment was refunded".
 *
 * @mutate src/components/job-card/jobStatusLine.ts |   if (job.payment_status !== "refunded") return reason; |   if (false) return reason;
 * @mutate src/components/job-card/jobStatusLine.ts |     suffix: id === "cancelled" ? cancelledSuffix(job, progress?.refund) : null, |     suffix: id === "cancelled" ? sanitizeCancellationReason(job.cancellation_reason) : null,
 * @mutate src/components/job-card/jobStatusLine.ts |   const words = refundedWords(refund, Number(job.cancellation_fee ?? 0) > 0); |   const words = "Your payment was refunded";
 * @mutate src/lib/refundWords.ts |   return refund.keptCents > 0 && !lateFeeKept ? `${back} · ${CARD_COST_NOT_REFUNDED}` : back; |   return back;
 * @mutate src/components/tracker/jobProgressState.ts |   const refund = refunded ? (back ?? (kept ? t("jl.cx.rest") : t("jl.cx.refundSent"))) : null; |   const refund = refunded ? (back ?? (kept ? t("jl.cx.rest") : "Your payment was refunded")) : null;
 *
 * Money review (F105): the kept charge is called the card processing cost ONLY when nothing else could be in it: not
 * with a kept setup fee, a cancellation fee (poster late cancel or seller fault), or a crew block fee.
 * @mutate src/lib/refundWords.ts |   if (Number(job.onboarding_fee_amount ?? 0) > 0 \|\| Number(job.cancellation_fee ?? 0) > 0) return 0; |
 * @mutate src/lib/refundWords.ts |   if (!job \|\| hasBlockFee) return 0; |   if (!job) return 0;
 * @mutate src/components/tracker/jobProgressState.ts | !kept && !(fee > 0) && (refundKeptCents | !kept && (refundKeptCents
 */
import { describe, expect, it } from "vitest";
import { cancelledSuffix, posterStatusLine } from "./jobStatusLine";
import type { Job } from "./activityConstants";
import { CARD_COST_NOT_REFUNDED, REFUND_SENT, cardCostKeptCents, refundedWords } from "@/lib/refundWords";
import { jobProgress } from "@/components/tracker/jobProgressState";

// A real cancellation: an expired listing reads "Expired" with no reason (src/test/expiredIsNotCancelled.test.tsx).
const base = { status: "cancelled", cancellation_reason: "Plans changed" } as unknown as Job;
// The prod case (53c98775): $30.00 charged, $28.83 refunded, $1.17 card processing cost kept.
const PART = { refundedCents: 2883, keptCents: 117 };
const WHOLE = { refundedCents: 3000, keptCents: 0 };

describe("cancelled line and refunds", () => {
  it("adds the refund only for a refunded job; without the numbers it says a refund was sent, never that it was whole", () => {
    expect(cancelledSuffix({ ...base, payment_status: "refunded" } as Job)).toBe(`Plans changed · ${REFUND_SENT}`);
    expect(cancelledSuffix({ ...base, payment_status: "unpaid" } as Job)).not.toMatch(/refund/i);
    expect(cancelledSuffix({ ...base, payment_status: "refunded" } as Job)).not.toMatch(/Your payment was refunded/);
  });

  it("F105: with the Receipts numbers, a part refund says the amount and that the card cost isn't refunded", () => {
    expect(cancelledSuffix({ ...base, payment_status: "refunded" } as Job, PART)).toBe(`Plans changed · $28.83 refunded · ${CARD_COST_NOT_REFUNDED}`);
    expect(cancelledSuffix({ ...base, payment_status: "refunded" } as Job, WHOLE)).toBe("Plans changed · $30.00 refunded");
    // A late-cancel fee (its own words elsewhere) is not called a card cost.
    expect(cancelledSuffix({ ...base, payment_status: "refunded", cancellation_fee: 12 } as unknown as Job, PART)).toBe("Plans changed · $28.83 refunded");
    expect(refundedWords(null)).toBe(REFUND_SENT);
    expect(refundedWords({ refundedCents: 0, keptCents: 3000 })).toBe(REFUND_SENT);
  });

  it("the poster's status line carries it", () => {
    expect(posterStatusLine({ ...base, payment_status: "refunded" } as Job, 0).suffix).toBe(`Plans changed · ${REFUND_SENT}`);
    const line = posterStatusLine({ ...base, payment_status: "refunded" } as Job, 0, undefined, undefined, false, null, { refund: PART });
    expect(line.suffix).toBe(`Plans changed · $28.83 refunded · ${CARD_COST_NOT_REFUNDED}`);
  });

  it("F105: the job page's tracker line says the same numbers", () => {
    const job = { id: "j1", status: "cancelled", payment_status: "refunded", cancellation_reason: "Plans changed", customer_id: "p1", cancelled_by: "p1" };
    const line = (o: { refundedCents?: number | null; refundKeptCents?: number | null }) =>
      jobProgress(job as never, { viewer: "poster", otherFirst: "Eli", ...o } as never).next;
    // A plain suffix check, not a RegExp built from the copy (CodeQL js/incomplete-sanitization on #4283).
    const partRefund = String(line({ refundedCents: 2883, refundKeptCents: 117 }));
    expect(partRefund.endsWith(`$28.83 was refunded · ${CARD_COST_NOT_REFUNDED}`), partRefund).toBe(true);
    expect(line({ refundedCents: 3000, refundKeptCents: 0 })).toMatch(/\$30 was refunded$/);
    expect(line({})).toMatch(new RegExp(`${REFUND_SENT}$`));
    expect(line({})).not.toMatch(/Your payment was refunded/);
  });

  it("money review: a kept setup fee, cancellation fee or crew block fee is never called the card cost", () => {
    expect(cardCostKeptCents({}, 117, false)).toBe(117);
    expect(cardCostKeptCents({ onboarding_fee_amount: 2 }, 317, false)).toBe(0);
    expect(cardCostKeptCents({ cancellation_fee: 30 }, 3117, false)).toBe(0);
    expect(cardCostKeptCents({}, 617, true)).toBe(0);
    expect(cardCostKeptCents(undefined, 117, false)).toBe(0);
    // The tracker agrees with the card: a Helpr-side (seller fault) cancel fee gets no card-cost sentence either.
    const job = { id: "j1", status: "cancelled", payment_status: "refunded", cancellation_reason: "Plans changed", customer_id: "p1", cancelled_by: "h1", helper_id: "h1", cancellation_fee: 20 };
    const next = jobProgress(job as never, { viewer: "poster", otherFirst: "Eli", refundedCents: 2883, refundKeptCents: 117 } as never).next;
    expect(next).toMatch(/\$28\.83 was refunded$/);
    expect(next).not.toContain(CARD_COST_NOT_REFUNDED);
  });
});
