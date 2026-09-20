// Regression guard for B1 (owner live-QA, 2026-09-15): the header read
// "1 job" and the map dropped a pin while the list said "Nothing today."
//
// Root cause: the list feed hides jobs the viewer already applied to
// (useDashboardData) and jobs from blocked posters, but this count queried
// `open_jobs_browse` WITHOUT those culls — so after applying to the one job
// matching your filters, the count still saw it. The fix threads the
// already-fetched applied/blocked sets down so the count excludes exactly
// what the feed excludes.
//
// These tests use a mock query builder that actually APPLIES a `NOT IN (...)`
// clause to an in-memory row set and returns the resulting count — so the
// assertion is on the number the header would show, not merely that a method
// was called (a fix is not done until its own number moves).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDashboardJobsCount, type DashboardJobsCountFilters } from "./useDashboardJobsCount";

// Two open jobs matching every filter. j-applied is the one the viewer has
// applied to; c-blocked is a poster the viewer has blocked.
const ROWS: Array<{ id: string; customer_id: string }> = [
  { id: "j-applied", customer_id: "c-normal" },
  { id: "j-visible", customer_id: "c-normal" },
  { id: "j-blocked", customer_id: "c-blocked" },
];

// Minimal PostgREST-shaped builder: filter methods return `this`; only `.not`
// with the `in` operator actually narrows (that is the clause under test).
// The builder is thenable, resolving to `{ count, error }` like a head:true
// count query.
function makeBuilder() {
  let rows = [...ROWS];
  const builder: Record<string, unknown> = {};
  const passthrough = ["select", "neq", "or", "lte", "eq", "gte", "gt"];
  for (const m of passthrough) builder[m] = () => builder;
  builder.not = (col: string, op: string, val: string) => {
    if (op === "in") {
      // val is "(a,b,c)"
      const ids = new Set(val.slice(1, -1).split(",").filter(Boolean));
      rows = rows.filter((r) => !ids.has((r as Record<string, string>)[col]));
    }
    return builder;
  };
  builder.in = (col: string, vals: string[]) => {
    const keep = new Set(vals);
    rows = rows.filter((r) => keep.has((r as Record<string, string>)[col]));
    return builder;
  };
  builder.then = (resolve: (v: { count: number; error: null }) => void) =>
    resolve({ count: rows.length, error: null });
  return builder;
}

const fromSpy = vi.fn(() => makeBuilder());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => fromSpy() },
}));

function baseFilters(over: Partial<DashboardJobsCountFilters> = {}): DashboardJobsCountFilters {
  return {
    userId: undefined,
    selectedCategory: null,
    searchQuery: "",
    minBudget: "",
    maxBudget: "",
    urgentOnly: false,
    boostedOnly: false,
    expiresWithin: "",
    earlyAccessTier: null,
    appliedJobIds: [],
    blockedUserIds: [],
    dismissedJobIds: [],
    savedOnlyJobIds: null,
    ...over,
  };
}

function run(filters: DashboardJobsCountFilters) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useDashboardJobsCount(filters), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => fromSpy.mockClear());

describe("useDashboardJobsCount — applied/blocked exclusion (B1)", () => {
  it("counts every matching job when nothing is applied or blocked", async () => {
    const { result } = run(baseFilters());
    await waitFor(() => expect(result.current.data).toBe(3));
  });

  it("EXCLUDES a job the viewer has applied to — the count matches the empty feed", async () => {
    const { result } = run(baseFilters({ appliedJobIds: ["j-applied"] }));
    // 3 candidates minus the applied one = 2. Before the fix this was 3, so the
    // header said "1 job" over a list of jobs the feed had already hidden.
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("EXCLUDES jobs from a blocked poster", async () => {
    const { result } = run(baseFilters({ blockedUserIds: ["c-blocked"] }));
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it("excludes both at once", async () => {
    const { result } = run(
      baseFilters({ appliedJobIds: ["j-applied"], blockedUserIds: ["c-blocked"] }),
    );
    await waitFor(() => expect(result.current.data).toBe(1));
  });

  it("does not emit a NOT IN clause for an empty set (PostgREST rejects `in.()`)", async () => {
    // With empty sets the builder's `.not` must never be called with `in` —
    // proven indirectly: the count is the full set and no error is thrown.
    const { result } = run(baseFilters());
    await waitFor(() => expect(result.current.data).toBe(3));
  });
});

describe("useDashboardJobsCount — dismissed / saved-only exclusion (owner 2026-09-19)", () => {
  // "map shows 7 jobs. list shows 4". Verified live on prod as the owner's
  // account: the map RPC and `open_jobs_browse` returned the SAME 8 ids, so
  // nothing diverged server-side. The three missing cards were
  // `helpr_dismissed_jobs` — a localStorage-only cull that BrowseTasksFeed
  // applied and this count did not.
  it("EXCLUDES jobs the viewer dismissed — the count matches the shorter list", async () => {
    const { result } = run(baseFilters({ dismissedJobIds: ["j-applied", "j-blocked"] }));
    // Before the fix this returned 3: the header counted both dismissed jobs
    // the feed below it had already removed.
    await waitFor(() => expect(result.current.data).toBe(1));
  });

  it("stacks with the applied/blocked culls rather than replacing them", async () => {
    const { result } = run(
      baseFilters({ appliedJobIds: ["j-applied"], dismissedJobIds: ["j-visible"] }),
    );
    await waitFor(() => expect(result.current.data).toBe(1));
  });

  it("counts ONLY saved jobs while the 'Only saved' lens is on", async () => {
    const { result } = run(baseFilters({ savedOnlyJobIds: ["j-visible"] }));
    await waitFor(() => expect(result.current.data).toBe(1));
  });

  it("answers ZERO — not the whole board — when 'Only saved' is on with nothing saved", async () => {
    // The distinction an empty array carries. Treating it as "no filter" is
    // how a list-only lens starts lying in the header: 3 jobs over 0 cards.
    const { result } = run(baseFilters({ savedOnlyJobIds: [] }));
    await waitFor(() => expect(result.current.data).toBe(0));
  });

  it("applies no saved restriction when the lens is off (null, not [])", async () => {
    const { result } = run(baseFilters({ savedOnlyJobIds: null }));
    await waitFor(() => expect(result.current.data).toBe(3));
  });
});
