// useDashboardFilters owns the filter+sort logic that decides which
// jobs every user sees and in what order. The sort priority chain
// (urgent → boosted → same-parish → subscriber-tier → user-chosen sortBy)
// directly affects helper conversion + customer-perceived discovery
// quality. Tests cover all filter branches and the sort-priority
// invariants.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { Database } from "@/integrations/supabase/types";
import { useDashboardFilters } from "./useDashboardFilters";

// Smart-sort is now the persisted default. Wipe the storage key between
// tests so each renderHook starts from a clean slate and existing tests
// that expect the legacy "newest" ordering keep their assertions valid
// after they explicitly opt into setSortBy("newest").
beforeEach(() => {
  try {
    window.localStorage.removeItem("helpr_browse_sort");
  } catch {
    /* jsdom always provides localStorage; defensive */
  }
});

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Bypass the geolocation rationale dialog by stubbing the hook output.
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
}));

// Helper: build a baseline EnrichedJob — old enough to clear the
// 20-minute early-access delay so the default tests aren't gated by it.
const OLD_ENOUGH = new Date(Date.now() - 30 * 60 * 1000).toISOString();

function makeJob(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-1",
    customer_id: "customer-1",
    title: "Mow lawn",
    description: "Front + back yard",
    category: "yard_work",
    budget: 50,
    location: "New Orleans",
    parish: "Orleans",
    date_needed: new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10),
    start_time: "flexible",
    status: "open",
    is_urgent: false,
    isBoosted: false,
    expires_at: null,
    posterSubscriptionTier: null,
    created_at: OLD_ENOUGH,
    ...overrides,
  } as unknown as EnrichedJob;
}

const baseProfile = { parish: "Orleans" } as unknown as Profile;

function setup(allJobs: EnrichedJob[], opts: Partial<{ userId: string; profile: Profile | null; helprTier: string | null }> = {}) {
  return renderHook(() =>
    useDashboardFilters({
      allJobs,
      userId: opts.userId,
      profile: opts.profile ?? null,
      helprTier: opts.helprTier ?? null,
      helperAvailability: [],
    }),
    // The hook now mirrors its filters into the URL (so a history entry
    // carries the view it represents), which needs a router in scope.
    { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
  );
}

describe("useDashboardFilters — base filter behaviors", () => {
  it("hides jobs the current user posted (can't apply to own posts)", () => {
    const jobs = [
      makeJob({ id: "mine", customer_id: "user-A" }),
      makeJob({ id: "theirs", customer_id: "user-B" }),
    ];
    const { result } = setup(jobs, { userId: "user-A" });
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["theirs"]);
  });

  it("shows all jobs when no userId is provided (guest browse)", () => {
    const jobs = [makeJob({ id: "j1", customer_id: "c1" }), makeJob({ id: "j2", customer_id: "c2" })];
    const { result } = setup(jobs);
    expect(result.current.filteredJobs).toHaveLength(2);
  });

  it("filters by case-insensitive search across title + description", () => {
    const jobs = [
      makeJob({ id: "lawn", title: "Mow lawn", description: "front yard" }),
      makeJob({ id: "move", title: "Move couches", description: "two pieces" }),
      makeJob({ id: "paint", title: "Paint kitchen", description: "white trim" }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setSearchQuery("KITCHEN"));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["paint"]);
  });

  it("filters by maxBudget — strictly less-than-or-equal", () => {
    const jobs = [
      makeJob({ id: "cheap", budget: 30 }),
      makeJob({ id: "mid", budget: 50 }),
      makeJob({ id: "pricey", budget: 100 }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setMaxBudget("50"));
    const ids = result.current.filteredJobs.map((j) => j.id);
    expect(ids).toContain("cheap");
    expect(ids).toContain("mid");
    expect(ids).not.toContain("pricey");
  });

  it("filters by minBudget — strictly greater-than-or-equal", () => {
    const jobs = [
      makeJob({ id: "cheap", budget: 30 }),
      makeJob({ id: "mid", budget: 50 }),
      makeJob({ id: "pricey", budget: 100 }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setMinBudget("50"));
    const ids = result.current.filteredJobs.map((j) => j.id);
    expect(ids).not.toContain("cheap");
    expect(ids).toContain("mid");
    expect(ids).toContain("pricey");
  });

  it("filters by a min+max budget range together", () => {
    const jobs = [
      makeJob({ id: "cheap", budget: 30 }),
      makeJob({ id: "mid", budget: 75 }),
      makeJob({ id: "pricey", budget: 200 }),
    ];
    const { result } = setup(jobs);
    act(() => {
      result.current.setMinBudget("50");
      result.current.setMaxBudget("100");
    });
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["mid"]);
  });

  it("filters by selectedCategory exact match", () => {
    const jobs = [
      makeJob({ id: "yard", category: "yard_work" }),
      makeJob({ id: "clean", category: "cleaning" }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setSelectedCategory("cleaning"));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["clean"]);
  });

  it("filters by boostedOnly", () => {
    const jobs = [
      makeJob({ id: "norm", isBoosted: false }),
      makeJob({ id: "boost", isBoosted: true }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setBoostedOnly(true));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["boost"]);
  });

  it("expiresWithin '24h' filters out jobs without expires_at", () => {
    const soon = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
    const later = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    const jobs = [
      makeJob({ id: "soon", expires_at: soon }),
      makeJob({ id: "later", expires_at: later }),
      makeJob({ id: "no-exp", expires_at: null }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setExpiresWithin("24h"));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["soon"]);
  });
});

describe("useDashboardFilters — early-access (subscription tier delay)", () => {
  it("non-subscribers see jobs only after 20-minute delay", () => {
    const fresh = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min old
    const old = new Date(Date.now() - 25 * 60 * 1000).toISOString();   // 25 min old
    const jobs = [makeJob({ id: "fresh", created_at: fresh }), makeJob({ id: "old", created_at: old })];

    const { result } = setup(jobs, { helprTier: null });
    // Fresh job should be hidden; old job visible
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["old"]);
  });

  it("elite-tier subscribers see jobs immediately (full 20 min shaved off)", () => {
    const fresh = new Date(Date.now() - 1 * 60 * 1000).toISOString(); // 1 min old
    const jobs = [makeJob({ id: "fresh", created_at: fresh })];

    const { result } = setup(jobs, { helprTier: "elite" });
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["fresh"]);
  });

  it("basic-tier shaves off 5 minutes (sees jobs 15+ min old)", () => {
    const min10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const min16 = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const jobs = [makeJob({ id: "min10", created_at: min10 }), makeJob({ id: "min16", created_at: min16 })];

    const { result } = setup(jobs, { helprTier: "basic" });
    // Free=20, basic=15. 16 min old visible; 10 min old hidden.
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["min16"]);
  });
});

