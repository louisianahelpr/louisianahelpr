/**
 * Home's "Your sections" live counts (owner request 2026-11-01, via the lead): the Jobs card says "N open near you"
 * and the Declutter card "N items near you", read with the SAME rules their Browse screens use, so a card never
 * promises what Browse then does not show.
 *
 * Both are head-only count reads (count=exact, no rows). They load with this module, after Home's first paint
 * (useHomeSummary starts them once the page has settled), so they cost Home's first screen nothing.
 *
 * Seed and test rows: the server hides them exactly as on Browse (open_jobs_browse via seed_hidden_in_discovery();
 * declutter_items' member read policy `NOT is_seed OR NOT seed_hidden_in_discovery()`), so a real member never counts
 * one.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { safeStorage } from "@/lib/safeStorage";
import { fetchDashboardJobsCount } from "@/hooks/useDashboardJobsCount";

/** Browse's "Not interested" jobs (localStorage, the key Browse writes), so the card does not count what Browse hides. */
function dismissedJobIds(): string[] {
  try {
    const stored = safeStorage.getItem("helpr_dismissed_jobs");
    const ids: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string").sort() : [];
  } catch {
    return []; // unreadable storage: nothing dismissed, as Browse reads it
  }
}

/**
 * Open jobs this member could apply to: Browse's own count read (useDashboardJobsCount) with Browse's default filters
 * (no category, search, budget, radius or "when"; Browse shows the whole state until a distance is picked). Their own
 * posts and the jobs they already applied to are left out, as Browse does. Early access: the server's gate in
 * open_jobs_browse decides (membershipsOn false only drops the client's duplicate of it). Known gap, as on Browse's
 * header: posters the member blocked are not subtracted (that list is Browse's own read), so it can run a little high.
 */
export function fetchOpenJobsNearCount(userId: string, appliedJobIds: string[]): Promise<number> {
  return fetchDashboardJobsCount({
    userId,
    selectedCategory: null,
    searchQuery: "",
    minBudget: "",
    maxBudget: "",
    urgentOnly: false,
    boostedOnly: false,
    expiresWithin: "",
    jobWhen: "",
    earlyAccessTier: null,
    membershipsOn: false,
    appliedJobIds: [...appliedJobIds].sort(),
    blockedUserIds: [],
    dismissedJobIds: dismissedJobIds(),
    savedOnlyJobIds: null,
  });
}

/**
 * Listings for sale this member can see: Declutter Browse's read (fetchLiveItems: live and reserved, RLS decides)
 * minus their own listings, as Browse drops them. Any distance, as Browse's default.
 */
export async function fetchDeclutterNearCount(userId: string): Promise<number> {
  const result = await supabase
    .from("declutter_items")
    .select("id", { count: "exact", head: true })
    .in("status", ["live", "reserved"])
    .neq("seller_id", userId);
  unwrap(result);
  return result.count ?? 0;
}
