// Q239 — opening Applicants was a 3-hop waterfall: applications, THEN the
// userBlocks chunk + block-list read, THEN profiles. Q341 removed the middle
// hop entirely: the poster's SELECT policy on `applications` excludes blocked
// applicants server-side (20260924020956), so the panel reads applications and
// goes straight to profiles. A user_blocks read here would be both a wasted
// round trip and a second, client-side definition of "blocked" that the
// counters do not share — the disagreement Q341 was.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const calls: string[] = [];
const apps = { current: [] as unknown[] };

function builder(table: string) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "in"]) self[m] = () => self;
  self.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    calls.push(table);
    if (table === "applications") resolve({ data: apps.current, error: null });
    else resolve({ data: [], error: null });
    return Promise.resolve().then(() => undefined, reject);
  };
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: async (fn: string) => {
      calls.push(`rpc:${fn}`);
      return { data: [], error: null };
    },
  },
}));
vi.mock("@/lib/reviewStats", () => ({ fetchRatingStats: async () => new Map() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

import { useApplicantsState } from "./useApplicantsState";

const USER = { id: "poster-1" } as never;

describe("Applicants load: no client-side block read (Q239, Q341)", () => {
  beforeEach(() => { calls.length = 0; apps.current = []; });

  it("reads applications, then profiles — never user_blocks", async () => {
    apps.current = [{ id: "a1", job_id: "j1", helper_id: "h1" }];
    const { result } = renderHook(() => useApplicantsState(USER));
    act(() => { void result.current.loadInlineApplicants("j1"); });
    await waitFor(() => expect(result.current.loadingApplicants.j1).toBe(false));
    expect(result.current.applicantErrors.j1).toBe(false);
    expect(result.current.inlineApplicants.j1).toHaveLength(1);
    expect(calls[0]).toBe("applications");
    expect(calls).toContain("rpc:get_safe_profiles");
    expect(calls, "the server policy filters blocks; a client read duplicates it").not.toContain("user_blocks");
  });

  it("every row the server returns is shown (the server already hid blocked applicants)", async () => {
    apps.current = [
      { id: "a1", job_id: "j1", helper_id: "h1" },
      { id: "a2", job_id: "j1", helper_id: "h2" },
    ];
    const { result } = renderHook(() => useApplicantsState(USER));
    act(() => { void result.current.loadInlineApplicants("j1"); });
    await waitFor(() => expect(result.current.loadingApplicants.j1).toBe(false));
    expect(result.current.inlineApplicants.j1?.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("zero applicants reads as empty", async () => {
    const { result } = renderHook(() => useApplicantsState(USER));
    act(() => { void result.current.loadInlineApplicants("j1"); });
    await waitFor(() => expect(result.current.loadingApplicants.j1).toBe(false));
    expect(result.current.applicantErrors.j1).toBe(false);
    expect(result.current.inlineApplicants.j1).toEqual([]);
    expect(calls).not.toContain("user_blocks");
  });
});

// The client-side block read back, ahead of the applications read.
// @mutate src/pages/activity/activityActions/useApplicantsState.ts | const { data: apps, error: appsError } = await supabase.from("applications") | await supabase.from("user_blocks").select("*").eq("blocker_id", jobId);\n    const { data: apps, error: appsError } = await supabase.from("applications")
