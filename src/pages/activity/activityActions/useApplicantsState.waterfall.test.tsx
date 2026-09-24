// Q239 — opening Applicants was a 3-hop waterfall: applications, THEN the
// userBlocks chunk + block-list read, THEN profiles. The block list does not
// depend on the applications, so it must be asked for before the
// applications answer. Fail-closed is kept: a failed block read with
// applicants is an error state, never a list that shows a blocked person.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const calls: string[] = [];
let releaseApps: (v: unknown) => void = () => {};
const blocks = { current: { data: [] as unknown[], error: null as unknown } };
const apps = { current: [] as unknown[] };

function builder(table: string) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "in"]) self[m] = () => self;
  self.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    calls.push(table);
    if (table === "applications") releaseApps = () => resolve({ data: apps.current, error: null });
    else if (table === "user_blocks") resolve(blocks.current);
    else resolve({ data: [], error: null });
    return Promise.resolve().then(() => undefined, reject);
  };
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t), rpc: async () => ({ data: [], error: null }) },
}));
vi.mock("@/lib/reviewStats", () => ({ fetchRatingStats: async () => new Map() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { useApplicantsState } from "./useApplicantsState";

const USER = { id: "poster-1" } as never;

describe("Applicants load is not a waterfall (Q239)", () => {
  beforeEach(() => { calls.length = 0; blocks.current = { data: [], error: null }; apps.current = []; });

  it("asks for the block list BEFORE the applications answer", async () => {
    apps.current = [{ id: "a1", job_id: "j1", helper_id: "h1" }];
    const { result } = renderHook(() => useApplicantsState(USER));
    act(() => { void result.current.loadInlineApplicants("j1"); });
    await waitFor(() => expect(calls).toContain("applications"));
    await waitFor(() => expect(calls).toContain("user_blocks"));   // applications still unanswered
    await act(async () => { releaseApps(undefined); });
    await waitFor(() => expect(result.current.loadingApplicants.j1).toBe(false));
    expect(result.current.applicantErrors.j1).toBe(false);
  });

  it("stays fail-closed: a failed block read with applicants is an error, not a list", async () => {
    apps.current = [{ id: "a1", job_id: "j1", helper_id: "h1" }];
    blocks.current = { data: null as never, error: { message: "boom" } };
    const { result } = renderHook(() => useApplicantsState(USER));
    act(() => { void result.current.loadInlineApplicants("j1"); });
    await waitFor(() => expect(calls).toContain("applications"));
    await act(async () => { releaseApps(undefined); });
    await waitFor(() => expect(result.current.applicantErrors.j1).toBe(true));
    expect(result.current.inlineApplicants.j1).toBeUndefined();
  });

  it("zero applicants still reads as empty even if the block read failed", async () => {
    blocks.current = { data: null as never, error: { message: "boom" } };
    const { result } = renderHook(() => useApplicantsState(USER));
    act(() => { void result.current.loadInlineApplicants("j1"); });
    await waitFor(() => expect(calls).toContain("applications"));
    await act(async () => { releaseApps(undefined); });
    await waitFor(() => expect(result.current.loadingApplicants.j1).toBe(false));
    expect(result.current.applicantErrors.j1).toBe(false);
    expect(result.current.inlineApplicants.j1).toEqual([]);
  });
});

// The waterfall back: the applications answer awaited before the block list is asked for.
// @mutate src/pages/activity/activityActions/useApplicantsState.ts | const blockedPromise: Promise<Set<string>> = user | await supabase.from("applications").select("*").eq("job_id", jobId);\n    const blockedPromise: Promise<Set<string>> = user
