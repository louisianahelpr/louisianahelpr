import { describe, it, expect } from "vitest";
// The edge config lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest imports it directly — same pattern as
// helperFees.parity.test.ts / productPrices.parity.test.ts.
//
// WHAT THIS FILE ACTUALLY PROVES, AND WHAT IT DOES NOT. It pins the CONSTANTS:
// the two window lengths, their sum, and the fact that the window quoted to
// users is the auto-complete cutoff and not the ~48h time-to-funds. It reads
// NOTHING outside `_shared/escrowTiming.ts`, so on its own it cannot see the
// cron or the copy drifting away from these numbers. Its header used to claim
// otherwise, which is the same overclaim r18Guards.parity.test.ts already calls
// out about this file's earlier shape ("asserting AUTO_COMPLETE_HOURS === 48
// against a comment quoting the cron"). The other two sides are guarded, each
// by a file that reads the real source:
//   - the cron's own arithmetic  → src/lib/r18Guards.parity.test.ts
//     ("escrowTiming matches the arithmetic auto-release-payment actually runs")
//   - every user-facing copy site → src/lib/escrowTiming.copyParity.test.ts
// Break either of those two and THIS file stays green; that is by design, not
// coverage. Do not restate that claim here again without reading a file.
import {
  AUTO_COMPLETE_HOURS,
  PAYOUT_HOLD_HOURS,
  TOTAL_TO_PAYOUT_HOURS,
  COPY_AUTO_RELEASE_HOURS,
  STANDARD_PAYOUT_DAYS_AFTER_DONE,
  hoursToMs,
} from "../../supabase/functions/_shared/escrowTiming";

describe("escrow auto-release timing — config source of truth", () => {
  it("encodes the cron's auto-complete cutoff (24h) and the hold after it (48h since Q202)", () => {
    // auto-release-payment: cutoff = Date.now() - 24 * 60 * 60 * 1000, and the
    // payout is scheduled by standardPayoutAtIso(helper_completed_at): 3 days
    // after the job is marked done (owner, 2026-09-23), i.e. 48h after an
    // auto-complete. r18Guards.parity.test.ts reads the cron for both.
    expect(AUTO_COMPLETE_HOURS).toBe(24);
    expect(STANDARD_PAYOUT_DAYS_AFTER_DONE).toBe(3);
    expect(PAYOUT_HOLD_HOURS).toBe(48);
  });

  it("hoursToMs reproduces the cron's exact millisecond arithmetic", () => {
    // Mirrors `24 * 60 * 60 * 1000` in the cron's cutoff.
    expect(hoursToMs(AUTO_COMPLETE_HOURS)).toBe(24 * 60 * 60 * 1000);
    expect(hoursToMs(PAYOUT_HOLD_HOURS)).toBe(48 * 60 * 60 * 1000);
  });

  it("total time to payout is auto-complete + hold", () => {
    // 72 since 2026-09-23 (Q202, owner: standard pay 3 days after the job is
    // done): 24h auto-complete + 48h payout hold. Was 48 (24 + 24).
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(72);
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(STANDARD_PAYOUT_DAYS_AFTER_DONE * 24);
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(AUTO_COMPLETE_HOURS + PAYOUT_HOLD_HOURS);
  });

  it("keeps the stated auto-release ACTION window in lock-step with the cron cutoff", () => {
    // Reconciled 2026-07-02: the one-sided-completion auto-release copy (Legal,
    // Terms, PaymentSuccess, Help Center, and the activity DeadlineCountdowns)
    // now states the real 24h window the cron enforces, so the promised
    // "confirm-or-it-auto-releases" window can never again drift from what the
    // timer/cron actually does. If someone changes one side, this fails.
    expect(COPY_AUTO_RELEASE_HOURS).toBe(AUTO_COMPLETE_HOURS);
    expect(COPY_AUTO_RELEASE_HOURS).toBe(24);
  });

  it("still distinguishes the 24h action window from the 72h time-to-funds", () => {
    // The ~48h that copy legitimately cites is the TOTAL time until funds LAND
    // (24h auto-complete + 24h payout hold), NOT the action window. Guarding
    // the gap keeps "funds arrive ~48h after completion" copy honest too.
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(72);
    expect(COPY_AUTO_RELEASE_HOURS).not.toBe(TOTAL_TO_PAYOUT_HOURS);
  });
});

// Proof this guard can fail (scripts/vacuity). Two drifts it must catch inside
// the constants it owns: the cutoff itself reverting to the pre-2026-08-24 48h,
// and the window QUOTED to users silently becoming the ~48h time-to-funds
// instead of the 24h a poster actually has to confirm or dispute.
// @mutate supabase/functions/_shared/escrowTiming.ts | export const AUTO_COMPLETE_HOURS = 24; | export const AUTO_COMPLETE_HOURS = 48;
// @mutate supabase/functions/_shared/escrowTiming.ts | export const COPY_AUTO_RELEASE_HOURS = AUTO_COMPLETE_HOURS; | export const COPY_AUTO_RELEASE_HOURS = TOTAL_TO_PAYOUT_HOURS;
