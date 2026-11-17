// Q2705 (2026-11-17): Jobs > Posted paints its first cards from the LEAN posted core while the whole list loads.
//
// prod-audit 44032555275 (2026-11-17, Slow 4G + 4x CPU, 375) read the Posted tab's first card at 10872 ms: it waited
// for the whole posted list (2026-11-15 sizing: 831 jobs on the cwv-lab poster, ~176 KB gzip), which shared the slow
// link with the app's JavaScript. Measured 2026-11-17 (cwv-lab, `npm run build`, same conditions, median of 3):
// 8848 -> 5084 ms: the lean core (every job outside Done and Cancelled) draws the first groups, and the whole read
// waits until the Posted tab's code is in.
//
// Each case renders the real hook against a seeded cache with every network read held in flight, and reads the FIRST
// render: what is drawn, and whether the whole read was sent.
//
// @mutate src/hooks/useActivityData.ts | const partial = leanFirstWanted && postedCore.data === undefined && !postedCore.isError && leanHasCards; | const partial = false;
// @mutate src/hooks/useActivityData.ts | enabled: !!userId && isPosted && !wholeHeld, | enabled: !!userId && isPosted,
// @mutate src/hooks/useActivityData.ts | && (leanFirstData === undefined \|\| (leanHasCards && !!opts.holdWhole)); | && (leanFirstData === undefined \|\| leanHasCards);
// @mutate src/hooks/useActivityData.ts | const loading = !activeCore.isError && activeCore.data === undefined && !partial; | const loading = !activeCore.isError && activeCore.data === undefined;
// @mutate src/hooks/useActivityData.ts | const posted = postedCore.data ?? (partial && leanFirstData ? leanFirstData : EMPTY_POSTED); | const posted = postedCore.data ?? EMPTY_POSTED;
// @mutate src/hooks/useActivityData.ts |   const rows = [...readableJobRows(jobsRes.data)].sort(newestFirst); |   const rows = [...readableJobRows(jobsRes.data)];
// @mutate src/hooks/useActivityData.ts |   return a.id === b.id ? 0 : a.id < b.id ? 1 : -1; |   return 0;

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
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => never().then(resolve, reject);
  return { supabase: { from: () => chain, rpc: never } };
});
vi.mock("@/lib/realtimeRecovery", () => ({ subscribeWithRecovery: () => ({ close: () => {} }) }));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/errorLogger", () => ({ report: () => {} }));
// The cores read (fetchPostedActivity's source) answers what the case says; null = never answers.
const cores = vi.hoisted(() => ({ payload: null as unknown }));
vi.mock("@/lib/activityCores", async (orig) => {
  const real = await orig<typeof import("@/lib/activityCores")>();
  const answer = () => (cores.payload ? Promise.resolve(cores.payload) : new Promise(() => {}));
  return { ...real, fetchActivityCores: answer, fetchLeanPostedCores: answer };
});

import { fetchPostedActivity, useActivityData } from "./useActivityData";
import { queryKeys } from "@/lib/queryKeys";

const USER = { id: "u1" } as User;
const posted = (...ids: string[]) => ({
  postedJobs: ids.map((id) => ({ id, status: "open", customer_id: "u1", title: `Job ${id}` })),
  applicantCounts: {},
  pendingApplicantCounts: {},
  closedApplicantSummaries: {},
});

function firstRender(opts: { leanFirst?: boolean; holdWhole?: boolean }, seed: { lean?: unknown; whole?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seed.lean) qc.setQueryData(queryKeys.activity.postedLean("u1"), seed.lean);
  if (seed.whole) qc.setQueryData(queryKeys.activity.posted("u1"), seed.whole);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => useActivityData(USER, "posted", opts), { wrapper });
  const r = result.current;
  const wholeSent = qc.getQueryState(queryKeys.activity.posted("u1"))?.fetchStatus === "fetching";
  const out = { loading: r.loading, partial: r.partial, ids: r.postedJobs.map((j) => j.id), wholeSent };
  unmount();
  qc.clear();
  return out;
}

describe("Jobs > Posted paints from the lean posted core first (Q2705)", () => {
  it("draws the lean cards at once and holds the whole read while the tab's code is not in", () => {
    const r = firstRender({ leanFirst: true, holdWhole: true }, { lean: posted("a", "b") });
    expect(r).toEqual({ loading: false, partial: true, ids: ["a", "b"], wholeSent: false });
  });

  it("sends the whole read once the caller stops holding, still drawing the lean cards until it lands", () => {
    const r = firstRender({ leanFirst: true, holdWhole: false }, { lean: posted("a") });
    expect(r).toEqual({ loading: false, partial: true, ids: ["a"], wholeSent: true });
  });

  it("a lean core with no card releases the whole read and shows the loading frame (never a premature empty list)", () => {
    const r = firstRender({ leanFirst: true, holdWhole: true }, { lean: posted() });
    expect(r).toEqual({ loading: true, partial: false, ids: [], wholeSent: true });
  });

  it("a view that needs the whole list (a deep link, a search, Done or Cancelled) waits for it, as before", () => {
    const r = firstRender({ leanFirst: false, holdWhole: true }, { lean: posted("a") });
    expect(r).toEqual({ loading: true, partial: false, ids: [], wholeSent: true });
  });

  it("a cached whole list wins over the lean one and is revalidated", () => {
    const r = firstRender({ leanFirst: true, holdWhole: true }, { lean: posted("a"), whole: posted("a", "z") });
    expect(r.partial).toBe(false);
    expect(r.loading).toBe(false);
    expect(r.ids).toEqual(["a", "z"]);
  });
});

describe("every read of the posted jobs lists them in one order (Q2705)", () => {
  it("newest first, ties broken by id, whatever order the read returned", async () => {
    const at = "2026-11-08T18:28:13.691+00:00";
    const job = (id: string, created_at: string) => ({ id, status: "in_progress", customer_id: "u1", title: id, created_at });
    const payload = (jobs: unknown[]) => ({ posted_jobs: jobs, poster_applications: [], offer_targets: [], open_continue_days: [] });
    const a = [job("j2", at), job("j9", "2026-11-09T10:00:00+00:00"), job("j5", at), job("j1", "2026-11-01T00:00:00+00:00"), job("j7", at)];
    cores.payload = payload(a);
    const first = (await fetchPostedActivity("u1")).postedJobs.map((j) => j.id);
    cores.payload = payload([...a].reverse());
    const second = (await fetchPostedActivity("u1", { lean: true })).postedJobs.map((j) => j.id);
    cores.payload = null;
    expect(first).toEqual(["j9", "j7", "j5", "j2", "j1"]);
    expect(second).toEqual(first);
  });
});
