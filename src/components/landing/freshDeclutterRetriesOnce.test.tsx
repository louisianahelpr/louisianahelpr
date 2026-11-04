/**
 * Q2735 (11-04, iPhone Safari guests on /): the landing's newest-jobs read failed on a phone's network blip and the
 * log held no cause. The "Fresh on Declutter" strip under it reads the same way, so it follows the same rule: one
 * quiet retry after a short pause, and a second failure is reported with its cause before the failed line shows.
 *
 * @mutate src/components/landing/FreshDeclutterSection.tsx |         if (attempt === 0) { |         if (false) {
 * @mutate src/components/landing/FreshDeclutterSection.tsx |             report(err, { tags: { source: "FreshDeclutterSection.load" } }); |             void report;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const reads = vi.hoisted(() => ({ fails: 0, calls: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) q[m] = () => q;
    q.limit = async () => {
      reads.calls++;
      if (reads.calls <= reads.fails) return { data: null, error: new Error("Load failed") };
      return { data: [{ id: "i1", title: "Lamp", current_price_cents: 1500, area_label: "New Iberia", live_at: "2026-11-04T10:00:00Z" }], error: null };
    };
    // the photo read (after the items read) ends on .order and is awaited directly
    if (table === "declutter_item_photos") q.order = async () => ({ data: [], error: null });
    return q;
  };
  return { supabase: { from: chain } };
});
const reported = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/errorLogger", () => ({ report: (e: unknown) => reported.push(e) }));

import { FreshDeclutterSection, forgetRecentFreshItems } from "./FreshDeclutterSection";

class SeeAll {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeeAll);
  reads.calls = 0;
  reported.length = 0;
  forgetRecentFreshItems();
});
afterEach(() => vi.unstubAllGlobals());

describe("the landing's Fresh on Declutter strip survives one failed read", () => {
  it("one failure: retried, the listings show, nothing reported", async () => {
    reads.fails = 1;
    render(<MemoryRouter><FreshDeclutterSection /></MemoryRouter>);
    expect(await screen.findByTestId("landing-fresh-declutter-list", {}, { timeout: 4000 })).toBeTruthy();
    expect(reads.calls).toBe(2);
    expect(screen.queryByTestId("landing-fresh-declutter-failed")).toBeNull();
    expect(reported.filter((e) => String(e).includes("Load failed"))).toEqual([]);
  });

  it("two failures: the failed line shows and the cause is reported once", async () => {
    reads.fails = 2;
    render(<MemoryRouter><FreshDeclutterSection /></MemoryRouter>);
    expect(await screen.findByTestId("landing-fresh-declutter-failed", {}, { timeout: 4000 })).toBeTruthy();
    expect(reads.calls).toBe(2);
    await vi.waitFor(() => expect(reported.filter((e) => String(e).includes("Load failed"))).toHaveLength(1));
  });
});
