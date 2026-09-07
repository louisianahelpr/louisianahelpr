import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { formatPrice, formatPriceExact, formatPriceFloor } from "./format";
import { posterServiceFeeCents } from "./posterFees";
import { helperTakeHomeDollars } from "./helperEarnings";

/**
 * THE BUG THESE PREVENT — external QA, real clicks against production,
 * 2026-09-06: three surfaces that state a real, moving sum of money rendered it
 * with `formatPrice`, which rounds to the nearest whole dollar. The post-a-job
 * CTA read "Review & Pay · $136" and then charged $136.40. `/payment-success`
 * said "$136 is held securely" about a $136.40 escrow. A helper's Schedule row
 * quoted a take-home 40c above the transfer.
 *
 * `formatPrice` is not the villain — it is correct for a GROSS BUDGET, a number
 * the poster typed against which no money is owed, and for the fixed $25-step
 * preset chips. The defect was three sites choosing it over the two formatters
 * that exist precisely for the other two cases. The house rule, in full:
 *
 *   CHARGED or HELD  → `formatPriceExact`. Must equal the Stripe amount to the
 *                      cent. Never higher, never lower — it is a receipt.
 *   OWED TO VIEWER   → `formatPriceFloor`. May read below the payout, never
 *                      above (owner, 2026-08-19).
 *   GROSS BUDGET     → `formatPrice`. Nobody is owed it; it rounds.
 *
 * Every assertion below is computed through the same authority that charges the
 * money (`posterServiceFeeCents`, `helperTakeHomeDollars`) rather than against a
 * transcribed constant, so the test cannot agree with a formatter that has
 * drifted away from the ledger.
 */

describe("a quoted charge equals the charge", () => {
  it("shows the cents the poster is actually billed", () => {
    // The live case QA hit. $120 budget, free tier (12%), no urgent bonus, no
    // first-post onboarding fee:
    //   budget            $120.00
    //   + service fee     $ 14.40   (12% of $120, floored at Stripe's cost)
    //   = total charge    $134.40
    const budgetCents = 12_000;
    const feeCents = posterServiceFeeCents(budgetCents, 12, 0);
    expect(feeCents).toBe(1_440); // the tier percent wins over the Stripe floor
    const totalCharge = (budgetCents + feeCents) / 100;
    expect(totalCharge).toBeCloseTo(134.4, 10);

    expect(formatPrice(totalCharge)).toBe("134"); // the shipped bug: 40c short
    expect(formatPriceExact(totalCharge)).toBe("134.40");
  });

  it("round-trips to the exact cents Stripe moves, across the whole fee ladder", () => {
    // The real guard: reconstruct cents FROM THE RENDERED STRING and require it
    // to equal what create-payment charges. A formatter that drops, pads or
    // rounds a cent fails here for some budget in this sweep.
    //
    // `driftedUnderOldFormatter` is the anti-vacuity latch. If someone reverts
    // the CTA to `formatPrice`, or "simplifies" this loop into one that both
    // formatters satisfy, the count goes to zero and the final expect fails —
    // so this test cannot quietly stop testing anything.
    let driftedUnderOldFormatter = 0;
    let casesChecked = 0;

    for (let budgetCents = 2_500; budgetCents <= 60_000; budgetCents += 137) {
      for (const feePercent of [12, 11, 10, 8]) {
        for (const urgentCents of [0, 500, 1_250]) {
          const feeCents = posterServiceFeeCents(budgetCents, feePercent, urgentCents);
          const chargedCents = budgetCents + feeCents + urgentCents;
          const totalCharge = chargedCents / 100;

          const shown = formatPriceExact(totalCharge).replace(/,/g, "");
          expect(Math.round(Number(shown) * 100)).toBe(chargedCents);

          const oldShown = formatPrice(totalCharge).replace(/,/g, "");
          if (Math.round(Number(oldShown) * 100) !== chargedCents) driftedUnderOldFormatter++;
          casesChecked++;
        }
      }
    }

    expect(casesChecked).toBeGreaterThan(1_000);
    // Rounding was the COMMON case, not an edge case: a percentage of a budget
    // lands on a whole dollar roughly one time in a hundred.
    expect(driftedUnderOldFormatter).toBeGreaterThan(casesChecked * 0.9);
  });
});

describe("an escrow balance is stated, not approximated", () => {
  it("never rounds a held sum in either direction", () => {
    // `/payment-success` asserts "$X is held securely" about money that really
    // is sitting in escrow. Rounding makes the sentence false both ways: down,
    // and it understates what the poster paid; up, and it claims money that is
    // not there.
    expect(formatPrice(136.4)).toBe("136"); // understated the poster's payment
    expect(formatPrice(136.6)).toBe("137"); // claimed 40c that is not in escrow
    expect(formatPriceExact(136.4)).toBe("136.40");
    expect(formatPriceExact(136.6)).toBe("136.60");
    // A whole-dollar escrow still reads clean — no gratuitous ".00".
    expect(formatPriceExact(136)).toBe("136");
  });
});

describe("a take-home never reads above the transfer", () => {
  it("floors the Schedule row the way every other take-home surface does", () => {
    // $120 job at the 12% free-tier rate pays $105.60. The Schedule tab was the
    // one helper-facing surface still rounding: it announced "$106" while My
    // Jobs, Work Record and the apply sheet all said "$105" for the same job.
    const job = {
      budget: 120,
      helper_fee_percent: 12,
      urgent_fee: 0,
      is_group_job: false,
      helpers_needed: 1,
    };
    const takeHome = helperTakeHomeDollars(job, 12);
    expect(takeHome).toBeCloseTo(105.6, 10);

    expect(formatPrice(takeHome)).toBe("106"); // the shipped bug: 40c overquoted
    expect(formatPriceFloor(takeHome)).toBe("105");
  });
});

describe("the three fixed sites do not drift back", () => {
  // A formatter choice is one identifier long and reads correct either way, so
  // the three sites above are pinned to their SOURCE. Derived from the files
  // themselves, not from a list this test also defines — a registry checked
  // against itself cannot fail for the member it is missing.
  const site = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("quotes the post-a-job CTA total exactly", () => {
    const src = site("../pages/postjob/FormStep.tsx");
    expect(src).toMatch(/formatPriceExact\(form\.totalCharge\)/);
    expect(src).not.toMatch(/formatPrice\(form\.totalCharge\)/);
  });

  it("states the payment-success escrow amount exactly", () => {
    const src = site("../pages/PaymentSuccess.tsx");
    expect(src).toMatch(/formatPriceExact\(escrowAmount\)/);
    expect(src).not.toMatch(/formatPrice\(escrowAmount\)/);
  });

  it("floors the Schedule row take-home and only the take-home", () => {
    const src = site("../components/profile/ScheduleTab.tsx");
    // The take-home branch floors...
    expect(src).toMatch(/formatPriceFloor\(helperTakeHomeDollars\(/);
    // ...and the gross budget branch is still allowed to round, because a
    // budget is a number the poster typed and nobody is owed it.
    expect(src).toMatch(/formatPrice\(job\.budget\)/);
    expect(src).not.toMatch(/formatPrice\(isPosted \?/);
  });
});
