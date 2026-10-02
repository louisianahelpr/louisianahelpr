// /jobs and /posts must paint a CACHED answer on the first frame, the way the
// Messages inbox does — the skeleton is for a cold cache only.
//
// Owner, 2026-10-01: "messages and post load immediately but jobs has a
// skeleton then loads ... i prefer it load immediately like the other".
// Cause (measured on prod: the owner has 1 posted job, 0 applications): the
// hook held the skeleton while a ZERO-ROW cached result was refetched, and
// `refetchOnMount: "always"` refetches on every visit — so an empty My Jobs
// list showed the skeleton every time while a non-empty My Posts did not.
//
// Each case renders the real hook against a cache seeded the way the Dashboard
// prefetch / IndexedDB persister leaves it, with the revalidation request held
// in flight forever, and reads `loading` on the FIRST render.
//
// @mutate src/hooks/useActivityData.ts | const loading = !activeCore.isError && activeCore.data === undefined; | const loading = !activeCore.isError && (activeCore.data === undefined \|\| (activeCore.isFetching && (isPosted ? postedCore.data!.postedJobs.length : appliedCore.data!.appliedApps.length) === 0));

import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";

// Every read stays in flight: the hook must decide from the cache alone.
vi.mock("@/integrations/supabase/client", () => {
  const never = () => new Promise(() => {});
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "neq", "is", "not", "or", "limit", "gte", "lte"]) {
    chain[m] = () => chain;
  }
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    never().then(resolve, reject);
  return { supabase: { from: () => chain, rpc: never } };
});
vi.mock("@/lib/realtimeRecovery", () => ({
  subscribeWithRecovery: () => ({ close: () => {} }),
}));
vi.mock("@/lib/userRealtimeBus", () => ({
  subscribeUserRealtime: () => () => {},
}));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));

import { useActivityData } from "./useActivityData";
import { queryKeys } from "@/lib/queryKeys";

const USER = { id: "u1" } as User;

const EMPTY_APPLIED = { appliedApps: [], declinedJobIds: new Set(), helperReviewedJobIds: new Set() };
const EMPTY_POSTED = { postedJobs: [], applicantCounts: {}, pendingApplicantCounts: {} };
const ONE_POSTED = {
  postedJobs: [{ id: "j1", status: "open", customer_id: "u1", title: "Yard" }],
  applicantCounts: {},
  pendingApplicantCounts: {},
};

function firstRender(tab: "posted" | "applied", seed?: { posted?: unknown; applied?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed?.posted) qc.setQueryData(queryKeys.activity.posted("u1"), seed.posted);
  if (seed?.applied) qc.setQueryData(queryKeys.activity.applied("u1"), seed.applied);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useActivityData(USER, tab), { wrapper });
  const loading = result.current.loading;
  const fetching = qc.isFetching();
  unmount();
  qc.clear();
  return { loading, fetching };
}

describe("useActivityData — first paint matches Messages (cache paints, cold shows skeleton)", () => {
  it("My Jobs with a cached EMPTY list paints at once (the owner's /jobs report)", () => {
    const r = firstRender("applied", { applied: EMPTY_APPLIED, posted: ONE_POSTED });
    // The revalidation is really in flight — this is the exact state that used
    // to hold the skeleton.
    expect(r.fetching).toBeGreaterThan(0);
    expect(r.loading).toBe(false);
  });

  it("My Posts with a cached EMPTY list paints at once too (same hook, same rule)", () => {
    const r = firstRender("posted", { posted: EMPTY_POSTED, applied: EMPTY_APPLIED });
    expect(r.fetching).toBeGreaterThan(0);
    expect(r.loading).toBe(false);
  });

  it("My Posts with cached rows paints at once (unchanged)", () => {
    expect(firstRender("posted", { posted: ONE_POSTED }).loading).toBe(false);
  });

  it("a genuinely cold cache still shows the skeleton on both tabs", () => {
    expect(firstRender("applied").loading).toBe(true);
    expect(firstRender("posted").loading).toBe(true);
  });

  it("no identity yet (query disabled, nothing cached) still shows the skeleton", () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useActivityData(null, "applied"), { wrapper });
    expect(result.current.loading).toBe(true);
    unmount();
  });
});
