import { describe, it, expect } from "vitest";
import { buildEarningsSparklineSeries } from "./earningsSparklineSeries";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

// Tier-derived last-resort fee %, as the Profile page passes it.
const FALLBACK_PCT = 12;

describe("buildEarningsSparklineSeries", () => {
  it("returns null when fewer than two weeks have earnings", () => {
    const jobs = [
      { status: "completed", budget: 100, poster_completed_at: ago(2) },
    ];
    expect(buildEarningsSparklineSeries(jobs, FALLBACK_PCT)).toBeNull();
  });

  it("ignores non-completed jobs and zero/negative take-home", () => {
    const jobs = [
      { status: "open", budget: 500, poster_completed_at: ago(1) },
      { status: "completed", budget: 50, platform_fee_amount: 50, poster_completed_at: ago(8) },
    ];
    expect(buildEarningsSparklineSeries(jobs, FALLBACK_PCT)).toBeNull();
  });

  it("buckets take-home into weeks oldest -> newest", () => {
    const jobs = [
      // ~5 weeks ago (oldest bucket) take-home 90
      { status: "completed", budget: 100, platform_fee_amount: 10, poster_completed_at: ago(35) },
      // this week (newest bucket): 200 − 12% frozen fee (24) + net urgent 19.42
      // ($20 urgent − its own 2.9% bundled Stripe cost = 20 − 0.58).
      { status: "completed", budget: 200, helper_fee_percent: 12, urgent_fee: 20, poster_completed_at: ago(1) },
    ];
    const series = buildEarningsSparklineSeries(jobs, FALLBACK_PCT, 6);
    expect(series).not.toBeNull();
    expect(series).toHaveLength(6);
    expect(series![0]).toBe(90);
    expect(series![5]).toBeCloseTo(195.42, 2);
  });

  it("falls back to updated_at when poster_completed_at is missing", () => {
    const jobs = [
      { status: "completed", budget: 100, helper_fee_percent: 10, updated_at: ago(2) },
      { status: "completed", budget: 100, helper_fee_percent: 10, updated_at: ago(9) },
    ];
    const series = buildEarningsSparklineSeries(jobs, FALLBACK_PCT, 6);
    expect(series).not.toBeNull();
    expect(series!.reduce((a, b) => a + b, 0)).toBe(180);
  });

  it("deducts the tier fallback on an unstamped, percent-less row (no gross budget)", () => {
    // Regression: this used to render the GROSS budget because the old
    // `budget − (platform_fee_amount || 0)` treated a missing fee as $0.
    const jobs = [
      { status: "completed", budget: 100, updated_at: ago(2) },
      { status: "completed", budget: 100, updated_at: ago(9) },
    ];
    const series = buildEarningsSparklineSeries(jobs, FALLBACK_PCT, 6);
    expect(series).not.toBeNull();
    expect(series!.reduce((a, b) => a + b, 0)).toBeCloseTo(176, 10);
  });
});
