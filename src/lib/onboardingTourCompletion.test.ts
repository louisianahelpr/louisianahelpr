/**
 * Whether an account has finished the Welcome tour lives on its profile. The read and the write never throw:
 * a not-yet-deployed column answers "unavailable" (read) or false (write) with no report, any other failure is
 * reported and answers "error" / false, and a write that changed no row is not taken for a success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string; code?: string } | null };
let readResult: Result = { data: null, error: null };
let writeResult: Result = { data: [], error: null };
const seen: { select: string[]; eq: Array<[string, string]>; update: Array<Record<string, unknown>> } = { select: [], eq: [], update: [] };
const reports: Array<{ tags?: Record<string, string>; severity?: string }> = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: (cols: string) => {
          seen.select.push(cols);
          return { eq: (c: string, v: string) => { seen.eq.push([c, v]); return { maybeSingle: async () => readResult }; } };
        },
        update: (patch: Record<string, unknown>) => {
          seen.update.push(patch);
          return { eq: (c: string, v: string) => { seen.eq.push([c, v]); return { select: async (cols: string) => { seen.select.push(cols); return writeResult; } }; } };
        },
      };
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({
  report: (_err: unknown, opts: { tags?: Record<string, string>; severity?: string }) => { reports.push(opts); },
}));

import { fetchTourCompletion, markTourCompleted } from "./onboardingTourCompletion";

beforeEach(() => {
  readResult = { data: null, error: null };
  writeResult = { data: [], error: null };
  seen.select = [];
  seen.eq = [];
  seen.update = [];
  reports.length = 0;
});

describe("fetchTourCompletion", () => {
  it("a stamp on the account means completed", async () => {
    readResult = { data: { onboarding_tour_completed_at: "2026-09-10T12:00:00Z" }, error: null };
    expect(await fetchTourCompletion("u1")).toEqual({ status: "completed" });
    expect(seen.select).toEqual(["onboarding_tour_completed_at"]);
    expect(seen.eq).toEqual([["user_id", "u1"]]);
  });
  it("a profile with no stamp means not completed", async () => {
    readResult = { data: { onboarding_tour_completed_at: null }, error: null };
    expect(await fetchTourCompletion("u1")).toEqual({ status: "not_completed" });
  });
  it("no profile row yet is not evidence either way", async () => {
    expect(await fetchTourCompletion("u1")).toEqual({ status: "error" });
    expect(reports).toEqual([]);
  });
  it.each([
    ["the Postgres code", { message: "column does not exist", code: "42703" }],
    ["the PostgREST code", { message: "schema cache", code: "PGRST204" }],
    ["the prose alone", { message: "Could not find the 'onboarding_tour_completed_at' column of 'profiles'" }],
  ])("a column that is not deployed yet (%s) is unavailable, with no report", async (_n, error) => {
    readResult = { data: null, error };
    expect(await fetchTourCompletion("u1")).toEqual({ status: "unavailable" });
    expect(reports).toEqual([]);
  });
  it("any other failure is an error, reported as a warning", async () => {
    readResult = { data: null, error: { message: "permission denied for table profiles", code: "42501" } };
    expect(await fetchTourCompletion("u1")).toEqual({ status: "error" });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ severity: "warning", tags: { kind: "onboarding_tour_completion_read" } });
  });
});

describe("markTourCompleted", () => {
  it("stamps the account's own row with the time now", async () => {
    writeResult = { data: [{ id: "p1" }], error: null };
    const before = Date.now();
    expect(await markTourCompleted("u1")).toBe(true);
    expect(seen.eq).toEqual([["user_id", "u1"]]);
    expect(Object.keys(seen.update[0])).toEqual(["onboarding_tour_completed_at"]);
    const stamped = Date.parse(seen.update[0].onboarding_tour_completed_at as string);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
    expect(reports).toEqual([]);
  });
  it("a write that changed no row is a failure, and is reported", async () => {
    writeResult = { data: [], error: null };
    expect(await markTourCompleted("u1")).toBe(false);
    // unwrapMutation reports the rejected write itself; this module adds its own warning after it.
    expect(reports.at(-1)).toMatchObject({ severity: "warning", tags: { kind: "onboarding_tour_completion_write" } });
  });
  it("a column that is not deployed yet is false with no report (retried next visit)", async () => {
    writeResult = { data: null, error: { message: "column profiles.onboarding_tour_completed_at does not exist", code: "42703" } };
    expect(await markTourCompleted("u1")).toBe(false);
    expect(reports).toEqual([]);
  });
});
