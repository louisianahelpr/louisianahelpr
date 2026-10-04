import { describe, expect, it } from "vitest";
import { netAfterFirstPayoutFee, sumAfterFirstPayoutFee } from "@/lib/firstPayoutFee";
import { helperTakeHomeDollars, sumHelperTakeHomeDollars } from "@/lib/helperEarnings";
import { computeNet } from "@/components/dashboard/JobPrice";

/**
 * Q753 — one shared definition of "the one-time setup fee comes off the first
 * payout", used by every take-home surface. The cross-surface class guard is
 * src/test/firstPayoutFeeEverySurface.test.ts; this file pins the arithmetic.
 */
// @mutate src/lib/firstPayoutFee.ts | return Math.max(0, netDollars - firstPayoutFeeDollars); | return netDollars;

const job = { budget: 100, helper_fee_percent: 10 };

describe("netAfterFirstPayoutFee", () => {
  it("takes the fee off, passes through when none is due", () => {
    expect(netAfterFirstPayoutFee(90, 2)).toBe(88);
    expect(netAfterFirstPayoutFee(90, 0)).toBe(90);
    expect(netAfterFirstPayoutFee(90)).toBe(90);
  });

  it("never goes negative: a first payout at or below the fee previews as $0", () => {
    expect(netAfterFirstPayoutFee(2, 2)).toBe(0);
    expect(netAfterFirstPayoutFee(1.5, 2)).toBe(0);
  });
});

describe("sumAfterFirstPayoutFee", () => {
  it("subtracts the fee once, not per job", () => {
    expect(sumAfterFirstPayoutFee([90, 45, 30], 2)).toBe(163);
  });
  // @mutate src/lib/firstPayoutFee.ts |   return netAfterFirstPayoutFee(sum, firstPayoutFeeDollars); |   return takeHomes.reduce((a, n, i) => a + (i === 0 ? netAfterFirstPayoutFee(n, firstPayoutFeeDollars) : n), 0);
  it("takes the fee off the TOTAL, never clamped at one small row (Q753 review)", () => {
    expect(sumAfterFirstPayoutFee([1, 100], 2)).toBe(99);
  });
  it("is the plain sum when no fee is due", () => {
    expect(sumAfterFirstPayoutFee([90, 45, 30], 0)).toBe(165);
  });
});

describe("the surfaces' shared arithmetic", () => {
  it("helperTakeHomeDollars takes the fee off before flooring", () => {
    expect(helperTakeHomeDollars(job, 12)).toBe(90);
    expect(helperTakeHomeDollars(job, 12, 2)).toBe(88);
    // $83.60 − $2.50 = $81.10 → $81, not floor($83.60) − 2.50
    expect(helperTakeHomeDollars({ budget: 92.89, helper_fee_percent: 10 }, 12, 2.5)).toBe(81);
  });

  it("sumHelperTakeHomeDollars takes it off the list once", () => {
    expect(sumHelperTakeHomeDollars([job, job], 12)).toBe(180);
    expect(sumHelperTakeHomeDollars([job, job], 12, 2)).toBe(178);
  });

  it("computeNet (feed cards, detail chip) takes it off too, and clamps at $0", () => {
    expect(computeNet(100, 10, 0, 1).netEarnings).toBe(90);
    expect(computeNet(100, 10, 0, 1, 2).netEarnings).toBe(88);
    expect(computeNet(2, 10, 0, 1, 2).netEarnings).toBe(0);
  });
});

// @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   jobs.some(isAwaitingTransfer) ? firstPayoutFeeDollars : 0; |   firstPayoutFeeDollars;
describe("firstPayoutFeeDueFrom (Q753 review): the fee only while a payout is still to come", () => {
  it("is the fee when a job awaits its transfer, and 0 for settled-only rows", async () => {
    const { firstPayoutFeeDueFrom } = await import("@/components/profile/earningsTab/earningsTabHelpers");
    const pending = { status: "completed", payment_status: "payout_pending" } as never;
    const released = { status: "completed", payment_status: "released" } as never;
    expect(firstPayoutFeeDueFrom([released, pending], 2)).toBe(2);
    expect(firstPayoutFeeDueFrom([released], 2)).toBe(0);
    expect(firstPayoutFeeDueFrom([], 2)).toBe(0);
  });
});
