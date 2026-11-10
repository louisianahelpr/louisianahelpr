/**
 * Q104 (e2e-real-backend, chromium-anon-surface, 11-04 run 41887511857: perTest 4.8 over its budget 2.8): the
 * route walk comes back to the landing four times, and every visit re-read the same newest jobs (open_jobs_browse)
 * and the same Fresh on Declutter listings and their photos. Measured locally on the same walk against prod
 * (read-only, anon; ~/.lh-shots/b1-q104): 23 requests -> 14, REST 14 -> 5. A good answer is kept for a few minutes
 * and drawn at once on the next visit; a failed read is never kept.
 *
 * @mutate src/components/landing/LiveJobsSection.tsx |         recentJobs = { at: Date.now(), jobs }; |         void jobs;
 * @mutate src/components/landing/LiveJobsSection.tsx |     if (!el \|\| keptJobs()) return; |     if (!el) return;
 * @mutate src/components/landing/FreshDeclutterSection.tsx |         recentItems = { at: Date.now(), items }; |         void items;
 * @mutate src/components/landing/FreshDeclutterSection.tsx | typeof IntersectionObserver === "undefined" \|\| keptItems()) return; | typeof IntersectionObserver === "undefined") return;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";

const reads = vi.hoisted(() => ({ jobs: 0, items: 0, photos: 0, failJobs: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const rows =
      table === "declutter_items"
        ? [{ id: "i1", title: "Oak dresser", category: "furniture", condition_stars: 4, porch_ok: true, price_cents: 4000, current_price_cents: 4000, area_label: "Mid City", live_at: "2026-11-04T10:00:00Z" }]
        : [{ item_id: "i1", storage_path: "u/declutter/i1/a.jpg", position: 0 }];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => {
      if (table === "declutter_items") reads.items++;
      else reads.photos++;
      return Promise.resolve({ data: rows, error: null }).then(ok);
    };
    return q;
  };
  // storage: the Declutter card builds its photo URLs (photoCardUrl / photoPublicUrl).
  const storage = { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.invalid/${p}` } }) }) };
  // Owner 11-09: the Declutter grid reads declutter_popular_items, the card rows with their cover photo path, in one call.
  const rpc = async () => {
    reads.items++;
    return { data: [{ id: "i1", title: "Oak dresser", category: "furniture", condition_stars: 4, porch_ok: true, price_cents: 4000, current_price_cents: 4000, area_label: "Mid City", live_at: "2026-11-04T10:00:00Z", photo_path: "u/declutter/i1/a.jpg" }], error: null };
  };
  return { supabase: { from: chain, storage, rpc } };
});
vi.mock("@/lib/jobColumns", () => ({
  readJobsAheadOfDb: async () => {
    reads.jobs++;
    if (reads.jobs <= reads.failJobs) return { data: null, error: new Error("Load failed") };
    return { data: [{ id: "j1", title: "Job 1", budget: 50, date_needed: null, parish: "Iberia", category: null, pricing_mode: "fixed", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null }], error: null };
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));

import { forgetRecentLiveJobs, LANDING_REUSE_MS, useLiveJobs } from "./LiveJobsSection";
import { forgetRecentFreshItems, FRESH_REUSE_MS, useFreshItems } from "./FreshDeclutterSection";

// Direction A (11-10): both lists feed "Near you this week" through these hooks; each probe shows the hook's state.
function Jobs() {
  const ref = useRef<HTMLDivElement>(null);
  const s = useLiveJobs(ref);
  return <div ref={ref} data-testid={`jobs-${s.kind}`} />;
}
function Items() {
  const ref = useRef<HTMLDivElement>(null);
  const s = useFreshItems(ref);
  return <div ref={ref} data-testid={`items-${s.kind}`} />;
}

class SeeAll {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeeAll);
  Object.assign(reads, { jobs: 0, items: 0, photos: 0, failJobs: 0 });
  forgetRecentLiveJobs();
  forgetRecentFreshItems();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the landing reads its lists once per visit run, not on every return (Q104)", () => {
  it("the newest jobs: a second visit draws the kept answer with no read", async () => {
    render(<Jobs />);
    expect(await screen.findByTestId("jobs-ok")).toBeTruthy();
    cleanup();
    render(<Jobs />);
    expect(screen.getByTestId("jobs-ok")).toBeTruthy();
    // Long enough for a (wrong) second read to land: the chain is a few awaited imports.
    await new Promise((r) => setTimeout(r, 100));
    expect(reads.jobs).toBe(1);
  });

  it("the newest jobs: a failed read is not kept, the next visit reads again", async () => {
    reads.failJobs = 2;
    render(<Jobs />);
    expect(await screen.findByTestId("jobs-failed", {}, { timeout: 4000 })).toBeTruthy();
    cleanup();
    render(<Jobs />);
    expect(await screen.findByTestId("jobs-ok")).toBeTruthy();
    expect(reads.jobs).toBe(3);
  });

  it("the kept answer is only a few minutes old at most", () => {
    expect(LANDING_REUSE_MS).toBeGreaterThan(0);
    expect(LANDING_REUSE_MS).toBeLessThanOrEqual(10 * 60_000);
    expect(FRESH_REUSE_MS).toBe(LANDING_REUSE_MS);
  });

  it("Fresh on Declutter: a second visit draws the kept listings with no read", async () => {
    render(<Items />);
    expect(await screen.findByTestId("items-ok", {}, { timeout: 4000 })).toBeTruthy();
    cleanup();
    render(<Items />);
    expect(await screen.findByTestId("items-ok", {}, { timeout: 4000 })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(reads.items).toBe(1);
    // One call brings the cover photo too: no separate photo read.
    expect(reads.photos).toBe(0);
  });
});
