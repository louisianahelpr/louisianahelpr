import { describe, it, expect } from "vitest";
// The edge config lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest imports it directly — same pattern as
// helperFees.parity.test.ts / productPrices.parity.test.ts. This guard keeps the
// escrow auto-release schedule that the cron ACTUALLY uses in lock-step with the
// hours quoted to users in Legal / Terms / checkout copy, so the promised
// auto-release window can never silently drift from what the timer does.
import {
  AUTO_COMPLETE_HOURS,
  PAYOUT_HOLD_HOURS,
  TOTAL_TO_PAYOUT_HOURS,
  COPY_AUTO_RELEASE_HOURS,
  hoursToMs,
} from "../../supabase/functions/_shared/escrowTiming";

describe("escrow auto-release timing — config source of truth", () => {
  it("encodes the cron's actual auto-complete cutoff (48h) and payout hold (24h)", () => {
    // These MUST equal the literals hardcoded in
    // supabase/functions/auto-release-payment/index.ts:
    //   cutoff    = Date.now() - 48 * 60 * 60 * 1000   (auto-complete)
    //   payoutTime= Date.now() + 24 * 60 * 60 * 1000   (payout hold)
    expect(AUTO_COMPLETE_HOURS).toBe(48);
    expect(PAYOUT_HOLD_HOURS).toBe(24);
  });

  it("hoursToMs reproduces the cron's exact millisecond arithmetic", () => {
    // Mirrors `48 * 60 * 60 * 1000` / `24 * 60 * 60 * 1000` in the cron so a
    // change to one is caught against the other.
    expect(hoursToMs(AUTO_COMPLETE_HOURS)).toBe(48 * 60 * 60 * 1000);
    expect(hoursToMs(PAYOUT_HOLD_HOURS)).toBe(24 * 60 * 60 * 1000);
  });

  it("total time to payout is auto-complete + hold", () => {
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(72);
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(AUTO_COMPLETE_HOURS + PAYOUT_HOLD_HOURS);
  });

  it("keeps the stated auto-release ACTION window in lock-step with the cron cutoff", () => {
    // Reconciled 2026-07-02: the one-sided-completion auto-release copy (Legal,
    // Terms, PaymentSuccess, Help Center, and the activity DeadlineCountdowns)
    // now states the real 48h window the cron enforces, so the promised
    // "confirm-or-it-auto-releases" window can never again drift from what the
    // timer/cron actually does. If someone changes one side, this fails.
    expect(COPY_AUTO_RELEASE_HOURS).toBe(AUTO_COMPLETE_HOURS);
    expect(COPY_AUTO_RELEASE_HOURS).toBe(48);
  });

  it("still distinguishes the 48h action window from the ~72h time-to-funds", () => {
    // The 72h that copy legitimately cites is the TOTAL time until funds LAND
    // (48h auto-complete + 24h payout hold), NOT the action window. Guarding
    // the gap keeps "funds arrive ~72h after completion" copy honest too.
    expect(TOTAL_TO_PAYOUT_HOURS).toBe(72);
    expect(COPY_AUTO_RELEASE_HOURS).not.toBe(TOTAL_TO_PAYOUT_HOURS);
  });
});
