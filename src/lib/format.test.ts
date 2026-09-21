import { describe, it, expect } from "vitest";
import { formatPrice, formatPriceFloor } from "./format";
import { helperTakeHomeDollars } from "./helperEarnings";

describe("formatPriceFloor — a payout may never read above the payout", () => {
  it("floors rather than rounding up", () => {
    // The live case: a $120 job at 12% pays $105.60. Rounding to nearest gives
    // "$106" and promises 40c that never lands.
    expect(formatPriceFloor(105.6)).toBe("105");
    expect(formatPriceFloor(83.6)).toBe("83");
    expect(formatPriceFloor(99.99)).toBe("99");
  });

  it("stays put at the boundaries where the three rounding modes disagree", () => {
    // The only values that tell round / ceil / floor apart:
    //   83.50 → round 84, ceil 84, floor 83   (the exact half)
    //   83.01 → round 83, ceil 84, floor 83   (a single cent over)
    // Without both, a switch from floor to round is invisible for a whole
    // class of take-homes, and a switch to ceil is invisible for all of them.
    expect(formatPriceFloor(83.5)).toBe("83");
    expect(formatPriceFloor(83.01)).toBe("83");
    expect(formatPriceFloor(83.999)).toBe("83");
  });

  it("leaves whole amounts alone", () => {
    expect(formatPriceFloor(132)).toBe("132");
    expect(formatPriceFloor(0)).toBe("0");
  });

  it("never reads higher than formatPriceExact", () => {
    for (const v of [105.6, 83.6, 123.2, 96.8, 74.8, 61.6, 39.6, 0.99]) {
      expect(Number(formatPriceFloor(v).replace(/,/g, ""))).toBeLessThanOrEqual(v);
    }
  });

  it("guards non-finite input like its siblings", () => {
    expect(formatPriceFloor(NaN)).toBe("0");
    expect(formatPriceFloor(Infinity)).toBe("0");
  });
});

describe("payout headlines floor the take-home they are given", () => {
  // The worked example behind the sweep that moved seven take-home headlines
  // (Profile identity card, Work Record, Wrapped, monthly goal, JobCard's
  // aria-label) from formatPrice to formatPriceFloor:
  //
  //   $120 budget · 12% platform fee · group job, 2 helprs · $10 urgent bonus
  //   per-helpr budget  $60.00
  //   − commission      $ 7.20   (12% of $60)
  //   + urgent share    $ 4.855  (($10 − 2.9%) ÷ 2)
  //   = take-home       $57.655
  //
  // formatPrice rounds that to "$58" — 34.5c the helpr never receives.
  const job = {
    budget: 120,
    helper_fee_percent: 12,
    urgent_fee: 10,
    is_group_job: true,
    helpers_needed: 2,
  };

  it("never announces more than the transfer", () => {
    const takeHome = helperTakeHomeDollars(job, 12);
    expect(takeHome).toBeCloseTo(57.655, 3);
    expect(formatPrice(takeHome)).toBe("58"); // the old behaviour: overstated
    expect(formatPriceFloor(takeHome)).toBe("57"); // never above the payout
  });
});

// A payout headline may read BELOW the money that lands and may never read
// above it (owner, 2026-08-19). `formatPriceExact`'s cents rounding is pinned
// separately, by displayedMoneyMatchesReality.test.ts; this is the floor.
// @mutate src/lib/format.ts | return Math.floor(amount).toLocaleString("en-US"); | return Math.round(amount).toLocaleString("en-US");
// Non-finite input must read "$0", not "$NaN" — the same guard formatPrice and
// formatPriceExact carry, on the one formatter that is quoting someone's pay.
// @mutate src/lib/format.ts | export function formatPriceFloor(amount: number): string {\n  if (!Number.isFinite(amount)) return "0"; | export function formatPriceFloor(amount: number): string {

