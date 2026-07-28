// helperEarnings is the single definition of "what did this helper take home",
// shared by /profile, /wrapped, /work-record, the Earnings tab, the activity
// trend, the earnings breakdown and the applied-job card. Every one of those
// surfaces used to carry its own hand-copied version and they drifted — a $75
// job read $75 on one screen and $66 on another. These tests pin the four
// behaviours that drift kept breaking:
//
//   1. fee precedence (stamped amount → frozen % → tier rate),
//   2. a stamped $0 fee is REAL (comped job) and must not be re-derived,
//   3. the urgent bonus is netted of its own bundled Stripe cost, and
//   4. a group job pays budget / helpers_needed, matching what the
//      `release-payout` edge function actually transfers.

import { describe, it, expect } from "vitest";
import {
  helperPlatformFeeDollars,
  helperShareCount,
  helperTakeHomeDollars,
  sumHelperTakeHomeDollars,
  type HelperEarningsJob,
} from "./helperEarnings";

// Stand-in for the caller's tier-derived rate. Deliberately different from any
// per-job percent used below so "the fallback leaked in" is always visible.
const TIER_FALLBACK_PCT = 20;

// $20 urgent fee nets $19.42 to the helper ($20 − its own bundled 2.9% Stripe
// cost). $30 nets $29.13.
const NET_URGENT_20 = 19.42;
const NET_URGENT_30 = 29.13;

describe("helperPlatformFeeDollars — fee precedence", () => {
  it("uses the stamped platform_fee_amount over the frozen % and the tier rate", () => {
    const job: HelperEarningsJob = {
      budget: 100,
      platform_fee_amount: 7.5,
      helper_fee_percent: 12,
    };
    expect(helperPlatformFeeDollars(job, TIER_FALLBACK_PCT)).toBe(7.5);
  });

  it("trusts a stamped $0 fee (comped job) instead of treating it as missing", () => {
    // The `|| 0` bug this guards against: a genuinely-stamped $0 read as
    // "unstamped" and silently re-derived a 12% commission that was never
    // charged, understating the helper by $12 on a $100 job.
    const job: HelperEarningsJob = {
      budget: 100,
      platform_fee_amount: 0,
      helper_fee_percent: 12,
    };
    expect(helperPlatformFeeDollars(job, TIER_FALLBACK_PCT)).toBe(0);
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(100);
  });

  it("falls back to the job's frozen helper_fee_percent when unstamped", () => {
    const job: HelperEarningsJob = { budget: 100, helper_fee_percent: 12 };
    expect(helperPlatformFeeDollars(job, TIER_FALLBACK_PCT)).toBe(12);
  });

  it("falls back to the caller's tier rate only when both columns are missing", () => {
    const job: HelperEarningsJob = { budget: 100 };
    expect(helperPlatformFeeDollars(job, TIER_FALLBACK_PCT)).toBe(20);
  });

  it("treats a null budget as $0 rather than NaN", () => {
    const job: HelperEarningsJob = { budget: null, helper_fee_percent: 12 };
    expect(helperPlatformFeeDollars(job, TIER_FALLBACK_PCT)).toBe(0);
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(0);
  });
});

describe("helperTakeHomeDollars — budget − fee + net urgent", () => {
  it("nets the urgent bonus of its own bundled Stripe cost", () => {
    const job: HelperEarningsJob = {
      budget: 100,
      helper_fee_percent: 10,
      urgent_fee: 20,
    };
    // 100 − 10 + 19.42 (NOT the gross $20 — the edge transfers the net).
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBeCloseTo(90 + NET_URGENT_20, 6);
  });

  it("ignores an absent/zero urgent fee", () => {
    const job: HelperEarningsJob = { budget: 100, helper_fee_percent: 10, urgent_fee: 0 };
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(90);
  });

  it("sums across jobs", () => {
    const jobs: HelperEarningsJob[] = [
      { budget: 100, platform_fee_amount: 10 },
      { budget: 200, helper_fee_percent: 10 },
    ];
    expect(sumHelperTakeHomeDollars(jobs, TIER_FALLBACK_PCT)).toBe(90 + 180);
    expect(sumHelperTakeHomeDollars([], TIER_FALLBACK_PCT)).toBe(0);
  });
});

describe("group jobs — the budget is split across the roster", () => {
  it("pays budget / helpers_needed, exactly as release-payout transfers", () => {
    // A $300 job needing 3 helpers pays each ~$100, not $300.
    const job: HelperEarningsJob = {
      budget: 300,
      helper_fee_percent: 12,
      is_group_job: true,
      helpers_needed: 3,
    };
    expect(helperShareCount(job)).toBe(3);
    // per-helper budget 100, commission 12% of THAT (not of the full $300).
    expect(helperPlatformFeeDollars(job, TIER_FALLBACK_PCT)).toBe(12);
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(88);
  });

  it("splits the net urgent bonus across the roster too", () => {
    const job: HelperEarningsJob = {
      budget: 300,
      helper_fee_percent: 12,
      urgent_fee: 30,
      is_group_job: true,
      helpers_needed: 3,
    };
    // The poster is charged the urgent fee ONCE, so each helper gets 1/3.
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBeCloseTo(88 + NET_URGENT_30 / 3, 6);
  });

  it("derives a group row's fee from the frozen % and ignores the stamped amount", () => {
    // `platform_fee_amount` has ambiguous scope on a group row: release-payout
    // stamps the PER-HELPER fee while create-payment's escrow/dispute paths
    // stamp the WHOLE-JOB fee. Using it verbatim would be wrong by N× one way
    // or the other, so the unambiguous frozen percent wins here.
    const job: HelperEarningsJob = {
      budget: 300,
      platform_fee_amount: 36,
      helper_fee_percent: 12,
      is_group_job: true,
      helpers_needed: 3,
    };
    expect(helperPlatformFeeDollars(job, TIER_FALLBACK_PCT)).toBe(12);
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(88);
  });

  it("does not split a non-group job that happens to carry helpers_needed", () => {
    const job: HelperEarningsJob = {
      budget: 300,
      helper_fee_percent: 12,
      is_group_job: false,
      helpers_needed: 3,
    };
    expect(helperShareCount(job)).toBe(1);
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(264);
  });

  it("degrades a null/0/1 roster to a single helper instead of dividing by zero", () => {
    const base = { budget: 300, helper_fee_percent: 12, is_group_job: true } as const;
    for (const helpers_needed of [null, undefined, 0, 1]) {
      const job: HelperEarningsJob = { ...base, helpers_needed };
      expect(helperShareCount(job)).toBe(1);
      expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(264);
    }
  });

  it("still honours the stamped fee on a single-helper job", () => {
    // The roster guard must not disable fee precedence for ordinary jobs.
    const job: HelperEarningsJob = {
      budget: 300,
      platform_fee_amount: 25,
      helper_fee_percent: 12,
      is_group_job: false,
      helpers_needed: 1,
    };
    expect(helperTakeHomeDollars(job, TIER_FALLBACK_PCT)).toBe(275);
  });
});
