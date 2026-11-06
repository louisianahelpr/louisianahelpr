/**
 * Home's continue days come with the activity cores (Builder 2, 2026-11-06; lead plan 11-05, OK 11-06, "Nothing slow
 * for users"): useContinueDays read job_continue_days on its own on every signed-in load with a job under way (x145 in
 * one a11y-prod run). get_my_activity_cores now carries 'active_continue_days' (20261106054856), so a load with a job
 * under way makes the cores read only. Drives the real fetchPostedActivity / fetchAppliedActivity and the real
 * useContinueDays against a fake client that counts every request:
 *   1. both cores carry the key: Home's days come from them, and NO job_continue_days read (before this fold: one more);
 *   2. a covered job with no active day reads as none (still no read);
 *   3. the key absent (an older database) or a job id no core covers: the old read, as before;
 *   4. the first answer only: an invalidation (ContinueDayOnCard) reads directly, never from the older cores;
 *   5. an answer older than the 30 s staleTime is shown, then read again at once;
 *   6. the newest get_my_activity_cores definition builds the key the client keeps (effective definition, not a file).
 * PGlite proof of the key: src/test/pglite/activityCoresActiveContinueDays.pglite.mjs.
 *
 * @mutate src/hooks/useActivityData.ts |   if (cores) keepActiveContinueDays(userId, "posted", | if (false) keepActiveContinueDays(userId, "posted",
 * @mutate src/hooks/useActivityData.ts |   if (cores) keepActiveContinueDays(userId, "applied", | if (false) keepActiveContinueDays(userId, "applied",
 * @mutate src/hooks/useContinueDays.ts |     initialData: first?.days, |     initialData: undefined,
 * @mutate src/hooks/useContinueDays.ts |     initialDataUpdatedAt: first?.at, |     initialDataUpdatedAt: Date.now(),
 * @mutate src/lib/activityCoreContinueDays.ts |     if (!k) return undefined; |     if (!k) continue;
 * @mutate src/lib/activityCoreContinueDays.ts |   if (!Array.isArray(rows)) {\n    kept.delete(part); |   if (!Array.isArray(rows)) {\n    kept.set(part, { userId, at: Date.now(), covered: new Set(coveredJobIds as string[]), byJob: new Map() });
 * @mutate supabase/migrations/20261106054856_activity_cores_carry_active_continue_days.sql |     'active_continue_days', ( |     'active_days', (
 * @mutate supabase/migrations/20261106054856_activity_cores_carry_active_continue_days.sql |        WHERE d.status IN ('proposed', 'set') |        WHERE d.status IS NOT NULL
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

type Resp = { data: unknown; error: unknown };
const rig = vi.hoisted(() => ({ issued: [] as string[], responses: {} as Record<string, Resp> }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const b: Record<string, unknown> = {};
    const done = () => {
      rig.issued.push(`from:${table}`);
      return Promise.resolve(rig.responses[table] ?? { data: [], error: null });
    };
    for (const m of ["select", "eq", "in", "is", "not", "limit"]) b[m] = () => b;
    b.order = () => done();
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => done().then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => chain(t),
      rpc: async (fn: string) => {
        rig.issued.push(`rpc:${fn}`);
        return rig.responses[`rpc:${fn}`] ?? { data: [], error: null };
      },
    },
  };
});
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { fetchPostedActivity, fetchAppliedActivity } from "@/hooks/useActivityData";
import { forgetActivityCoresRead } from "@/lib/activityCores";
import { forgetMyOpenContinueDaysRead } from "@/lib/continueDayReads";
import { useContinueDays } from "@/hooks/useContinueDays";
import { __resetActiveContinueDays } from "@/lib/activityCoreContinueDays";

const DAY = { id: "d1", job_id: "j1", proposed_by: "u1", new_date: "2099-01-02", new_start_time: "09:00:00", note: null, status: "set", helper_confirmed_at: null, proposer: "poster" };
const JOB = (id: string, customer: string) => ({ id, customer_id: customer, helper_id: "h1", status: "in_progress", date_needed: "2099-01-01", start_time: "09:00" });
const cores = (over: Record<string, unknown> = {}) => ({
  posted_jobs: [JOB("j1", "u1"), JOB("j3", "u1")], poster_applications: [], offer_targets: [],
  my_applications: [{ id: "a2", job_id: "j2", helper_id: "u1", status: "accepted" }], application_jobs: [JOB("j2", "p9")],
  direct_offers: [], violations: [], reviews: [], open_continue_days: [], active_continue_days: [DAY], ...over,
});
const dayReads = () => rig.issued.filter((c) => c === "from:job_continue_days").length;

function render(ids: string[], qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return { qc, ...renderHook(() => useContinueDays(ids), { wrapper }) };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
async function loadCores(payload: unknown) {
  rig.responses["rpc:get_my_activity_cores"] = { data: payload, error: null };
  await Promise.all([fetchPostedActivity("u1"), fetchAppliedActivity("u1")]);
}

beforeEach(() => {
  rig.issued = [];
  rig.responses = {};
  forgetActivityCoresRead();
  forgetMyOpenContinueDaysRead();
  __resetActiveContinueDays();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Home's continue days come with the activity cores", () => {
  it("both cores carry the key: the days come from them and no job_continue_days read goes out", async () => {
    await loadCores(cores());
    const before = rig.issued.length;
    const { result } = render(["j1", "j2"]);
    expect(result.current.j1?.new_date).toBe("2099-01-02");
    expect(result.current.j1?.proposer).toBe("poster");
    await settle();
    expect(dayReads()).toBe(0);
    expect(rig.issued.slice(before)).toEqual([]);
    // the cores read itself went out once (one whole read shared by both parts)
    expect(rig.issued.filter((c) => c === "rpc:get_my_activity_cores")).toHaveLength(1);
  });

  it("a covered job with no active day reads as none, with no read", async () => {
    await loadCores(cores());
    const { result } = render(["j2", "j3"]);
    await settle();
    expect(result.current).toEqual({});
    expect(dayReads()).toBe(0);
  });

  it("the key absent (older database) or a job no core covers: the old read", async () => {
    const { active_continue_days: _drop, ...older } = cores();
    void _drop;
    await loadCores(older);
    rig.responses["job_continue_days"] = { data: [{ ...DAY, job: { customer_id: "u1" } }], error: null };
    const a = render(["j1"]);
    await waitFor(() => expect(a.result.current.j1?.new_date).toBe("2099-01-02"));
    expect(dayReads()).toBe(1);
    a.unmount();

    __resetActiveContinueDays();
    forgetActivityCoresRead();
    rig.issued = [];
    await loadCores(cores());
    const b = render(["j1", "j9"]);
    await waitFor(() => expect(dayReads()).toBe(1));
    b.unmount();
  });

  it("the first answer only: an invalidation reads directly, never from the older cores", async () => {
    await loadCores(cores());
    const { qc, result } = render(["j1"]);
    expect(result.current.j1?.status).toBe("set");
    rig.responses["job_continue_days"] = { data: [], error: null }; // the day was just cleared
    await act(async () => { await qc.invalidateQueries({ queryKey: ["job-continue-days"] }); });
    await waitFor(() => expect(result.current).toEqual({}));
    expect(dayReads()).toBe(1);
  });

  it("an answer older than the staleTime is shown, then read again at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T06:00:00Z"));
    await loadCores(cores());
    vi.setSystemTime(new Date("2026-11-06T06:01:00Z")); // 60 s later
    rig.responses["job_continue_days"] = { data: [{ ...DAY, job: { customer_id: "u1" } }], error: null };
    const { result } = render(["j1"]);
    expect(result.current.j1?.new_date).toBe("2099-01-02");
    await waitFor(() => expect(dayReads()).toBe(1));
  });

  it("the newest get_my_activity_cores definition builds 'active_continue_days' with the client's filter", () => {
    const def = effectiveDefs(join(process.cwd(), "supabase/migrations")).get("get_my_activity_cores");
    const body = blankSqlComments(def?.stmt ?? "");
    expect(body).toContain("'active_continue_days', (");
    expect(body).toMatch(/WHERE d\.status IN \('proposed', 'set'\)/);
    expect(body).toMatch(/STABLE SECURITY INVOKER/);
  });
});
