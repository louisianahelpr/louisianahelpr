/**
 * Q2735 (11-04, iPhone Safari guests on /): the landing's newest-jobs read failed on a phone's network blip and the
 * log held no cause. The landing's Declutter read (useFreshItems; since Direction A, 11-10, it feeds the photo band and
 * "Near you this week") follows the same rule: one quiet retry after a short pause, and a second failure is reported
 * with its cause before the failed state shows.
 * Direction A (11-10): the photo band and the grid both read the listings; while one read is in flight, a second caller
 * shares it (sharedFreshRead), so the page makes ONE request, never two.
 *
 * @mutate src/components/landing/FreshDeclutterSection.tsx |         if (attempt === 0) { |         if (false) {
 * @mutate src/components/landing/FreshDeclutterSection.tsx |             report(err, { tags: { source: "FreshDeclutterSection.load" } }); |             void report;
 * @mutate src/components/landing/FreshDeclutterSection.tsx |   inflight ??= readFreshItems().finally(() => { |   inflight = readFreshItems().finally(() => {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";

const reads = vi.hoisted(() => ({ fails: 0, calls: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  // Owner 11-09: the one read is declutter_popular_items (the card rows with their cover photo path).
  const rpc = async () => {
    reads.calls++;
    await new Promise((r) => setTimeout(r, 20));
    if (reads.calls <= reads.fails) return { data: null, error: new Error("Load failed") };
    return { data: [{ id: "i1", title: "Lamp", current_price_cents: 1500, price_cents: 1500, area_label: "New Iberia", live_at: "2026-11-04T10:00:00Z", photo_path: null }], error: null };
  };
  // No cover photo path in the answer, so the read asks declutter_item_photos (it ends on .order and is awaited).
  const photos: Record<string, unknown> = {};
  for (const m of ["select", "in"]) photos[m] = () => photos;
  photos.order = async () => ({ data: [], error: null });
  return { supabase: { from: () => photos, rpc } };
});
const reported = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/errorLogger", () => ({ report: (e: unknown) => reported.push(e) }));

import { forgetRecentFreshItems, useFreshItems } from "./FreshDeclutterSection";

class SeeAll {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
}

function Probe({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = useFreshItems(ref);
  return <div ref={ref} data-testid={`${id}-${s.kind}`}>{s.kind === "ok" ? s.items.length : ""}</div>;
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", SeeAll);
  reads.calls = 0;
  reported.length = 0;
  forgetRecentFreshItems();
});
afterEach(() => vi.unstubAllGlobals());

describe("the landing's Declutter read survives one failed read", () => {
  it("one failure: retried, the listings arrive, nothing reported", async () => {
    reads.fails = 1;
    render(<Probe id="a" />);
    expect((await screen.findByTestId("a-ok", {}, { timeout: 4000 })).textContent).toBe("1");
    expect(reads.calls).toBe(2);
    expect(reported.filter((e) => String(e).includes("Load failed"))).toEqual([]);
  });

  it("two failures: the failed state and the cause is reported once", async () => {
    reads.fails = 2;
    render(<Probe id="a" />);
    expect(await screen.findByTestId("a-failed", {}, { timeout: 4000 })).toBeTruthy();
    expect(reads.calls).toBe(2);
    await vi.waitFor(() => expect(reported.filter((e) => String(e).includes("Load failed"))).toHaveLength(1));
  });

  it("two callers on one page (the photo band and the grid) share one request", async () => {
    reads.fails = 0;
    render(<><Probe id="band" /><Probe id="grid" /></>);
    expect(await screen.findByTestId("band-ok", {}, { timeout: 4000 })).toBeTruthy();
    expect(await screen.findByTestId("grid-ok", {}, { timeout: 4000 })).toBeTruthy();
    expect(reads.calls).toBe(1);
  });
});
