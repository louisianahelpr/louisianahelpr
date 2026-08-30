import type { EnrichedJob } from "@/components/dashboard/types";
import { haversineMiles } from "@/lib/geo";

/**
 * Helper-side composite-score sort for the browse-jobs feed.
 *
 * A "Smart" default that floats high-conversion jobs to the top by mixing
 * three signals every helper actually weighs when scanning the feed:
 *
 *  - **Recency**     — how fresh the post is (newer = stronger pull)
 *  - **Budget**      — how much it pays (more = stronger pull, log-scaled
 *                      so a $5000 job doesn't bury everything else)
 *  - **Proximity**   — if we know the helper's coords AND the job's coords,
 *                      jobs nearer than 10/25 miles get a bonus
 *
 * Urgency is NOT a ranking signal (owner, 2026-08-29: "urgent does not go
 * first, it's just go by when they posted it — boosted is the only one
 * that truly pins at the top"). It used to add a flat score bonus here on
 * top of the hard priority-chain override in useDashboardFilters — both
 * are gone. Urgent stays exactly what its badge says: a signal the viewer
 * reads, not a queue-jump the app applies for them.
 *
 * Pure functions on already-fetched job rows; no async, no I/O. The
 * scoring weights are intentionally hand-tuned constants — easy to read
 * and adjust without spinning up an ML pipeline.
 *
 * Filtering (open-status, etc.) happens **before** sort by the consumer.
 */

export interface HelperLocation {
  lat: number;
  lng: number;
}

/**
 * Shared "pay/date" comparator for the non-smart sort modes (highest_pay /
 * lowest_pay / ending_soon / newest). Pulled out so every place that renders
 * a slice of jobs — the main filtered feed AND the "Picked for you"
 * recommended band — orders by the SAME rule the Sort By control names.
 *
 * Before this existed, the recommended band kept its own recommendation-
 * score order regardless of `sortBy`, so changing Sort By on the unfiltered
 * Browse feed appeared to do nothing: most of the visible jobs were sitting
 * in the recommended band, which never reordered. `smart` is intentionally
 * NOT handled here — callers that support it should keep their own
 * pre-computed rank map (see `smartIndexByJobId` in useDashboardFilters);
 * for the recommended band, "smart" order is the recommendation score itself.
 */
export function compareJobsBySortMode(a: EnrichedJob, b: EnrichedJob, sortBy: string): number {
  switch (sortBy) {
    case "highest_pay": return b.budget - a.budget;
    case "lowest_pay": return a.budget - b.budget;
    case "ending_soon": return new Date(a.date_needed).getTime() - new Date(b.date_needed).getTime();
    default: return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }
}

/** Recency half-life — score halves every ~4 days of age. */
const RECENCY_HALFLIFE_MS = 4 * 24 * 60 * 60 * 1000;

/** Proximity tiers (miles → flat bonus). */
const NEAR_BONUS = 0.3;
const NEAR_MILES = 10;
const MID_BONUS = 0.15;
const MID_MILES = 25;

/**
 * Recency component: 1.0 for a job posted right now, decaying exponentially
 * with a 4-day half-life. A job posted 24h ago is ~0.84; 4 days ≈ 0.5;
 * 8 days ≈ 0.25.
 */
function recencyScore(createdAt: string | null | undefined, now: number): number {
  if (!createdAt) return 0;
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return 0;
  const ageMs = Math.max(0, now - ts);
  return Math.pow(0.5, ageMs / RECENCY_HALFLIFE_MS);
}

/**
 * Log-scaled budget component. log10(budget+1) keeps the gap between $20
 * and $100 meaningful (~0.4 vs ~0.7) while compressing $50 vs $5000 from
 * 100x down to ~2.2x. Negative / zero budgets collapse to 0.
 */
function budgetScore(budget: number | null | undefined): number {
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget <= 0) return 0;
  return Math.log10(budget + 1);
}

/**
 * Proximity component — only adds a bonus when BOTH the helper's
 * coordinates AND the job's coordinates are known. No bonus is the
 * neutral case (not a penalty) — helpers who haven't shared location
 * still get a score that ranks by recency + budget + urgency alone.
 */
function proximityBonus(
  job: Pick<EnrichedJob, "latitude" | "longitude">,
  helperLocation: HelperLocation | null | undefined,
): number {
  if (!helperLocation) return 0;
  const lat = job.latitude;
  const lng = job.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return 0;
  const miles = haversineMiles(helperLocation.lat, helperLocation.lng, lat, lng);
  if (miles <= NEAR_MILES) return NEAR_BONUS;
  if (miles <= MID_MILES) return MID_BONUS;
  return 0;
}

/**
 * Composite "smart" score. Higher = surface first. Pure — caller passes
 * `now` for deterministic tests; defaults to `Date.now()` in prod paths.
 *
 * The sum is intentionally unnormalized: each component has a small
 * dynamic range and additive composition lets one strong signal carry a
 * job up the list without any one signal dominating. Tweak weights here
 * rather than in callers.
 */
export function smartScore(
  job: Pick<EnrichedJob, "created_at" | "budget" | "latitude" | "longitude">,
  helperLocation?: HelperLocation | null,
  now: number = Date.now(),
): number {
  return (
    recencyScore(job.created_at, now) +
    budgetScore(job.budget) +
    proximityBonus(job, helperLocation)
  );
}

/**
 * Returns a new array sorted by `smartScore` descending. Does not mutate
 * the input. Status filtering is the caller's responsibility — this
 * function ranks whatever it's given.
 *
 * Stable: ties keep input order, matching JS Array#sort spec on modern
 * engines and the project's other sort helpers.
 */
export function sortJobsSmart<T extends Parameters<typeof smartScore>[0]>(
  jobs: T[],
  helperLocation?: HelperLocation | null,
  now: number = Date.now(),
): T[] {
  return jobs
    .map((job, index) => ({ job, index, score: smartScore(job, helperLocation, now) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((entry) => entry.job);
}
