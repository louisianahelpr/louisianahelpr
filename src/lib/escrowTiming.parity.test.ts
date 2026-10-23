import { describe, it, expect } from "vitest";
// The edge config lives in the Deno functions tree but is plain TS (no Deno
// imports at module scope), so vitest imports it directly — same pattern as
// helperFees.parity.test.ts / productPrices.parity.test.ts.
//
// WHAT THIS FILE PROVES, AND WHAT IT DOES NOT. It pins the CONSTANTS and the
// two pure functions of `_shared/escrowTiming.ts`: the poster's approval window,
// the payout sent 3 days after the APPROVAL (owner 2026-10-23), the day label in
// Louisiana time. It reads NOTHING outside that file. The other sides are
// guarded by files that read the real source:
//   - the cron's own arithmetic  → src/lib/r18Guards.parity.test.ts
//   - every writer of payout_scheduled_at → src/test/standardPayoutThreeDays.test.ts
//   - every user-facing copy site → src/lib/escrowTiming.copyParity.test.ts
import {
  APPROVAL_WINDOW_HOURS,
  STANDARD_PAYOUT_DAYS_AFTER_APPROVAL,
  STANDARD_PAYOUT_HOURS_AFTER_APPROVAL,
  STANDARD_PAYOUT_PHRASE,
  hoursToMs,
  payoutDayLabel,
  standardPayoutAtIso,
} from "../../supabase/functions/_shared/escrowTiming";

const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("escrow timing — config source of truth (owner 2026-10-23)", () => {
  it("the poster has 24 hours to approve before Helpr support steps in", () => {
    expect(APPROVAL_WINDOW_HOURS).toBe(24);
    expect(hoursToMs(APPROVAL_WINDOW_HOURS)).toBe(24 * 60 * 60 * 1000);
  });

  it("the payout is sent 3 days after the APPROVAL", () => {
    expect(STANDARD_PAYOUT_DAYS_AFTER_APPROVAL).toBe(3);
    expect(STANDARD_PAYOUT_HOURS_AFTER_APPROVAL).toBe(72);
    expect(STANDARD_PAYOUT_PHRASE).toBe("3 days after the job is approved");
    const now = Date.parse("2026-10-22T17:50:35Z");
    // Approved now (the approval IS this write): 72 hours from now.
    expect(standardPayoutAtIso(null, now)).toBe(iso(now + 72 * H));
    // Approved 10 hours ago: 62 hours from now.
    expect(standardPayoutAtIso(iso(now - 10 * H), now)).toBe(iso(now + 62 * H));
    // Never in the past, never anchored on a future or unreadable stamp.
    expect(standardPayoutAtIso(iso(now - 100 * H), now)).toBe(iso(now));
    expect(standardPayoutAtIso(iso(now + 5 * H), now)).toBe(iso(now + 72 * H));
    expect(standardPayoutAtIso("not a date", now)).toBe(iso(now + 72 * H));
  });

  // The 7c6deb77 job: approved Thu Oct 22 12:50 CT -> "$94 will be sent Sun, Oct 25".
  // @mutate supabase/functions/_shared/escrowTiming.ts |     timeZone: "America/Chicago", |     timeZone: "UTC",
  it("names the day in Louisiana time, and never prints Invalid Date", () => {
    expect(payoutDayLabel(standardPayoutAtIso(null, Date.parse("2026-10-22T17:50:35Z")))).toBe("Sun, Oct 25");
    // 03:00 UTC on the 25th is still the evening of the 24th in Louisiana.
    expect(payoutDayLabel("2026-10-25T03:00:00Z")).toBe("Sat, Oct 24");
    expect(payoutDayLabel(null)).toBeNull();
    expect(payoutDayLabel(undefined)).toBeNull();
    expect(payoutDayLabel("garbage")).toBeNull();
  });
});

// Proof this guard can fail (scripts/vacuity): the window reverting to the pre-2026-08-24 48h, and the
// payout clock reverting to a different length.
// @mutate supabase/functions/_shared/escrowTiming.ts | export const APPROVAL_WINDOW_HOURS = 24; | export const APPROVAL_WINDOW_HOURS = 48;
// @mutate supabase/functions/_shared/escrowTiming.ts | export const STANDARD_PAYOUT_DAYS_AFTER_APPROVAL = 3; | export const STANDARD_PAYOUT_DAYS_AFTER_APPROVAL = 2;
