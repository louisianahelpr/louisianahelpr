/**
 * Q239 — the Applicants panel loads in TWO network rounds, not a waterfall.
 *
 * Before (measured by this test on origin/main): FOUR dependent rounds before
 * the ranked list can render — (1) applications, (2) user_blocks, (3)
 * get_safe_profiles + get_public_profile_stats + profiles.available_until,
 * (4) the ranking signals (neighbor counts, completed / repeat-hire / on-time,
 * distance bands), which only started once the list rendered and
 * useApplicantSignals mounted. PostedJobsTab keeps the skeleton up while any
 * signal is pending, so the poster waited for all four (~7 s throttled).
 *
 * After: (1) applications + user_blocks together (the block list does not
 * depend on the applications), (2) profiles, ratings, availability AND every
 * ranking signal together (prefetched into the React Query cache under the
 * hook's own keys, so the hook reads a warm cache and issues nothing more).
 * Round 1 is irreducible without a server-side join: every later read needs
 * the applicant ids.
 *
 * How it counts: every Supabase call is held until the test releases the
 * whole in-flight set at once ("one round trip"); a call issued while round N
 * is being released belongs to round N+1. The count does not depend on
 * timing: a round is released only once nothing new has started for 50 ms.
 */
// @mutate src/pages/activity/activityActions/useApplicantsState.ts | const blockedReq = user ? getBlockedUserIds(user.id) : Promise.resolve(new Set<string>());\n    const [{ data: apps, error: appsError }, blockedSet] = await Promise.all([appsReq, blockedReq]); | const { data: apps, error: appsError } = await appsReq;\n    const blockedSet = user ? await getBlockedUserIds(user.id) : new Set<string>();
// @mutate src/pages/activity/activityActions/useApplicantsState.ts |     if (signalsJobId) prefetchApplicantSignals(queryClient, visibleApps.map((a) => a.helper_id), signalsJobId); |     void signalsJobId;
// @mutate src/components/activity/postedJobs/useApplicantSignals.ts |   void queryClient.prefetchQuery(onTimeQuery(helperIds)); |   void queryClient.prefetchQuery({ ...onTimeQuery(helperIds), queryKey: ["on-time-stale-key"] });
// @mutate src/pages/activity/activityActions/useApplicantsState.ts |       const enriched = await fetchApplicants(job.id, job.id); |       const enriched = await fetchApplicants(job.id);
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type Call = { round: number; label: string; resolve: () => void };
const state: { round: number; inFlight: Call[]; log: Call[] } = { round: 1, inFlight: [], log: [] };

const APPS = [
  { id: "a1", job_id: "job-1", helper_id: "h1", created_at: "2026-09-01T00:00:00Z", status: "pending" },
  { id: "a2", job_id: "job-1", helper_id: "h2", created_at: "2026-09-02T00:00:00Z", status: "pending" },
  { id: "a3", job_id: "job-1", helper_id: "h3", created_at: "2026-09-03T00:00:00Z", status: "pending" },
];
const DATA: Record<string, unknown> = {
  "from:applications": APPS,
  "from:user_blocks": [],
  "from:profiles": APPS.map((a) => ({ user_id: a.helper_id, available_until: null })),
  "rpc:get_safe_profiles": APPS.map((a) => ({ user_id: a.helper_id, full_name: a.helper_id })),
  "rpc:get_public_profile_stats": [],
  "rpc:get_neighbor_hire_count": 0,
  "rpc:get_helper_completed_counts": [],
  "rpc:get_helper_repeat_hire_percents": [],
  "rpc:get_helper_on_time_percents": [],
  "rpc:get_helper_distances_from_job": [],
};

/** A thenable that is only answered when the test releases its round. */
function held(label: string) {
  let settle!: (v: unknown) => void;
  const p = new Promise((r) => (settle = r));
  const call: Call = { round: state.round, label, resolve: () => settle({ data: DATA[label] ?? null, error: null }) };
  state.inFlight.push(call);
  state.log.push(call);
  return p;
}

function builder(label: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "lte", "order", "limit"]) b[m] = () => b;
  let p: Promise<unknown> | null = null;
  b.then = (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) => (p ??= held(label)).then(ok, no);
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(`from:${t}`),
    rpc: (name: string) => builder(`rpc:${name}`),
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { useApplicantsState } from "./useApplicantsState";
import { useApplicantSignals } from "@/components/activity/postedJobs/useApplicantSignals";
import type { Job } from "@/components/activity/activityConstants";

function usePanel() {
  const s = useApplicantsState({ id: "poster-1" } as never);
  const signals = useApplicantSignals(s.applications, s.selectedJob);
  return { ...s, ...signals };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Release every in-flight call as one round trip; returns how many rounds ran. */
async function drain(done: () => boolean): Promise<number> {
  let rounds = 0;
  for (let guard = 0; guard < 20; guard++) {
    // Let everything that can start without the network start (a lazy
    // import is not a round trip here), then let the round's stragglers join.
    for (let i = 0; i < 300 && state.inFlight.length === 0 && !done(); i++) await act(async () => { await sleep(10); });
    for (let i = 0; i < 5; i++) await act(async () => { await sleep(10); });
    if (state.inFlight.length === 0) break;
    rounds++;
    const batch = state.inFlight.splice(0);
    state.round++;
    await act(async () => { batch.forEach((c) => c.resolve()); });
  }
  expect(done(), `the panel finished loading; calls: ${JSON.stringify(state.log.map((c) => [c.round, c.label]))}`).toBe(true);
  return rounds;
}

describe("Applicants panel request rounds (Q239)", () => {
  beforeEach(() => {
    state.round = 1;
    state.inFlight = [];
    state.log = [];
  });

  it("the ranked list is ready after 2 network rounds, with every read accounted for", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePanel(), { wrapper });

    await act(async () => { void result.current.loadApplications({ id: "job-1" } as Job); });
    const rounds = await drain(
      () => !result.current.applicationsLoading && result.current.applications.length === 3 && !result.current.signalsPending,
    );

    const byRound = (n: number) => state.log.filter((c) => c.round === n).map((c) => c.label).sort();
    // Inventory floor: the whole panel's reads (1 apps + 1 blocks + 3 enrich + 3 neighbor + 4 batch signals).
    expect(state.log.length).toBeGreaterThan(10);
    expect(rounds, `rounds: ${JSON.stringify([1, 2, 3, 4].map(byRound))}`).toBe(2);
    expect(byRound(1)).toEqual(["from:applications", "from:user_blocks"]);
    expect(byRound(2)).toEqual([
      "from:profiles",
      "rpc:get_helper_completed_counts",
      "rpc:get_helper_distances_from_job",
      "rpc:get_helper_on_time_percents",
      "rpc:get_helper_repeat_hire_percents",
      "rpc:get_neighbor_hire_count",
      "rpc:get_neighbor_hire_count",
      "rpc:get_neighbor_hire_count",
      "rpc:get_public_profile_stats",
      "rpc:get_safe_profiles",
    ]);
    // No read is issued twice: the hook consumed the prefetched cache.
    expect(state.log.length).toBe(12);
  });
});
