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
// The map RPC deliberately returns a narrow, PII-safe row (no description, no
// expires_at, no boost flag, no date_needed), so some filters simply have no
// field to test. Those are named by `unsupportedMapFilters` and surfaced in the
// UI rather than silently ignored — a filter that appears applied but isn't is
// worse than one the app admits it can't apply here.

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

/** Filters the map has no field to evaluate, in user-facing wording. */
export function unsupportedMapFilters(f: MapJobFilterInput): string[] {
  const out: string[] = [];
  if (f.boostedOnly) out.push("Boosted");
  if (f.expiresWithin) out.push("Ending soon");
  if (f.matchAvailability) out.push("Matches my availability");
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
    return true;
  };
}
