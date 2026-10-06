import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { fetchCrewSpotsOpen } from "@/lib/crewSpots";
import { GUEST_JOBS_LIMIT, GUEST_JOBS_SELECT, takeGuestJobsPrefetch } from "@/lib/guestJobsQuery";
import { readJobsAheadOfDb } from "@/lib/jobColumns";
import type { EnrichedJob } from "@/components/dashboard/types";

/**
 * The signed-out feed's job list (DashboardGuest's queryFn, moved here whole).
 *
 * Q206: the entry started this exact read beside the app download
 * (src/boot/guestJobsPrefetch.ts). Taken once; if it failed or is old, ask
 * Supabase as before.
 *
 * Q1409: then, as the signed-in feed does, each crew's open-spot count is read
 * in its own best-effort query (src/lib/crewSpots.ts says why it is never in
 * the select): a crew card shows its size until it is known.
 */
export async function fetchGuestJobs(): Promise<EnrichedJob[]> {
  const prefetched = await takeGuestJobsPrefetch();
  // Q1461: the select names materials_note, which a database behind this
  // build may not have yet; readJobsAheadOfDb asks again without it.
  const rawJobs = prefetched ?? unwrap(
    await readJobsAheadOfDb(GUEST_JOBS_SELECT, (columns) => supabase
      .from("open_jobs_browse")
      // `latitude, longitude` are the view's MASKED coordinates (rounded
      // to 2dp ≈ 1.1km — 20260903031231), and they are what makes the
      // "Nearby" radius chip a real filter on this surface (BD-001).
      // `credential_tier`, `parish` — same column parity fix as the
      // authed feed (useDashboardData.ts), see 20260904031002.
      .select(columns)
      .neq("payment_status", "abandoned")
      .order("boosted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(GUEST_JOBS_LIMIT)),
  );

  const now = new Date();
  // The prefetch (Q206) hands back the same rows untyped (unknown[]).
  type GuestJobRow = { id: string; is_group_job?: boolean | null; expires_at: string | null; boost_expires_at: string | null };
  const live = ((rawJobs ?? []) as GuestJobRow[]).filter((j) => !j.expires_at || new Date(j.expires_at) > now);
  const crewSpots = await fetchCrewSpotsOpen(live.filter((j) => j.is_group_job).map((j) => j.id));
  return live.map((j) => ({
    ...j,
    isBoosted: !!j.boost_expires_at && new Date(j.boost_expires_at) > now,
    ...(crewSpots.has(j.id) ? { crew_spots_open: crewSpots.get(j.id) } : {}),
  })) as unknown as EnrichedJob[];
}
