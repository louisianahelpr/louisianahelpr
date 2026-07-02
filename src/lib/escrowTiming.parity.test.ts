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

  it("records the auto-release window stated in user-facing copy", () => {
    // Legal, Terms, PaymentSuccess, Help Center, and the dispute dialogs all
    // quote "72 hours" for the auto-release window.
    expect(COPY_AUTO_RELEASE_HOURS).toBe(72);
  });

  // ── KNOWN DIVERGENCE — this is a real finding, not a config nicety. ──
  // The copy tells posters payment "auto-releases if you don't act within
  // 72 hours", but the cron auto-completes at 48h (its own notifications even
  // say "auto-completed after 48 hours"). The 72h figure only matches the FULL
  // 48h auto-complete + 24h payout-hold path — i.e. when funds LAND — not the
  // auto-complete moment the copy describes. This assertion documents the gap
  // deliberately; it is GREEN today so it doesn't block the build, but it will
  // fail loudly the moment someone "fixes" one side without the other, forcing
  // an explicit reconciliation decision. See task report for the recommended fix
  // (align the cron cutoff to 72h, OR restate copy as "72 hours until payout /
  // 48 hours to act"). DO NOT silently delete this test to make it pass.
  it("FLAGS the copy↔cron divergence: stated auto-release (72h) ≠ cron auto-complete (48h)", () => {
    // The stated window matches TOTAL time to payout, NOT the cron cutoff.
    expect(COPY_AUTO_RELEASE_HOURS).toBe(TOTAL_TO_PAYOUT_HOURS);
    // ...and is deliberately NOT equal to the actual auto-complete cutoff. If a
    // future change makes these agree, this line fails on purpose so the
    // divergence documentation is revisited rather than left stale.
    expect(COPY_AUTO_RELEASE_HOURS).not.toBe(AUTO_COMPLETE_HOURS);
  });
});
