import { categoryLabels } from "@/components/activity/activityConstants";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { PublicJob } from "./types";

export const DEBUG_AUTH = import.meta.env.DEV;

export const ALL_CATEGORIES = Object.keys(categoryLabels);

export const PAGE_SIZE = 30;

// Two cards per virtualized row on desktop-web so the wide browse page fills
// its container instead of stranding a single narrow column in a sea of empty
// margin. The row's grid collapses to one column under `md` (phones/tablet).
export const CARDS_PER_ROW = 2;

// Cap the staggered entrance animation to roughly the first screenful of
// cards. Beyond this the per-card animationDelay would compound layout
// work on long lists for an effect nobody scrolls fast enough to see.
export const MAX_STAGGER_CARDS = 9;

// Adapt a PublicJob (anon RPC row) to the EnrichedJob shape JobCard
// expects. Guests have no poster-profile enrichment, so the poster-*
// fields are intentionally omitted — JobCard renders a neutral avatar
// fallback. `customer_id`/`status`/`description` satisfy the type;
// `isBoosted` is derived from the boost-expiry timestamp.
export const toEnrichedJob = (job: PublicJob): EnrichedJob => ({
  id: job.id,
  title: job.title,
  description: job.description ?? "",
  // The RPC returns the job_category enum; PublicJob types it loosely as
  // string. JobCard only uses it for categoryLabels/Colors lookups
  // (both keyed by string), so the cast is display-safe.
  category: job.category as EnrichedJob["category"],
  budget: job.budget,
  date_needed: job.date_needed,
  start_time: job.start_time,
  // `numeric` over PostgREST can arrive as "4.00"; EnrichedJob types this as
  // number | null (it mirrors the jobs table Row), so normalize here rather
  // than making the card defend against a string.
  estimated_hours:
    job.estimated_hours == null || Number.isNaN(Number(job.estimated_hours))
      ? null
      : Number(job.estimated_hours),
  location: job.location,
  customer_id: "",
  status: "open",
  created_at: job.created_at,
  expires_at: job.expires_at,
  is_urgent: job.is_urgent ?? false,
  urgent_fee: job.urgent_fee ?? 0,
  is_recurring: job.is_recurring ?? false,
  recurrence_interval: job.recurrence_interval,
  is_group_job: job.is_group_job ?? false,
  helpers_needed: job.helpers_needed,
  pricing_mode: job.pricing_mode ?? undefined,
  isBoosted: !!job.boost_expires_at && new Date(job.boost_expires_at) > new Date(),
});

// JobCard requires apply/report/select/save handlers. On the public
// browse page every interaction routes to /signup via the wrapping
// <Link>, so these are inert no-ops.
export const noop = () => {};