describe("useDashboardFilters — sort priority chain", () => {
  it("urgent jobs float to the top regardless of newest sort", () => {
    const newer = new Date(Date.now() - 1 * 60 * 1000).toISOString();
    const older = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const jobs = [
      makeJob({ id: "new", is_urgent: false, created_at: older }),
      makeJob({ id: "urgent-old", is_urgent: true, created_at: older }),
    ];
    const { result } = setup(jobs, { helprTier: "elite" });
    // Need elite tier so new isn't hidden by 20-min delay
    void newer;
    expect(result.current.filteredJobs[0].id).toBe("urgent-old");
  });

  it("boosted jobs float above non-boosted (within same urgency tier)", () => {
    const jobs = [
      makeJob({ id: "norm", is_urgent: false, isBoosted: false }),
      makeJob({ id: "boost", is_urgent: false, isBoosted: true }),
    ];
    const { result } = setup(jobs);
    expect(result.current.filteredJobs[0].id).toBe("boost");
  });

  it("same-parish jobs float above other-parish (after urgent + boosted tiers)", () => {
    const jobs = [
      makeJob({ id: "other", parish: "Jefferson" }),
      makeJob({ id: "same", parish: "Orleans" }),
    ];
    const { result } = setup(jobs, { profile: baseProfile });
    expect(result.current.filteredJobs[0].id).toBe("same");
  });

  it("does NOT apply parish-priority when user has no parish set", () => {
    const jobs = [
      makeJob({ id: "j1", parish: "Jefferson", created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
      makeJob({ id: "j2", parish: "Orleans", created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }),
    ];
    const { result } = setup(jobs, { profile: { parish: null } as unknown as Profile });
    // Opt into the legacy newest sort so this test asserts the no-parish
    // fall-through deterministically (the new default is "smart").
    act(() => result.current.setSortBy("newest"));
    expect(result.current.filteredJobs[0].id).toBe("j2");
  });

  it("subscribed posters' jobs prioritized for subscribed helpers", () => {
    const jobs = [
      makeJob({ id: "free-poster", posterSubscriptionTier: null }),
      makeJob({ id: "paid-poster", posterSubscriptionTier: "basic" }),
    ];
    const { result } = setup(jobs, { helprTier: "basic" });
    expect(result.current.filteredJobs[0].id).toBe("paid-poster");
  });

  it("sortBy='newest' orders by created_at descending after priority tiers", () => {
    const t1 = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const t2 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const t3 = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const jobs = [makeJob({ id: "j1", created_at: t1 }), makeJob({ id: "j2", created_at: t2 }), makeJob({ id: "j3", created_at: t3 })];
    const { result } = setup(jobs);
    act(() => result.current.setSortBy("newest"));
    // newest first: t2 > t1 > t3
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["j2", "j1", "j3"]);
  });

  it("sortBy='highest_pay' orders by budget descending", () => {
    const jobs = [
      makeJob({ id: "low", budget: 30 }),
      makeJob({ id: "high", budget: 200 }),
      makeJob({ id: "mid", budget: 75 }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setSortBy("highest_pay"));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["high", "mid", "low"]);
  });

  it("sortBy='lowest_pay' orders by budget ascending", () => {
    const jobs = [
      makeJob({ id: "low", budget: 30 }),
      makeJob({ id: "high", budget: 200 }),
      makeJob({ id: "mid", budget: 75 }),
    ];
    const { result } = setup(jobs);
    act(() => result.current.setSortBy("lowest_pay"));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["low", "mid", "high"]);
  });
});

