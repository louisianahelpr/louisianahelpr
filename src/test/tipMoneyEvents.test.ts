/**
 * Board 181: the deal room's money facts say only what was charged.
 * - a paid tip is a money pill naming who tipped ("Lexi tipped $13.50" / "You tipped");
 * - the payer (and only the payer) gets a receipt once the job is done and paid
 *   out: every line a stamped charge column or the tip charge function, Total =
 *   the sum, nothing for a refunded or unpaid job;
 * - customer_fee_amount is "Card processing" unless the job carries the poster fee.
 *
 * @mutate src/lib/jobSystemEvents.ts |   if (!job \|\| job.customer_id !== viewerId) return out; |   if (!job) return out;
 * @mutate src/lib/jobSystemEvents.ts |   if (!job.stripe_payment_intent_id \|\| job.disputed_at \|\| ctx.giftOrUnknown) return out; |   if (!job.stripe_payment_intent_id) return out;
 * @mutate src/lib/jobSystemEvents.ts |   if (job.status !== "completed" \|\| !["released", "payout_pending"].includes(job.payment_status ?? "")) return out; |   if (job.status !== "completed") return out;
 * @mutate src/lib/jobSystemEvents.ts |     if (q.feeCents > 0) lines.push({ label: "Tip card processing", cents: q.feeCents }); |     void q;
 */
import { describe, it, expect } from "vitest";
import { deriveMoneyEvents, type JobCharge, type PaidTip } from "@/lib/jobSystemEvents";
import { tipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";

const POSTER = "p", HELPR = "h", JOB = "j";
const job = (over: Partial<JobCharge> = {}): JobCharge => ({
  status: "completed", payment_status: "released", poster_completed_at: "2026-10-20T15:00:00Z", customer_id: POSTER,
  budget: 90, urgent_fee: null, customer_fee_amount: 3.6, sales_tax_amount: 10.13, onboarding_fee_amount: null,
  stripe_payment_intent_id: "pi_1", disputed_at: null, ...over,
});
const CARD = { giftOrUnknown: false };
const tip: PaidTip = { id: "t1", amount: 13.5, created_at: "2026-10-20T16:00:00Z", tipper_id: POSTER };

describe("board 181: tip pills and the payer's receipt", () => {
  it("the payer sees the tip pill and a receipt whose total is the sum of what was charged", () => {
    const ev = deriveMoneyEvents(job(), [tip], POSTER, "Andre", JOB, CARD);
    expect(ev.find((e) => e.kind === "tipped")?.label).toBe("You tipped $13.50");
    const r = ev.find((e) => e.kind === "receipt")!.receipt!;
    const fee = tipChargeBreakdown(1350).feeCents;
    expect(r.lines).toEqual([
      { label: "Job", cents: 9000 }, { label: "Card processing", cents: 360 }, { label: "Tax", cents: 1013 },
      { label: "Tip", cents: 1350 }, ...(fee > 0 ? [{ label: "Tip card processing", cents: fee }] : []),
    ]);
    expect(r.totalCents).toBe(9000 + 360 + 1013 + 1350 + fee);
  });

  it("the Helpr sees who tipped, and no receipt (it is the payer's)", () => {
    const ev = deriveMoneyEvents(job(), [tip], HELPR, "Lexi", JOB, CARD);
    expect(ev.map((e) => e.label)).toEqual(["Lexi tipped $13.50"]);
  });

  it("no receipt for a job that is not done and paid out", () => {
    for (const over of [{ payment_status: "refunded" }, { payment_status: "escrow" }, { status: "cancelled" }]) {
      expect(deriveMoneyEvents(job(over), [], POSTER, "Andre", JOB, CARD).some((e) => e.kind === "receipt")).toBe(false);
    }
  });

  it("a poster-fee job's fee line is the service fee, not card processing", () => {
    const r = deriveMoneyEvents(job({ poster_fee_flat_cents: 70 }), [], POSTER, "Andre", JOB, CARD).find((e) => e.kind === "receipt")!.receipt!;
    expect(r.lines.map((l) => l.label)).toContain("Service fee");
    expect(r.lines.map((l) => l.label)).not.toContain("Card processing");
    const legacy = deriveMoneyEvents(job({ platform_fee_percent: 12 }), [], POSTER, "Andre", JOB, CARD).find((e) => e.kind === "receipt")!.receipt!;
    expect(legacy.lines.map((l) => l.label)).toContain("Service fee");
  });

  it("no receipt when the charge may not be the price: a gift, a dispute, no card charge, or an unknown gift read", () => {
    const none = (over: Partial<JobCharge>, ctx = CARD) => !deriveMoneyEvents(job(over), [], POSTER, "Andre", JOB, ctx).some((e) => e.kind === "receipt");
    expect(none({}, { giftOrUnknown: true })).toBe(true);
    expect(none({ disputed_at: "2026-10-20T17:00:00Z" })).toBe(true);
    expect(none({ stripe_payment_intent_id: null })).toBe(true);
    expect(none({})).toBe(false);
  });
});
