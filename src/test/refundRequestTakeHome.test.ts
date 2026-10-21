/**
 * Board 141 (Q2272): "Agree · refund $20 — You take home the rest: $X" is a
 * number the Helpr decides on, so it must be what the money path will pay
 * (spec v2 truth rule). The preview (src/lib/refundRequests refundTakeHomeDollars)
 * runs through the take-home function every Helpr earnings screen uses; the
 * payout is execute-dispute-split's EXACT agreed path (Q2298, owner
 * 2026-10-21: an agreed part refund returns exactly the amount asked):
 *   rush back    = agreedRushRefundCents(rush, asked, price): the same share of the
 *                  rush (urgent) fee as of the price (owner 2026-10-21, no cliff)
 *   refund       = the amount asked + rush back, to the cent
 *   helper cents = roundPayoutDownCents(price - asked + (rush - rush back)
 *                  - jobHelprCommissionDollars(job, price - asked, pct, rush - rush back))
 * This sweeps prices, asks, tier rates and the flat-fee model and requires the
 * two to agree to the cent, both directions, and pins the owner's example:
 * asking $20 of a $40 job that also paid a $10 rush fee refunds $25.
 *
 * @mutate src/lib/refundRequests/index.ts |     urgent_fee: part ? (rushCentsOf(job) - refundRushBackCents(job, r)) / 100 : 0, |     urgent_fee: part ? rushCentsOf(job) / 100 : 0,
 * @mutate supabase/functions/_shared/refundRush.ts |   return Math.floor((2 * rush * asked + price) / (2 * price)); |   return Math.round((rush * asked) / price) + 1;
 * @mutate src/lib/refundRequests/index.ts |     budget: Math.max(0, r.budget_cents - r.amount_cents) / 100, |     budget: r.budget_cents / 100,
 * @mutate supabase/functions/execute-dispute-split/index.ts |     ? (rushCents - rushBackCents) / 100 |     ? rushCents / 100
 * @mutate supabase/functions/execute-dispute-split/index.ts |     ? agreement.amountCents + rushBackCents\n |     ? Math.max(0, Math.round(refundableCents * posterShare))\n
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { refundTakeHomeDollars, refundDollars, refundPartTotalCents, refundRushBackCents } from "@/lib/refundRequests";
import { agreedRushRefundCents } from "../../supabase/functions/_shared/refundRush";
import { blankComments } from "./helpers/blankNonCode";
import { jobHelprCommissionDollars } from "../../supabase/functions/_shared/helperFees";
import { roundPayoutDownCents } from "../../supabase/functions/_shared/money";
import { netUrgentFeeDollars } from "../../supabase/functions/_shared/stripeFees";

/** execute-dispute-split's exact agreed path, transcribed. */
function splitHelperCents(job: { helper_fee_flat_cents?: number | null; helper_fee_percent?: number | null; urgent_fee?: number | null }, budgetCents: number, askedCents: number, pct: number): number {
  const budgetShare = (budgetCents - askedCents) / 100;
  const rushCents = Math.round(netUrgentFeeDollars(job.urgent_fee) * 100);
  const urgentShare = (rushCents - agreedRushRefundCents(rushCents, askedCents, budgetCents)) / 100;
  const fee = jobHelprCommissionDollars(job, budgetShare, pct, urgentShare);
  return roundPayoutDownCents(Math.max(0, Math.round((budgetShare + urgentShare - fee) * 100)));
}

