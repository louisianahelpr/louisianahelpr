/**
 * A2-C42 (audit 2026-10-29; lead 2026-10-29): the Helpr's applied rows never read the series state
 * (fetchJobSeriesState ran for posted rows only), so on every Helpr card a split series read as one-Helpr:
 * the Leave series / Give up dates dialogs and SeriesDatesPanel's intro said nobody else was on it.
 *
 * @mutate src/hooks/useActivityData.ts |       return { ...a, job: job ? { ...job, ...appliedSeries.get(job.id) } : null, |       return { ...a, job: job ?? null,
 */
import { describe, expect, it, vi } from "vitest";

const { SERIES, ONE_OFF, asked } = vi.hoisted(() => ({
  SERIES: { id: "series-1", parent_job_id: null, recurrence_days: [6], customer_id: "p1", status: "accepted" },
  ONE_OFF: { id: "job-2", parent_job_id: null, recurrence_days: null, customer_id: "p1", status: "open" },
  asked: [] as string[][],
}));

vi.mock("@/lib/jobSeriesState", () => ({
  fetchJobSeriesState: async (ids: string[]) => {
    asked.push(ids);
    return new Map(ids.filter((id) => id === "series-1").map((id) => [id, { series_split_ok: true, series_ended_on: null }]));
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, unknown[]> = {
    applications: [
      { id: "a1", job_id: "series-1", helper_id: "h1", status: "accepted", created_at: "2026-10-01" },
      { id: "a2", job_id: "job-2", helper_id: "h1", status: "pending", created_at: "2026-10-02" },
    ],
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "or", "order", "limit", "not", "gte", "lte"]) b[m] = () => b;
    b.then = (resolve: (r: { data: unknown[]; error: null; count: number }) => unknown) =>
      resolve({ data: rows[table] ?? [], error: null, count: 0 });
    return b;
  };
  const rpcData: Record<string, unknown[]> = { get_jobs_for_my_applications: [SERIES, ONE_OFF] };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: (name: string) => ({
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => resolve({ data: rpcData[name] ?? [], error: null }),
      }),
    },
  };
});

import { fetchAppliedActivity } from "./useActivityData";

describe("the Helpr's applied rows carry the series state (A2-C42)", () => {
  it("a split series parent arrives with series_split_ok; a one-time job is not asked about", async () => {
    const { appliedApps } = await fetchAppliedActivity("h1");
    const series = appliedApps.find((a) => a.job_id === "series-1");
    // Vacuity floor: both rows came through with their jobs.
    expect(appliedApps.filter((a) => a.job).length).toBe(2);
    expect((series?.job as { series_split_ok?: boolean } | null)?.series_split_ok).toBe(true);
    expect(asked.flat()).toEqual(["series-1"]);
  });
});
