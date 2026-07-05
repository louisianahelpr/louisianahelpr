import { describe, it, expect } from "vitest";
import { buildEarningsSparklineSeries } from "./earningsSparklineSeries";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

describe("buildEarningsSparklineSeries", () => {
  it("returns null when fewer than two weeks have earnings", () => {
    const jobs = [
      { status: "completed", budget: 100, poster_completed_at: ago(2) },
    ];
    expect(buildEarningsSparklineSeries(jobs)).toBeNull();
  });

  it("ignores non-completed jobs and zero/negative take-home", () => {
    const jobs = [
      { status: "open", budget: 500, poster_completed_at: ago(1) },
      { status: "completed", budget: 50, platform_fee_amount: 50, poster_completed_at: ago(8) },
    ];
    expect(buildEarningsSparklineSeries(jobs)).toBeNull();
  });

  it("buckets take-home into weeks oldest -> newest", () => {
    const jobs = [
      // ~5 weeks ago (oldest bucket) take-home 90
      { status: "completed", budget: 100, platform_fee_amount: 10, poster_completed_at: ago(35) },
      // this week (newest bucket) take-home 200 + net urgent 19.42
      // ($20 urgent − its own 2.9% bundled Stripe cost = 20 − 0.58).
      { status: "completed", budget: 200, urgent_fee: 20, poster_completed_at: ago(1) },
    ];
    const series = buildEarningsSparklineSeries(jobs, 6);
    expect(series).not.toBeNull();
    expect(series).toHaveLength(6);
    expect(series![0]).toBe(90);
    expect(series![5]).toBeCloseTo(219.42, 2);
  });

  it("falls back to updated_at when poster_completed_at is missing", () => {
    const jobs = [
      { status: "completed", budget: 100, updated_at: ago(2) },
      { status: "completed", budget: 100, updated_at: ago(9) },
    ];
    const series = buildEarningsSparklineSeries(jobs, 6);
    expect(series).not.toBeNull();
    expect(series!.reduce((a, b) => a + b, 0)).toBe(200);
  });
});
