// Client-side filtering for the Browse map.
//
// WHY THIS EXISTS: the map used to ignore filters entirely. `<BrowseMap>` runs
// its own `get_open_jobs_for_map` fetch and rendered every pin it got back, so
// tapping "Errands" (or any chip, or the filter sheet) changed the list and did
// nothing at all to the map — the reported "I clicked errands filter and it
// didn't filter".
//
// It can't just reuse the list's `filteredJobs`: that list is paginated by
// infinite scroll, so intersecting on id would shrink the map to whatever
// pages happen to be loaded. The map holds every open job, so it has to apply
// the same predicate to its own rows.
//
// The map RPC returns a narrow, PII-safe row, so for a long time some filters
// had no field to test. Those were named by `unsupportedMapFilters` and shown
// in the UI rather than silently ignored — a filter that appears applied but
// isn't is worse than one the app admits it can't apply.
//
// 2026-09-21: that honesty was not enough. Owner, third report of the class —
// "the map still shows 6 jobs but 3 on the left ... when i apply they fall off
// the left but not the map." Naming a filter as unsupported still leaves two
// surfaces disagreeing in front of the user.
//
// So the fields came to the map instead. `boost_expires_at` and `expires_at`
// are now projected by `get_open_jobs_for_map` (20260921173413, corrected by
// 20260921201657 — the first cut projected `boosted_at`, "ever boosted", which
// would have put expired boosts on the map while the list showed only live
// ones: a new divergence in the exact place being fixed) — and
// availability needs only `date_needed` + `start_time`, which the RPC has
// returned since 20260823120000 and nothing ever wired up. All three are
// evaluated here now. `unsupportedMapFilters` survives for the deploy window
// only: until db-deploy lands, the two new keys are ABSENT and the map says so
// rather than pretending.

import { haversineMiles } from "@/lib/geo";
import type { MapJob } from "./config";

export interface MapJobFilterInput {
  selectedCategory: string | null;
  searchQuery: string;
  minBudget: string;
  maxBudget: string;
  urgentOnly: boolean;
  boostedOnly: boolean;
  expiresWithin: string;
  matchAvailability: boolean;
  nearbyMiles: number | null;
  /** Viewer coords, only when already resolved — never prompt for the map. */
  userLoc: { lat: number; lng: number } | null;
  /**
   * Subscription "early access" delay in ms. The list hides jobs younger than
   * this for free/lower tiers; without it here the map leaked exactly the
   * fresh jobs the perk is meant to gate. 0 = show everything immediately.
   */
  earlyAccessDelayMs: number;
  /**
   * The viewer's weekly availability, same rows the list's `matchAvailability`
   * predicate reads. Empty = the filter cannot narrow anything, which is how
   * the list behaves too (`matchAvailability && helperAvailability.length > 0`).
   */
  helperAvailability?: ReadonlyArray<{
    day_of_week: number;
    is_available: boolean;
    start_time: string | null;
    end_time: string | null;
  }>;
}

/**
 * Whether the viewer has narrowed the board at all. Drives the pin-count
 * badge wording ("7 matches" vs "7 jobs") and the empty-state copy, so an
 * empty map reads as "your filters matched nothing", not "Louisiana is quiet".
 *
 * Deliberately counts filters the map CAN'T apply (`boostedOnly` and friends)
 * too: from the viewer's side those are still filters they turned on, and
 * `unsupportedMapFilters` is what explains the difference.
 */
export function isAnyFilterActive(f: MapJobFilterInput): boolean {
  return Boolean(
    f.selectedCategory ||
      f.searchQuery.trim() ||
      f.minBudget ||
      f.maxBudget ||
      f.urgentOnly ||
      f.boostedOnly ||
      f.expiresWithin ||
      f.matchAvailability ||
      f.nearbyMiles !== null,
  );
}

