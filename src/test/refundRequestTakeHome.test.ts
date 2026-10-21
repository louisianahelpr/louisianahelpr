/**
 * Board 141 (Q2272): "Agree · refund $20 — You take home the rest: $X" is a
 * number the Helpr decides on, so it must be what the money path will pay
 * (spec v2 truth rule). The preview (src/lib/refundRequests refundTakeHomeDollars)
 * runs through the take-home function every Helpr earnings screen uses; the
 * payout is execute-dispute-split's arithmetic on the agreed shares:
 *   helper share = 1 - round(asked / price, 8)            (the migration's rounding)
 *   helper cents = roundPayoutDownCents(price x share + urgent x share
 *                  - jobHelprCommissionDollars(job, price x share, pct, urgent x share))
 * This sweeps prices, asks, tier rates and the flat-fee model and requires the
 * two to agree to the cent, both directions.
 *
 * @mutate src/lib/refundRequests/index.ts |     urgent_fee: (job.urgent_fee ?? 0) * helperShare, |     urgent_fee: job.urgent_fee ?? 0,
 * @mutate src/lib/refundRequests/index.ts |     budget: (r.budget_cents - r.amount_cents) / 100, |     budget: r.budget_cents / 100,
 */
import { describe, it, expect } from "vitest";
import { refundTakeHomeDollars, refundDollars } from "@/lib/refundRequests";
import { jobHelprCommissionDollars } from "../../supabase/functions/_shared/helperFees";
import { roundPayoutDownCents } from "../../supabase/functions/_shared/money";
import { netUrgentFeeDollars } from "../../supabase/functions/_shared/stripeFees";

function splitHelperCents(job: { helper_fee_flat_cents?: number | null; helper_fee_percent?: number | null; urgent_fee?: number | null }, budgetCents: number, askedCents: number, pct: number): number {
  const posterShare = Math.round((askedCents / budgetCents) * 1e8) / 1e8;
  const helperShare = 1 - posterShare;
  const budgetShare = (budgetCents / 100) * helperShare;
  const urgentShare = netUrgentFeeDollars(job.urgent_fee) * helperShare;
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

  it("all of it leaves the Helpr nothing", () => {
    expect(refundTakeHomeDollars({ id: "j", status: "in_progress", budget: 40 }, { amount_cents: 4000, budget_cents: 4000 }, 12)).toBe(0);
  });

  it("dollars read like the server's notification", () => {
    expect(refundDollars(2000)).toBe("$20");
    expect(refundDollars(2050)).toBe("$20.50");
  });
});
