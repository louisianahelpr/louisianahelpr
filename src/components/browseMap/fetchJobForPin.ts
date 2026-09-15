/**
 * fetchJobForPin — resolve a map pin's job id to a REAL, authoritative job row.
 *
 * VN-10: tapping the map's pin-preview card did nothing whenever the pin's job
 * was not in the list's `filteredJobs`. The map and the feed do not hold the
 * same set of jobs — the feed is paginated (one page at a time) and carries its
 * own client-side filters, while `get_open_jobs_for_map` returns every open job
 * in view — so a pin for a job the feed hasn't paged in resolved to `undefined`
 * and the click was silently swallowed.
 *
 * The pin's own `MapJob` is NOT an acceptable substitute here, and that is the
 * whole reason this file exists rather than a `mapJobToEnrichedJob` call at the
 * call site: the map RPC is privacy-reduced and carries no `customer_id`, and
 * `JobDetailDialog`'s caller decides whether to show the Apply footer by
 * comparing `job.customer_id` to the viewer's id. Handing it the adapted object
 * would offer Apply on your own job (and refuse it on tap) — see the header of
 * mapJobToEnrichedJob.ts, which states the same rule.
 *
 * So: one row from the same curated `open_jobs_browse` view the feed reads
 * (masked location, server-side visibility rules intact), plus the poster
 * name/avatar the card and dialog show. Returns null when the row is gone or
 * the view refuses it — the caller says so rather than doing nothing.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EnrichedJob } from "@/components/dashboard/types";
import { formatName } from "@/lib/utils";

/**
 * The same column list `useDashboardData` selects for the feed, minus nothing:
 * the dialog reads far more of the row than the card does, and a short select
 * here would render a detail dialog that silently disagrees with the one you
 * get by tapping the very same job in the list.
 */
const BROWSE_COLUMNS =
  "id, title, description, category, budget, date_needed, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status, location, latitude, longitude, pricing_mode, applicant_count, credential_tier, parish";

export async function fetchJobForPin(jobId: string): Promise<EnrichedJob | null> {
  if (!jobId) return null;

  // `maybeSingle`, not `single`: a job that closed between the map load and the
  // tap is an expected outcome, not an error to report.
  const { data, error } = await supabase
    .from("open_jobs_browse")
    .select(BROWSE_COLUMNS)
    .eq("id", jobId)
    .maybeSingle();

  // The error is NOT dropped — it is the caller's cue to tell the user the job
  // couldn't be opened instead of leaving the tap dead, which is the defect
  // this whole file closes.
  if (error) throw error;
  if (!data) return null;

  const job = data as unknown as EnrichedJob;

  // Poster identity is a second round trip for the same reason the feed makes
  // it: `open_jobs_browse` exposes `customer_id` only, and `get_safe_profiles`
  // is the one sanctioned way to turn ids into names. A failure here degrades
  // to a nameless card, never to a dead tap.
  // A job can outlive its poster: deletion anonymises `customer_id` to null,
  // and the job row stays browsable. There is no one to look up in that case.
  const customerId = job.customer_id;
  if (!customerId) return job;

  try {
    const { data: profiles } = await supabase.rpc("get_safe_profiles", {
      user_ids: [customerId],
    });
    const poster = profiles?.[0];
    if (poster) {
      job.posterName = formatName(poster.full_name);
      job.posterAvatarUrl = poster.avatar_url ?? null;
      job.posterIdVerified =
        (poster as { is_id_verified?: boolean }).is_id_verified ?? false;
    }
  } catch {
    /* name/avatar are cosmetic here; the dialog renders without them */
  }

  return job;
}
