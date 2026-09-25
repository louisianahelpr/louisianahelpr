import { describe, expect, it } from "vitest";

import {
  allocateAll,
  allocateCents,
  crewCancellationFee,
  crewCancellationFeeQuote,
  crewMemberFeeCents,
} from "../../supabase/functions/_shared/crewShares";

/**
 * A crew's budget is split to the CENT (money review MEDIUM-3, docs/OPEN.md
 * Q407). The old budget / helpers_needed in floating dollars paid $99.99 of a
 * $100 crew of 3; on 67% of budgets the N shares did not add up.
 *
 * allocateCents is the TypeScript twin of public.crew_slot_share_cents
 * (20260925154606), which the PGlite proof compares on 80 (total, N) pairs.
 * Here the property is exhaustive: every budget from $0.00 to $3,000.00, in
 * cents, across 1..8 members.
 */

// @mutate supabase/functions/_shared/crewShares.ts |   return Math.floor(t / k) + (slot < t % k ? 1 : 0); |   return Math.round(t / k);
// @mutate supabase/functions/_shared/crewShares.ts |   return Math.round((basisCents * pct) / 100); |   return Math.floor((basisCents * pct) / 100);

describe("crew shares split the budget exactly", () => {
  it("every budget $0.00–$3,000.00, N = 1..8: the shares add up to the budget and differ by at most a cent", () => {
    let pairs = 0;
    let bad = 0;
    for (let n = 1; n <= 8; n++) {
      for (let t = 0; t <= 300_000; t++) {
        let sum = 0;
        let lo = Number.POSITIVE_INFINITY;
        let hi = 0;
        for (let k = 0; k < n; k++) {
          const c = allocateCents(t, n, k);
          sum += c;
          if (c < lo) lo = c;
          if (c > hi) hi = c;
        }
        pairs++;
        if (sum !== t || hi - lo > 1) bad++;
      }
    }
    expect(pairs).toBeGreaterThan(2_000_000);
    expect(bad).toBe(0);
  });

  it("$100 across 3 is 3334 + 3333 + 3333, the extra cent to the lowest slot", () => {
    expect(allocateAll(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(allocateAll(0, 3)).toEqual([0, 0, 0]);
  });

  it("a member's late fee is round(share * ladder% / 100), and the fees of an even crew add up to the job's fee", () => {
    // $100 / 3 at 25%: 834 + 833 + 833 = 2500 (exactly 25% of the budget).
    expect(allocateAll(10_000, 3).map((c) => crewMemberFeeCents(c, true, 10))).toEqual([834, 833, 833]);
    expect(crewMemberFeeCents(3333, true, 48)).toBe(0); // 24h+ out
    expect(crewMemberFeeCents(3333, false, 1)).toBe(0); // not committed
  });

  it("the money path re-prices every ledger row to the cent and refuses bases over the budget", () => {
    const job = { budget: 100, date_needed: "2026-09-25", start_time: "10:00:00", cancelled_at: "2026-09-25T14:00:00Z" };
    const ok = crewCancellationFee(job, [
      { helper_id: "a", committed: true, share_basis_cents: 5000, share_amount: "25.00" },
      { helper_id: "b", committed: true, share_basis_cents: 5000, share_amount: "25.00" },
    ]);
    expect(ok).toEqual({ total: 50, mismatch: null });
    const off = crewCancellationFee(job, [{ helper_id: "a", committed: true, share_basis_cents: 5000, share_amount: "25.01" }]);
    expect(off.mismatch?.reason).toBe("share does not match its price");
    const over = crewCancellationFee(job, [
      { helper_id: "a", committed: true, share_basis_cents: 8000, share_amount: "40.00" },
      { helper_id: "b", committed: true, share_basis_cents: 8000, share_amount: "40.00" },
    ]);
    expect(over.mismatch?.reason).toBe("shares exceed the budget");
  });

  it("the poster's quote is the sum the server will charge", () => {
    const q = crewCancellationFeeQuote(
      [{ share_cents: 3334, confirmed: true }, { share_cents: 3333, confirmed: true }, { share_cents: 3333, confirmed: false }],
      100,
      3,
      10,
    );
    // The owner rule's default counts the unconfirmed member too.
    expect(q.total).toBe(25);
    expect(q.counted).toBe(3);
  });
});
