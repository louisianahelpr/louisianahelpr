/**
 * 11-04 13:40Z (error_logs 2a04fe45, iPhone Safari on /): one guest saw "Couldn't load the newest jobs." and the log
 * held no cause (the catch dropped it). The landing's Open jobs section now retries once after a short pause, and a
 * second failure is reported with its cause before the failed state shows.
 *
 * @mutate src/components/landing/LiveJobsSection.tsx |         if (attempt === 0) { |         if (false) {
 * @mutate src/components/landing/LiveJobsSection.tsx |             report(err, { tags: { source: "LiveJobsSection.load" } }); |             void report;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const reads = vi.hoisted(() => ({ fails: 0, calls: 0 }));
vi.mock("@/lib/jobColumns", () => ({
  readJobsAheadOfDb: async () => {
    reads.calls++;
    if (reads.calls <= reads.fails) return { data: null, error: new Error("Load failed") };
    return { data: [{ id: "j1", title: "Job 1", budget: 50, date_needed: null, parish: "Iberia", category: null, pricing_mode: "fixed", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null }], error: null };
  },
}));
const reported = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/errorLogger", () => ({ report: (e: unknown) => reported.push(e) }));

import { LiveJobsSection, forgetRecentLiveJobs } from "./LiveJobsSection";

class SeeAll {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeeAll);
  reads.calls = 0;
  reported.length = 0;
  forgetRecentLiveJobs();
});
afterEach(() => vi.unstubAllGlobals());

describe("the landing's newest jobs survive one failed read", () => {
  it("one failure: retried, the jobs show, nothing reported", async () => {
    reads.fails = 1;
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    expect(await screen.findByTestId("landing-live-jobs-list", {}, { timeout: 4000 })).toBeTruthy();
    expect(reads.calls).toBe(2);
    expect(reported.filter((e) => String(e).includes("Load failed"))).toEqual([]);
  });

  it("two failures: the failed state shows and the cause is reported", async () => {
    reads.fails = 2;
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    expect(await screen.findByTestId("landing-live-jobs-failed", {}, { timeout: 4000 })).toBeTruthy();
    expect(reads.calls).toBe(2);
    // The cause, once (ReportErrorScreen also logs that the failed state was shown).
    await vi.waitFor(() => expect(reported.filter((e) => String(e).includes("Load failed"))).toHaveLength(1));
  });
});
