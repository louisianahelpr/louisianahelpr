/**
 * Audit 2026-10-28 P5-6 (landing, 1440): "Open jobs near you" laid 2 cards in
 * a 4-wide row (right half empty), and its column sat at x=160 while the logo
 * and "Four ways…" sat at x=144 (max-w-[1120px] against the other sections'
 * max-w-6xl). The row now has as many columns as there are jobs (at most 4)
 * and the section uses the same measure as the sections around it.
 *
 * @mutate src/components/landing/LiveJobsSection.tsx | const cols = 1 + (state.kind === "ok" ? Math.max(1, Math.min(state.jobs.length, LIVE_JOBS_LIMIT)) : LIVE_JOBS_LIMIT); | const cols = 1 + LIVE_JOBS_LIMIT;
 * @mutate src/components/landing/LandingBrowseShell.tsx | <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 lg:gap-8" data-testid={`${testId}-measure`}> | <div className="mx-auto w-full max-w-[1120px] flex flex-col gap-6 lg:gap-8" data-testid={`${testId}-measure`}>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const rows = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock("@/lib/jobColumns", () => ({ readJobsAheadOfDb: async () => ({ data: rows.data, error: null }) }));

import { LiveJobsSection, forgetRecentLiveJobs } from "./LiveJobsSection";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const job = (n: number) => ({
  id: `j${n}`, title: `Job ${n}`, budget: 50, date_needed: jobLocalDateISO(4), parish: "Iberia", category: null,
  pricing_mode: "fixed", urgent_fee: 0, helpers_needed: 1, is_group_job: false, helper_fee_flat_cents: null, helper_fee_percent: null,
});

class SeeAll {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeeAll);
  forgetRecentLiveJobs();
});
afterEach(() => vi.unstubAllGlobals());

const MEASURE = /\bmax-w-6xl\b/;

describe("the landing's Open jobs row fits its cards and the page's edge", () => {
  // Owner 11-09: the finished-job card is the grid's first card, so the row is that card plus the jobs (at most 3).
  it.each([1, 2, 3])("%i job(s) -> that many columns plus the finished-job card", async (n) => {
    rows.data = Array.from({ length: n }, (_, i) => job(i + 1));
    const { unmount } = render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    const list = await screen.findByTestId("landing-live-jobs-list");
    expect(list.querySelectorAll(":scope > li")).toHaveLength(n + 1);
    expect(list.querySelector(":scope > li:first-child [data-testid=landing-proof]")).toBeTruthy();
    expect(list.style.getPropertyValue("--live-n")).toBe(String(n + 1));
    expect(list.className).toContain("lg:[grid-template-columns:repeat(var(--live-n),minmax(0,1fr))]");
    unmount();
  });

  it("uses the same measure as the landing's other sections (same left edge at 1440)", () => {
    rows.data = [];
    render(<MemoryRouter><LiveJobsSection /></MemoryRouter>);
    expect(screen.getByTestId("landing-live-jobs-measure").className).toMatch(MEASURE);
    const showcase = readFileSync(resolve(__dirname, "SectionsShowcase.tsx"), "utf8");
    const how = readFileSync(resolve(__dirname, "HowItWorksSection.tsx"), "utf8");
    expect(showcase.length).toBeGreaterThan(500);
    expect(how.length).toBeGreaterThan(500);
    expect(showcase).toMatch(/mx-auto w-full max-w-6xl/);
    expect(how).toMatch(/mx-auto w-full max-w-6xl/);
  });
});