/**
 * Filters the map has no field to evaluate, in user-facing wording.
 *
 * Decided from the ROWS, not from a hand-kept list: a key that is absent means
 * the deployed RPC predates 20260921173413 and genuinely cannot be filtered on.
 * Once db-deploy lands this returns [] and the chips stop appearing, with no
 * second change needed — which is the point, because the previous version was
 * a static list that stayed true long after it stopped being true.
 *
 * `matchAvailability` is no longer here at all: it needs only `date_needed`
 * and `start_time`, which the RPC has always returned. It was never
 * unsupported — just never wired up.
 */
export function unsupportedMapFilters(f: MapJobFilterInput, jobs: readonly MapJob[] = []): string[] {
  const sample = jobs[0];
  const has = (k: keyof MapJob) => sample === undefined || k in sample;
  const out: string[] = [];
  if (f.boostedOnly && !has("boost_expires_at")) out.push("Boosted");
  if (f.expiresWithin && !has("expires_at")) out.push("Ending soon");
  return out;
}

export function buildMapJobFilter(f: MapJobFilterInput): (job: MapJob) => boolean {
  const min = f.minBudget ? parseFloat(f.minBudget) : null;
  const max = f.maxBudget ? parseFloat(f.maxBudget) : null;
  const q = f.searchQuery.trim().toLowerCase();
  const now = Date.now();

  return (job) => {
    if (f.selectedCategory && job.category !== f.selectedCategory) return false;
    // Title only — the map RPC doesn't return `description`, so a query that
    // matches only a job's body text will match in the list and not here.
    if (q && !job.title.toLowerCase().includes(q)) return false;
    if (min !== null && !Number.isNaN(min) && Number(job.budget) < min) return false;
    if (max !== null && !Number.isNaN(max) && Number(job.budget) > max) return false;
    if (f.urgentOnly && !job.is_urgent) return false;
    if (f.nearbyMiles !== null && f.userLoc) {
      // Map rows always carry coords (that is what makes them mappable), so
      // unlike the list there is no location-string fallback path here.
      const d = haversineMiles(f.userLoc.lat, f.userLoc.lng, Number(job.latitude), Number(job.longitude));
      if (d > f.nearbyMiles) return false;
    }
    if (f.earlyAccessDelayMs > 0) {
      const age = now - new Date(job.created_at).getTime();
      if (age < f.earlyAccessDelayMs) return false;
    }

    /*
     * The three the map used to ignore. Each mirrors the list's own predicate
     * in src/hooks/useDashboardFilters.ts — deliberately the same shape, so a
     * change to one reads as obviously needing the other.
     *
     * A key that is ABSENT means the deployed RPC predates the migration; the
     * filter cannot be evaluated and `unsupportedMapFilters` is telling the
     * user so, and it must NOT cull. A key that is present and null is a real
     * answer: `boost_expires_at: null` means no live boost.
     */
    // STILL ACTIVE, not ever-boosted — the definition every other surface
    // uses. An expired boost is not a boosted job.
    if (f.boostedOnly && "boost_expires_at" in job) {
      const until = job.boost_expires_at ? new Date(job.boost_expires_at).getTime() : 0;
      if (!(until > now)) return false;
    }

    if (f.expiresWithin && "expires_at" in job) {
      if (!job.expires_at) return false; // list: `expiresWithin && !expires_at` culls
      const hoursLeft = (new Date(job.expires_at).getTime() - now) / 36e5;
      if (f.expiresWithin === "24h" && hoursLeft > 24) return false;
      if (f.expiresWithin === "3d" && hoursLeft > 72) return false;
      if (f.expiresWithin === "7d" && hoursLeft > 168) return false;
    }

    if (f.matchAvailability && (f.helperAvailability?.length ?? 0) > 0) {
      // Noon avoids the DST edge where a midnight-parsed date lands on the
      // previous day — same reason the list parses `${date}T12:00:00`.
      const jobDate = new Date(job.date_needed + "T12:00:00");
      const slot = f.helperAvailability!.find((s) => s.day_of_week === jobDate.getDay());
      if (!slot || !slot.is_available) return false;
      if (job.start_time && job.start_time !== "flexible" && slot.start_time && slot.end_time) {
        if (job.start_time < slot.start_time || job.start_time > slot.end_time) return false;
      }
    }

    return true;
  };
}
