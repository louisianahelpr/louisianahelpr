/**
 * A GUEST READS NO POSTER ID, AND THE FEED STILL SHOWS (jobs audit 10-30). The first fix returned NULL from
 * open_jobs_browse for a guest, and useDashboardFilters' ownerless cull emptied /browse (WebKit: 3 cards -> 0).
 * The view now returns all zeros, because the phone apps carry that cull in their own bundle. These run the real
 * filter hook on the row shape a guest gets; the view itself is proved in guestsGetNoPosterIdOrStreet.pglite.mjs.
 *
 * @mutate src/pages/home/guestPosterIds.ts | !!id && id !== GUEST_POSTER_ID | !!id
 * @mutate src/pages/home/guestPosterIds.ts | export const GUEST_POSTER_ID = "00000000-0000-0000-0000-000000000000"; | export const GUEST_POSTER_ID = "";
 * @mutate src/components/dashboard/JobDetailDialog.tsx |   const cornerActions = !guest && ( |   const cornerActions = (
 * @mutate src/hooks/useDashboardFilters.ts | allJobs.filter((j) => !!j.customer_id) | allJobs.filter((j) => !!j.customer_id && j.customer_id !== "00000000-0000-0000-0000-000000000000")
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { blankSqlComments } from "./helpers/blankNonCode";
import { jobLocalDateISO } from "./helpers/jobLocalDate";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({}),
    rpc: () => ({}),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useMembershipsOn", () => ({ useMembershipsOn: () => false }));
vi.mock("@/hooks/useUserLocation", () => ({ useUserLocation: () => ({ status: "idle" }) }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));
vi.mock("@/hooks/useDashboardJobsCount", () => ({ useDashboardJobsCount: () => ({ data: undefined, isLoading: false }) }));

import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import JobDetailDialog from "@/components/dashboard/JobDetailDialog";
import { GUEST_POSTER_ID, guestPosterIds } from "@/pages/home/guestPosterIds";

const OLD_ENOUGH = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const job = (id: string, customer_id: string | null) =>
  ({ id, customer_id, title: id, description: "A job.", photos: [], category: "moving", budget: 80, status: "open", location: "New Orleans", parish: "Orleans", date_needed: jobLocalDateISO(1), start_time: "flexible", created_at: OLD_ENOUGH, is_urgent: false, isBoosted: false, expires_at: null, posterSubscriptionTier: null }) as unknown as EnrichedJob;
const feed = (jobs: EnrichedJob[], userId?: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
  return renderHook(() => useDashboardFilters({ allJobs: jobs, userId, profile: null, helprTier: null, helperAvailability: [], effectiveFee: 10 }), { wrapper }).result.current;
};

describe("a guest's rows carry no poster id and still reach the feed", () => {
  it("the client's id is the one the view returns to anon", () => {
    const sql = blankSqlComments(readFileSync(resolve(__dirname, "../../supabase/migrations/20261031000945_guests_get_no_poster_id_or_street.sql"), "utf8"));
    expect(sql).toContain(`CASE WHEN CURRENT_USER = 'anon'::name THEN '${GUEST_POSTER_ID}'::uuid ELSE customer_id END AS customer_id`);
  });

  it("every guest row is in the feed", () => {
    const f = feed([job("a", GUEST_POSTER_ID), job("b", GUEST_POSTER_ID), job("c", GUEST_POSTER_ID)]);
    expect(f.filteredJobs.map((j) => j.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("a real ownerless row is still culled, for a guest and for a member: signed-in readers are unchanged", () => {
    expect(feed([job("gone", null), job("live", GUEST_POSTER_ID)]).filteredJobs.map((j) => j.id)).toEqual(["live"]);
    expect(feed([job("gone", null), job("live", "poster-1")], "member-1").filteredJobs.map((j) => j.id)).toEqual(["live"]);
  });

  it("a member's own job still leaves their feed: they read real ids", () => {
    expect(feed([job("mine", "member-1"), job("theirs", "poster-1")], "member-1").filteredJobs.map((j) => j.id)).toEqual(["theirs"]);
  });

  it("the guest's job sheet treats the zero id as nobody: no profile link, no message, no report", () => {
    const onReport = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <JobDetailDialog guest job={job("a", GUEST_POSTER_ID)} effectiveFee={10} onClose={vi.fn()} onApply={vi.fn()} onReport={onReport} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
    expect(document.querySelector(`a[href*="${GUEST_POSTER_ID}"]`)).toBeNull();
    expect(document.querySelector('a[href*="/user/"], a[href*="/messages"]')).toBeNull();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    expect(names.filter((n) => /message|report|ask a question/i.test(n))).toEqual([]);
  });

  it("the guest feed looks up no profile for the all-zero id, nor for a null", () => {
    expect(guestPosterIds([job("a", GUEST_POSTER_ID), job("b", null)])).toEqual([]);
    expect(guestPosterIds([job("a", "poster-1"), job("b", "poster-1"), job("c", GUEST_POSTER_ID)])).toEqual(["poster-1"]);
  });
});