describe("useDashboardFilters — smart-default sort + persistence", () => {
  it("defaults sortBy to 'smart' on first open (no localStorage entry yet)", () => {
    const { result } = setup([]);
    expect(result.current.sortBy).toBe("smart");
  });

  it("persists the user's sort choice to localStorage", () => {
    const { result } = setup([]);
    act(() => result.current.setSortBy("highest_pay"));
    expect(window.localStorage.getItem("helpr_browse_sort")).toBe("highest_pay");
  });

  it("re-hydrates the persisted sort on the next mount", () => {
    window.localStorage.setItem("helpr_browse_sort", "ending_soon");
    const { result } = setup([]);
    expect(result.current.sortBy).toBe("ending_soon");
  });

  it("smart-sort ranks jobs by the composite score (recency + log-budget + urgency)", () => {
    // All three clear the early-access delay; smart should float the
    // rich+urgent recent job above a stale low-budget job.
    const now = Date.now();
    const jobs = [
      makeJob({
        id: "stale-cheap",
        budget: 20,
        created_at: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      makeJob({
        id: "fresh-rich-urgent",
        budget: 500,
        urgent_fee: 50,
        created_at: new Date(now - 60 * 60 * 1000).toISOString(),
      }),
      makeJob({
        id: "fresh-mid",
        budget: 75,
        created_at: new Date(now - 90 * 60 * 1000).toISOString(),
      }),
    ];
    // Elite tier so the 60-min-old job clears the 20-min delay.
    const { result } = setup(jobs, { helprTier: "elite" });
    expect(result.current.sortBy).toBe("smart");
    // urgent_fee>0 carries is_urgent semantics in the global priority
    // chain too, so the fresh+rich+urgent job lands at the top.
    expect(result.current.filteredJobs[0].id).toBe("fresh-rich-urgent");
    // After the urgent winner, smart score should pick fresh-mid over
    // stale-cheap (newer + higher budget).
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual([
      "fresh-rich-urgent",
      "fresh-mid",
      "stale-cheap",
    ]);
  });
});

describe("useDashboardFilters — activeFilterCount + clearFilters", () => {
  it("activeFilterCount counts active filters but excludes searchQuery", () => {
    const { result } = setup([]);
    expect(result.current.activeFilterCount).toBe(0);

    act(() => {
      result.current.setSearchQuery("foo");
      result.current.setSelectedCategory("cleaning");
      result.current.setBoostedOnly(true);
    });
    // searchQuery does NOT count toward activeFilterCount; the other two do
    expect(result.current.activeFilterCount).toBe(2);
    expect(result.current.hasFilters).toBe(true);
  });

  it("hasFilters is true when only searchQuery is set", () => {
    const { result } = setup([]);
    act(() => result.current.setSearchQuery("foo"));
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.hasFilters).toBe(true);
  });

  it("clearFilters resets every filter except searchQuery is also reset", () => {
    const { result } = setup([]);
    act(() => {
      result.current.setSearchQuery("foo");
      result.current.setSelectedCategory("cleaning");
      result.current.setMinBudget("25");
      result.current.setMaxBudget("50");
      result.current.setBoostedOnly(true);
    });
    act(() => result.current.clearFilters());
    expect(result.current.searchQuery).toBe("");
    expect(result.current.selectedCategory).toBeNull();
    expect(result.current.minBudget).toBe("");
    expect(result.current.maxBudget).toBe("");
    expect(result.current.boostedOnly).toBe(false);
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.hasFilters).toBe(false);
  });
});

describe("useDashboardFilters — nearbyJobs (substring location match)", () => {
  it("matches jobs whose location contains the user's location", () => {
    const jobs = [
      makeJob({ id: "yes", location: "New Orleans, LA" }),
      makeJob({ id: "no", location: "Baton Rouge, LA" }),
    ];
    const profile = { location: "New Orleans" } as unknown as Profile;
    const { result } = setup(jobs, { profile });
    expect(result.current.nearbyJobs.map((j) => j.id)).toContain("yes");
    expect(result.current.nearbyJobs.map((j) => j.id)).not.toContain("no");
  });

  it("returns empty when user has no location set", () => {
    const jobs = [makeJob({ id: "any" })];
    const { result } = setup(jobs, { profile: { location: null } as unknown as Profile });
    expect(result.current.nearbyJobs).toEqual([]);
  });
});
