// Adapts a `MapJob` (the deliberately PII-reduced row `get_open_jobs_for_map`
// returns) into the shape `JobCard` needs (`EnrichedJob`) so the map's pin
// popup can render the SAME `<JobCard>` component the browse feed does,
// instead of a separately-built lookalike.
//
// `EnrichedJob` requires a few fields the privacy-reduced map RPC never
// returns (`description`, `customer_id`, `status`) — see the privacy note
// atop BrowseMap.tsx and the field list on `MapJob` in ./config. JobCard
// itself never reads any of the three for rendering (grepped: no
// `job.description` / `job.status` access in JobCard.tsx at all, and
// `job.customer_id` is only read by `prefetchJobDialog`'s touch-warm-up,
// which is a documented no-op when the id is falsy — see
// prefetchJobDialog.ts's `if (!jobId || !customerId) return;`). So the
// stand-in values below are inert placeholders, never surfaced to the
// viewer and never used for a real request.
//
// The one thing a map-sourced job must NEVER drive is the actual "open this
// job" action — this adapted object carries no real `customer_id`, so it
// must not be handed to JobDetailDialog. BrowseMap's caller (Dashboard /
// BrowseTasksFeed) already re-resolves the tapped pin's id against the
// full, authoritative job list before opening the dialog (see
// `onJobAction={(jobId) => { const job = allJobs.find(...); ... }}`) — the
// adapted job here only ever drives JobCard's own visual rendering and its
// tap surface's `onSelect`, which callers rewire to `onJobAction(job.id)`
// rather than trusting the object JobCard hands back.
import type { Database } from "@/integrations/supabase/types";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { MapJob } from "./config";

export function mapJobToEnrichedJob(job: MapJob): EnrichedJob {
  return {
    id: job.id,
    title: job.title,
    // `jobs.category` is an enum; the map RPC returns it as plain text
    // (already validated server-side by the enum column itself).
    category: job.category as Database["public"]["Enums"]["job_category"],
    budget: job.budget,
    is_urgent: job.is_urgent,
    created_at: job.created_at,
    // `date_needed` is a non-null column on `jobs`, so `EnrichedJob` types it
    // as required `string`, not `string | null` — an empty string is the
    // "no value" stand-in JobCard's own `!job.date_needed` check treats the
    // same as null (falls to the "Flexible" branch or hides the row).
    date_needed: job.date_needed ?? "",
    start_time: job.start_time ?? null,
    urgent_fee: job.urgent_fee ?? null,
    is_group_job: job.is_group_job ?? null,
    helpers_needed: job.helpers_needed ?? null,
    // Masked "City, State" when the RPC has it; parish otherwise (pre-deploy
    // RPC shape, or the rare row with no masked location). JobCard reads
    // `getCity(job.location)` with no parish fallback of its own, so this
    // adapter supplies one — matching what the old MapJobPopup did.
    location: job.location ?? (job.parish ? `${job.parish}, LA` : ""),
    // Inert placeholders — never read by JobCard, see file header.
    description: "",
    customer_id: "",
    status: "open" satisfies Database["public"]["Enums"]["job_status"],
  };
}
