/**
 * Home's own cart and shop-order reads wait on the badge's one read (Blockers 8, 2026-11-03, lead PASS). useHomeSummary
 * reads ["declutter","my-cart"] and ["shops","shop-orders",uid], the same keys my_badge_reads seeds; before this it
 * fetched both on every Home load even when the one read had answered them (2 extra requests per Home load). Now it
 * fetches a section itself only when that section is on its old single call (useNeedsYouTodos' onOldCall).
 * Drives the real useHomeSummary against a fake client that counts every call:
 *   1. the one read answers every section: no cart or shop-order call of Home's own, and Home still has the orders;
 *   2. the one read is not deployed (PGRST202): Home's cart and shop-order reads run, as before.
 * Sibling guard: src/test/badgeReadsOneRequest.test.ts (the to-do hook's own fallback).
 *
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | enabled: !!uid && shopsOn && onOldCall("shop_orders") }); | enabled: !!uid && shopsOn });
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts | enabled: !!uid && declutterOn && onOldCall("cart") }); | enabled: !!uid && declutterOn });
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";
import { useHomeSummary } from "@/pages/home/homeDashboard/useHomeSummary";

const rig = vi.hoisted(() => ({ calls: [] as string[], badgeDeployed: true }));
const ORDER = { id: "so1", status: "held", accept_by: "2099-01-01T00:00:00Z", total_cents: 1240, shop_order_lines: [{ title: "Pecan pralines" }] };

vi.mock("@/hooks/useActivityData", () => ({
  CORE_STALE: 60_000,
  useActivityData: () => ({ postedJobs: [], appliedApps: [], pendingApplicantCounts: {}, helperNames: {}, loading: false }),
  fetchPostedActivity: async () => ({ postedJobs: [], applicantCounts: {}, pendingApplicantCounts: {}, closedApplicantSummaries: {} }),
  fetchAppliedActivity: async () => ({ appliedApps: [], declinedJobIds: new Set(), helperReviewedJobIds: new Set() }),
}));
const ON = new Set(["declutter", "shops"]);
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (k: string) => ON.has(k),
  useFeatureStatus: (k: string) => ({ on: ON.has(k), settled: true, lastAnswer: ON.has(k) }),
}));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
// The near-you counts wait for the page to settle; never settled here, so they make no call.
vi.mock("@/lib/routePrefetch", () => ({ whenPageSettled: () => () => {}, prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const rows = name === "shop_orders" ? [ORDER] : [];
    const q: Record<string, unknown> = {};
    // The side a shop_orders read is on (seller = the shop's incoming orders; buyer = my orders, another key).
    let side = "";
    for (const m of ["select", "is", "not", "order", "limit", "in"]) q[m] = () => q;
    q.eq = (col: string) => {
      if (col === "seller_id" || col === "buyer_id") side = `:${col}`;
      return q;
    };
    q.then = (res: (v: unknown) => unknown) => {
      rig.calls.push(`from:${name}${name === "shop_orders" ? side : ""}`);
      return Promise.resolve({ data: rows, error: null }).then(res);
    };
    return q;
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      rpc: (name: string) => {
        rig.calls.push(`rpc:${name}`);
        if (name === "my_badge_reads") {
          return Promise.resolve(
            rig.badgeDeployed
              ? { data: { cart: [], offers: [], free_asks: [], backout: [], shop_orders: [ORDER] }, error: null }
              : { data: null, error: { code: "PGRST202", message: "Could not find the function public.my_badge_reads(p_keys) in the schema cache", hint: null } },
          );
        }
        return Promise.resolve({ data: [], error: null });
      },
      from: (name: string) => table(name),
    },
  };
});

function run() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return { qc, ...renderHook(() => useHomeSummary({ id: "u1" } as SupaUser), { wrapper }) };
}
// Long enough for the cart module's first import (case 2 measures it arriving well inside this).
const settle = () => new Promise((r) => setTimeout(r, 1500));
const HOME_OWN = ["rpc:declutter_my_cart", "from:shop_orders:seller_id"];

describe("Home's cart and shop-order reads wait on the badge's one read", () => {
  afterEach(() => {
    cleanup();
    rig.calls = [];
    rig.badgeDeployed = true;
  });

  it("the one read answered: Home makes no cart or shop-order call of its own, and still has the orders", async () => {
    const { qc } = run();
    await waitFor(() => expect(qc.getQueryData(["shops", "shop-orders", "u1"])).toEqual([ORDER]));
    await settle();
    expect(rig.calls).toContain("rpc:my_badge_reads");
    expect(rig.calls.filter((c) => HOME_OWN.includes(c))).toEqual([]);
  });

  it("the one read not deployed (PGRST202): Home's cart and shop-order reads run, as before", async () => {
    rig.badgeDeployed = false;
    const { qc } = run();
    await waitFor(() => expect(qc.getQueryData(["shops", "shop-orders", "u1"])).toEqual([ORDER]));
    // The cart's module is large: wait for the calls themselves, not a fixed pause.
    await waitFor(() => expect([...new Set(rig.calls.filter((c) => HOME_OWN.includes(c)))].sort()).toEqual([...HOME_OWN].sort()), { timeout: 4000 });
    const own = rig.calls.filter((c) => HOME_OWN.includes(c));
    // Inventory floor: both of Home's section reads are counted.
    expect(new Set(own).size).toBeGreaterThan(1);
  });
});
