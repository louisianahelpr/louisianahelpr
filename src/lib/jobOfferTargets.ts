/**
 * Who a job's direct offer went to, for the two people allowed to know.
 *
 * OWNER DECISION 2026-09-14: `jobs.offered_to_helper_id` is readable by the
 * POSTER and the OFFERED Helpr only. A hired Helpr, a group roster member, an
 * applicant or anyone else must not learn who was offered the job. Migration
 * 20260915045110 withholds the column from every signed-in client (column
 * privilege), so it can no longer ride along on a `jobs` select, and serves it
 * through `get_job_offer_targets`, which returns a row only when the caller IS
 * the poster or IS the offeree.
 *
 * PGRST202 (RPC not deployed yet) returns an empty map without reporting: the
 * column revoke ships in the same migration, so the window is the minutes
 * between this bundle and db-deploy, and the only effect is a poster's "Direct
 * offer" filter count and an offeree's composer hint reading as "no offer".
 * Any other error is reported and degrades the same way.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * job id -> offered Helpr's user id, for jobs the caller posted or was offered.
 * `jobIds` scopes the lookup; omit it for every such job.
 */
export async function fetchJobOfferTargets(jobIds?: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = jobIds === undefined ? undefined : [...new Set(jobIds.filter(Boolean))];
  if (ids !== undefined && ids.length === 0) return out;

  const { data, error } = await supabase.rpc(
    "get_job_offer_targets",
    ids === undefined ? {} : { p_job_ids: ids },
  );
  if (error) {
    if ((error as { code?: string }).code !== "PGRST202") {
      report(error, { severity: "warning", tags: { source: "jobOfferTargets.fetchJobOfferTargets" } });
    }
    return out;
  }
  for (const row of (data ?? []) as Array<{ job_id: string | null; offered_to_helper_id: string | null }>) {
    if (row?.job_id && row?.offered_to_helper_id) out.set(row.job_id, row.offered_to_helper_id);
  }
  return out;
}
