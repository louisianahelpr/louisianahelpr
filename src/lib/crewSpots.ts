import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Q1409 (owner, 2026-10-05): a booked crew a member left is RE-LISTED until its
 * start, and the browse card says how many spots are open. The count is
 * public.crew_spots_open (20261006023437), projected by open_jobs_browse as
 * `crew_spots_open`: a crew's roster is private, so the client cannot count it.
 *
 * Read AFTER the main list, in its own query, never in the feed's select: a
 * web deploy can reach users before db-deploy adds the column, and a select of
 * a missing column fails the WHOLE feed. Here it costs only the count; the
 * card then shows the crew's size as before. Best effort, reported.
 */
export async function fetchCrewSpotsOpen(jobIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (jobIds.length === 0) return out;
  const { data, error } = await supabase
    .from("open_jobs_browse")
    .select("id, crew_spots_open")
    .in("id", [...jobIds]);
  if (error) {
    report(error, { severity: "warning", tags: { source: "crewSpots.fetchCrewSpotsOpen" } });
    return out;
  }
  for (const row of data ?? []) {
    if (row.id && typeof row.crew_spots_open === "number") out.set(row.id, row.crew_spots_open);
  }
  return out;
}
