/**
 * F010 (owner's UI audit 11-09): the landing's "Open jobs near you" rows waited for the Supabase chunk (measured live:
 * the read started at 2.0 s at 1440 and 3.6 s at 375). The entry now starts that read on a signed-out "/"
 * (src/boot/guestJobsPrefetch.ts) and LiveJobsSection draws its rows from it, without loading Supabase at all; a
 * failed entry read falls back to the section's own read.
 *
 * @mutate src/components/landing/LiveJobsSection.tsx |     const prefetched = takeLandingJobsPrefetch(); |     const prefetched = null as Promise<unknown[] \| null> \| null; void takeLandingJobsPrefetch;
 * @mutate src/components/landing/LiveJobsSection.tsx |         let data = attempt === 0 && prefetched ? await prefetched : null; |         let data = null as unknown[] \| null; void prefetched;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const reads = vi.hoisted(() => ({ supabaseLoaded: 0, calls: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  reads.supabaseLoaded++;
  return { supabase: {} };
});
vi.mock("@/lib/jobColumns", () => ({
  readJobsAheadOfDb: async () => {
    reads.calls++;
    return { data: [{ id: "s1", title: "From the section's own read", budget: 40, date_needed: null, parish: null, category: null, pricing_mode: "set_price", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null }], error: null };
  },
}));

import { LiveJobsSection, forgetRecentLiveJobs } from "./LiveJobsSection";

const KEY = "__lhLandingJobsPrefetch";
const row = { id: "e1", title: "From the entry's read", budget: 60, date_needed: null, parish: "Iberia", category: null, pricing_mode: "set_price", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null };
const put = (rows: unknown[] | null) => {
  (window as unknown as Record<string, unknown>)[KEY] = { at: Date.now(), rows: Promise.resolve(rows) };
};

beforeEach(() => {
  reads.calls = 0;
  forgetRecentLiveJobs();
  // No IntersectionObserver (the test DOM): without the entry's read the section fetches nothing on its own here.
  vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  (window as unknown as Record<string, unknown>)[KEY] = undefined;
});

describe("the landing's jobs come from the entry's read (F010)", () => {
  it("draws the entry's rows without asking Supabase", async () => {
    put([row]);
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    expect(await screen.findByText("From the entry's read")).toBeTruthy();
    expect(reads.calls).toBe(0);
  });

  it("a failed entry read (null) falls back to the section's own read", async () => {
    put(null);
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    expect(await screen.findByText("From the section's own read")).toBeTruthy();
    expect(reads.calls).toBe(1);
  });
});
