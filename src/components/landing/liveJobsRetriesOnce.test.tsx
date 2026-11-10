/**
 * 11-04 13:40Z (error_logs 2a04fe45, iPhone Safari on /): one guest saw "Couldn't load the newest jobs." and the log
 * held no cause (the catch dropped it). The landing's jobs read (useLiveJobs; since Direction A, 11-10, it feeds "Near
 * you this week") retries once after a short pause, and a second failure is reported with its cause before the failed
 * state shows.
 *
 * @mutate src/components/landing/LiveJobsSection.tsx |         if (attempt === 0) { |         if (false) {
 * @mutate src/components/landing/LiveJobsSection.tsx |             report(err, { tags: { source: "LiveJobsSection.load" } }); |             void report;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";

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

import { forgetRecentLiveJobs, useLiveJobs } from "./LiveJobsSection";

class SeeAll {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const s = useLiveJobs(ref);
  return <div ref={ref} data-testid={`jobs-${s.kind}`}>{s.kind === "ok" ? s.jobs.length : ""}</div>;
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeeAll);
  reads.calls = 0;
  reported.length = 0;
  forgetRecentLiveJobs();
});
afterEach(() => vi.unstubAllGlobals());

describe("the landing's newest jobs survive one failed read", () => {
  it("one failure: retried, the jobs arrive, nothing reported", async () => {
    reads.fails = 1;
    render(<Probe />);
    expect((await screen.findByTestId("jobs-ok", {}, { timeout: 4000 })).textContent).toBe("1");
    expect(reads.calls).toBe(2);
    expect(reported.filter((e) => String(e).includes("Load failed"))).toEqual([]);
  });

  it("two failures: the failed state and the cause is reported", async () => {
    reads.fails = 2;
    render(<Probe />);
    expect(await screen.findByTestId("jobs-failed", {}, { timeout: 4000 })).toBeTruthy();
    expect(reads.calls).toBe(2);
    await vi.waitFor(() => expect(reported.filter((e) => String(e).includes("Load failed"))).toHaveLength(1));
  });
});
