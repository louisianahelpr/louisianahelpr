import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserProfileData } from "./useUserProfileData";

/**
 * Q946 (owner rule: pages under 2 s). /user/:id sent two reads on every load whose answers lost
 * to get_public_profile_stats whenever it answered: the posted-total head count and the 50-row
 * worked-timing select. They now go out only when the stats RPC gave no number. And the two pair
 * reads (every job the viewer and this person were paired on, and the completed ones) are one read:
 * its exact count gates messaging, its statuses give the "Worked together" tile.
 *
 * The hook runs for real against a recording client; each `.from("jobs")` chain is logged.
 *
 * @mutate src/pages/user/useUserProfileData.ts |       const needsPostedTotal = int(publicStats?.posted_jobs_total) === null; |       const needsPostedTotal = true;
 * @mutate src/pages/user/useUserProfileData.ts |         int(publicStats?.on_time_sample) === null \|\| int(publicStats?.revision_sample) === null; |         true;
 * @mutate src/pages/user/useUserProfileData.ts |       const needsPostedTotal = int(publicStats?.posted_jobs_total) === null; |       const needsPostedTotal = false;
 * @mutate src/pages/user/useUserProfileData.ts |         int(publicStats?.on_time_sample) === null \|\| int(publicStats?.revision_sample) === null; |         false;
 * @mutate src/pages/user/useUserProfileData.ts | .filter((j) => j.status === "completed").length | .length
 * @mutate src/pages/user/useUserProfileData.ts |       ? mutualJobsCount > 0 \|\| |       ? false \|\|
 */

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const USER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const VIEWER = "9b1c2d3e-0000-4000-8000-000000000001";

type Call = { table: string; ops: Array<[string, unknown[]]> };
const calls = vi.hoisted(() => [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>);
const rpcAnswers = vi.hoisted(() => ({}) as Record<string, { data: unknown; error: { code: string; message: string } | null }>);
const pairRows = vi.hoisted(() => ({ rows: [] as Array<{ status: string }> }));

vi.mock("@/integrations/supabase/client", () => {
  function chainFor(table: string) {
    const call = { table, ops: [] as Array<[string, unknown[]]> };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "or", "order", "limit", "lte", "gte", "is"]) {
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.single = () => Promise.resolve({ data: null, error: null });
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      const isPair = call.ops.some(([m, a]) => m === "or" && String(a[0]).includes(`customer_id.eq.${VIEWER}`));
      const answer = isPair
        ? { data: pairRows.rows, error: null, count: pairRows.rows.length }
        : { data: [], error: null, count: table === "jobs" ? 3 : 0 }; // no thread, no application
      return Promise.resolve(answer).then(res, rej);
    };
    return chain;
  }
  return {
    supabase: {
      from: (t: string) => chainFor(t),
      rpc: (name: string) => Promise.resolve(rpcAnswers[name] ?? { data: null, error: null }),
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const statsRow = {
  user_id: USER, review_count: 0, avg_rating: null, poster_review_count: 0, poster_avg_rating: null,
  completed_jobs_as_helper: 0, completed_jobs_total: 0, posted_jobs_total: 7, jobs_total: 7,
  cancelled_jobs: 0, cancellation_rate: null, on_time_sample: 0, on_time_rate: null,
  revision_sample: 0, revision_rate: null, repeat_client_sample: 0, repeat_hire_percent: null,
  is_id_verified: false, has_stripe_account: false, is_background_checked: false, has_pending_credentials: false,
};

const jobsReads = () => calls.filter((c) => c.table === "jobs");
const selectOf = (c: Call) => String(c.ops.find(([m]) => m === "select")?.[1][0] ?? "");
const isTimingRead = (c: Call) => selectOf(c).includes("helper_arrived_at") && c.ops.some(([m, a]) => m === "limit" && a[0] === 50);
const isPostedTotal = (c: Call) =>
  c.ops.some(([m, a]) => m === "select" && (a[1] as { head?: boolean } | undefined)?.head === true) &&
  c.ops.some(([m, a]) => m === "eq" && a[0] === "customer_id");
const isPairRead = (c: Call) => c.ops.some(([m, a]) => m === "or" && String(a[0]).includes(`customer_id.eq.${VIEWER}`));

beforeEach(() => {
  calls.length = 0;
  pairRows.rows = [];
  for (const k of Object.keys(rpcAnswers)) delete rpcAnswers[k];
  rpcAnswers.get_safe_profiles = { data: [{ user_id: USER, full_name: "Hallie Helper" }], error: null };
  rpcAnswers.get_public_profile_stats = { data: [statsRow], error: null };
});

async function load() {
  const { result } = renderHook(() => useUserProfileData(USER, VIEWER), { wrapper });
  await waitFor(() => expect(result.current.data?.profile).toBeTruthy());
  return result.current;
}

describe("/user/:id fallback reads are lazy (Q946)", () => {
  it("stats RPC answered: no posted-total count and no 50-row timing read; the RPC's numbers show", async () => {
    const r = await load();
    expect(jobsReads().length).toBeGreaterThan(2); // the hook really ran (floor)
    expect(jobsReads().filter(isTimingRead)).toHaveLength(0);
    expect(jobsReads().filter(isPostedTotal)).toHaveLength(0);
    expect(r.postedTotalCount).toBe(7);
  });

  it("stats RPC failed: both fallback reads go out and back the numbers", async () => {
    rpcAnswers.get_public_profile_stats = { data: null, error: { code: "57014", message: "timeout" } };
    const r = await load();
    expect(jobsReads().filter(isTimingRead)).toHaveLength(1);
    expect(jobsReads().filter(isPostedTotal)).toHaveLength(1);
    expect(r.postedTotalCount).toBe(3);
  });

  it("one pair read: its count gates messaging, its completed rows are the Worked together tile", async () => {
    pairRows.rows = [{ status: "completed" }, { status: "cancelled" }, { status: "completed" }];
    const r = await load();
    expect(jobsReads().filter(isPairRead)).toHaveLength(1);
    expect(r.mutualJobsCount).toBe(2);
    expect(r.canMessage).toBe(true);
  });

  it("paired only on a cancelled job: tile 0, messaging still open", async () => {
    pairRows.rows = [{ status: "cancelled" }];
    const r = await load();
    expect(r.mutualJobsCount).toBe(0);
    expect(r.canMessage).toBe(true);
  });
});