describe("the Helpr's take-home preview is what the agreed split pays", () => {
  const cases: Array<{ name: string; job: { helper_fee_flat_cents?: number | null; helper_fee_percent?: number | null; urgent_fee?: number | null } }> = [
    { name: "tier model, no bonus", job: { helper_fee_flat_cents: null, urgent_fee: 0 } },
    { name: "tier model, urgent bonus", job: { helper_fee_flat_cents: null, urgent_fee: 15 } },
    { name: "flat 5% + 70c model", job: { helper_fee_flat_cents: 70, helper_fee_percent: 5, urgent_fee: 0 } },
    { name: "flat model, urgent bonus", job: { helper_fee_flat_cents: 70, helper_fee_percent: 5, urgent_fee: 10 } },
  ];
  let compared = 0;
  for (const c of cases) {
    it(c.name, () => {
      const bad: string[] = [];
      for (const budget of [25, 40, 75, 120, 333, 1000]) {
        const budgetCents = budget * 100;
        for (const asked of [100, 500, 1999, Math.round(budgetCents / 2), budgetCents - 100]) {
          if (asked >= budgetCents) continue;
          for (const pct of [8, 10, 12]) {
            const job = { id: "j", status: "in_progress", budget, ...c.job };
            const preview = Math.round(refundTakeHomeDollars(job, { amount_cents: asked, budget_cents: budgetCents }, pct) * 100);
            const paid = splitHelperCents(c.job, budgetCents, asked, pct);
            compared++;
            if (preview !== paid) bad.push(`$${budget} ask ${asked}c @${pct}%: preview ${preview}c, split ${paid}c`);
          }
        }
      }
      expect(bad).toEqual([]);
    });
  }
  it("compared a real sweep (inventory floor)", () => {
    expect(compared).toBeGreaterThan(200);
  });

  it("the owner's example (Q2298 + rush ruling 2026-10-21): $20 asked of a $40 job with a $10 rush fee refunds $25; the Helpr keeps $20 of the price and $5 of the rush fee, less their fee", () => {
    // Tier model at 12%: the commission is on the price only (helperCommissionDollars), so
    // $20 + $5 - $2.40 = $22.60, paid as $22 (whole dollars, rounded down; Q236).
    const job = { id: "j", status: "in_progress", budget: 40, urgent_fee: 10, helper_fee_flat_cents: null };
    const r = { amount_cents: 2000, budget_cents: 4000 };
    expect(refundRushBackCents(job, r)).toBe(500);
    expect(refundPartTotalCents(job, r)).toBe(2500);
    expect(refundTakeHomeDollars(job, r, 12)).toBe(22);
    expect(splitHelperCents(job, 4000, 2000, 12)).toBe(2200);
    // Not the old whole-rush-fee rule ($20 + $10 - $2.40 = $27.60, paid $27).
    expect(refundTakeHomeDollars(job, r, 12)).not.toBe(27);
  });

  it("the rush share is rush x asked / price, half up to the cent, in integers (no cliff, never more than the rush fee)", () => {
    expect(agreedRushRefundCents(1000, 2000, 4000)).toBe(500);
    expect(agreedRushRefundCents(1000, 1, 3)).toBe(333); // 333.33 -> 333
    expect(agreedRushRefundCents(1000, 2, 3)).toBe(667); // 666.67 -> 667
    expect(agreedRushRefundCents(5, 1, 2)).toBe(3); // 2.5 -> 3, half up
    expect(agreedRushRefundCents(1000, 4000, 4000)).toBe(1000);
    expect(agreedRushRefundCents(0, 2000, 4000)).toBe(0);
    expect(agreedRushRefundCents(1000, 0, 4000)).toBe(0);
    // Monotone in the amount asked: a cent more asked never returns less rush fee.
    let prev = -1;
    for (let asked = 0; asked <= 4000; asked += 7) {
      const v = agreedRushRefundCents(1500, asked, 4000);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1500);
      prev = v;
    }
  });

  it("all of it leaves the Helpr nothing, rush fee included", () => {
    expect(refundTakeHomeDollars({ id: "j", status: "in_progress", budget: 40 }, { amount_cents: 4000, budget_cents: 4000 }, 12)).toBe(0);
    expect(refundTakeHomeDollars({ id: "j", status: "in_progress", budget: 40, urgent_fee: 10 }, { amount_cents: 4000, budget_cents: 4000 }, 12)).toBe(0);
  });

  it("dollars read like the server's notification", () => {
    expect(refundDollars(2000)).toBe("$20");
    expect(refundDollars(2050)).toBe("$20.50");
  });
});

describe("the split refunds EXACTLY the agreed part (Q2298)", () => {
  const src = blankComments(readFileSync(join(resolve(__dirname, "../.."), "supabase/functions/execute-dispute-split/index.ts"), "utf8")).replace(/\s+/g, " ");
  it("an agreed part is the amount itself; an agreed all keeps the full-refund rule", () => {
    expect(src).toContain("const exactAgreed = agreement !== null && agreement.amountCents < agreement.budgetCents;");
    expect(src).toContain("const refundCents = exactAgreed && agreement !== null ? agreement.amountCents + rushBackCents : Math.max(0, Math.round(refundableCents * posterShare));");
    expect(src).toContain("? (agreement.budgetCents - agreement.amountCents) / 100 : perHelperBudget * helperShare;");
    // Owner 2026-10-21: on an exact agreed part the rush fee comes back in the same share as the price.
    expect(src).toContain("const rushBackCents = exactAgreed && agreement !== null ? agreedRushRefundCents(rushCents, agreement.amountCents, agreement.budgetCents) : 0;");
    expect(src).toContain("const helperUrgentShareDollars = exactAgreed ? (rushCents - rushBackCents) / 100 : netUrgentFeeDollars(job.urgent_fee) * helperShare;");
  });
  it("fails closed: another price, more than the charge returns, or a gift-funded job moves nothing", () => {
    expect(src).toContain("if (exactAgreed && agreement !== null && agreement.budgetCents !== Math.round(perHelperBudget * 100)) {");
    expect(src).toContain("if (exactAgreed && giftAppliedCents > 0) {");
    expect(src).toContain("if (exactAgreed && refundCents > refundableCents) {");
    expect(src).toContain("const giftShareBps = exactAgreed ? 0 :");
  });
});
