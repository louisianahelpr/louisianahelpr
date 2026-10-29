/**
 * BROWSE SEARCH FINDS A JOB BY ITS CATEGORY (audit 2026-10-28 A2-C22).
 *
 * The bug: Browse's search matched only a job's title and description, so "yard" found nothing although the job
 * sat under "Yard work". The fix: the category whose shown name contains the words counts as a match, in every
 * place Browse searches, from one helper (categoriesMatchingSearch): the list (useDashboardFilters), its server
 * count (useDashboardJobsCount, so the "N jobs" header agrees with the list) and the map (buildMapJobFilter).
 *
 * @mutate src/hooks/useDashboardFilters.ts | && !searchCategories.includes(job.category)) return false; | ) return false;
 * @mutate src/hooks/useDashboardJobsCount.ts | ${cats.length ? `,category.in.(${cats.join(",")})` : ""} | ${""}
 * @mutate src/components/browseMap/mapFilter.ts | && !searchCategories.includes(job.category)) return false; | ) return false;
 * @mutate src/lib/jobCategories.ts | JOB_CATEGORY_LABELS[c].toLowerCase().includes(q) | c === q
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { categoriesMatchingSearch, JOB_CATEGORY_VALUES } from "@/lib/jobCategories";
import { buildMapJobFilter } from "@/components/browseMap/mapFilter";
import type { MapJob } from "@/components/browseMap/config";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

// The count hook's query: record every `.or(...)` it sends.
const orCalls: string[] = [];
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "neq", "lte", "eq", "gte", "gt", "not", "in"]) b[m] = () => b;
  b.or = (s: string) => { orCalls.push(s); return b; };
  b.then = (resolve: (v: { count: number; error: null }) => void) => resolve({ count: 0, error: null });
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => builder(), rpc: async () => ({ data: null, error: null }) } }));
vi.mock("@/hooks/useMembershipsOn", () => ({ useMembershipsOn: () => false }));
vi.mock("@/hooks/useUserLocation", () => ({ useUserLocation: () => ({ status: "idle" }) }));

import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { useDashboardJobsCount } from "@/hooks/useDashboardJobsCount";

const OLD_ENOUGH = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const job = (id: string, title: string, category: string) =>
  ({ id, customer_id: "c-1", title, description: "Two hours.", category, budget: 50, location: "Baton Rouge", parish: "East Baton Rouge",
     date_needed: jobLocalDateISO(1), start_time: "flexible", status: "open", is_urgent: false, isBoosted: false, expires_at: null,
     posterSubscriptionTier: null, created_at: OLD_ENOUGH }) as unknown as EnrichedJob;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe("Browse search matches the category a job sits under (A2-C22)", () => {
  it("the helper: 'yard' names Yard work; case and spaces do not matter; nothing typed names nothing", () => {
    expect(JOB_CATEGORY_VALUES.length).toBeGreaterThan(5);
    expect(categoriesMatchingSearch("yard")).toContain("yard_work");
    expect(categoriesMatchingSearch("  YARD ")).toContain("yard_work");
    expect(categoriesMatchingSearch("")).toEqual([]);
    expect(categoriesMatchingSearch("zzqx")).toEqual([]);
  });

  it("the list: 'yard' keeps the job titled 'Mow and weed eat' under Yard work, and drops a cleaning job", () => {
    const { result } = renderHook(
      () => useDashboardFilters({ allJobs: [job("a", "Mow and weed eat", "yard_work"), job("b", "Deep clean kitchen", "cleaning")], userId: undefined,
        profile: null, helprTier: null, helperAvailability: [], effectiveFee: 12, dismissedJobIds: undefined, savedOnlyJobIds: null }),
      { wrapper },
    );
    act(() => result.current.setSearchQuery("yard"));
    expect(result.current.filteredJobs.map((j) => j.id)).toEqual(["a"]);
  });

  it("the count asks the server for the same category", async () => {
    orCalls.length = 0;
    renderHook(() => useDashboardJobsCount({ userId: undefined, selectedCategory: null, searchQuery: "yard", minBudget: "", maxBudget: "",
      urgentOnly: false, boostedOnly: false, expiresWithin: "", earlyAccessTier: null, appliedJobIds: [], blockedUserIds: [], dismissedJobIds: [],
      savedOnlyJobIds: null }), { wrapper });
    await waitFor(() => expect(orCalls.some((s) => s.startsWith("title.ilike"))).toBe(true));
    const search = orCalls.find((s) => s.startsWith("title.ilike"))!;
    expect(search).toMatch(/,category\.in\.\([^)]*yard_work[^)]*\)$/);
  });

  it("the map: 'yard' keeps the Yard work pin", () => {
    const keep = buildMapJobFilter({ searchQuery: "yard", selectedCategory: null, minBudget: "", maxBudget: "", urgentOnly: false, boostedOnly: false,
      expiresWithin: "", nearbyMiles: null, userLoc: null, whenRange: null } as unknown as Parameters<typeof buildMapJobFilter>[0]);
    expect(keep({ id: "a", title: "Mow and weed eat", category: "yard_work", budget: 50 } as unknown as MapJob)).toBe(true);
    expect(keep({ id: "b", title: "Deep clean kitchen", category: "cleaning", budget: 50 } as unknown as MapJob)).toBe(false);
  });
});
