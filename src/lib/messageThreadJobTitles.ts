/**
 * The job title for each Messages thread the caller is in (NOID-20 "a job" label, lead 2026-10-31).
 *
 * The inbox's plain `jobs` read is filtered by row security, which hides a job from someone with no role on it any
 * more (an applicant who was not picked, a closed job), so the thread used to read "a job". The server function
 * `get_message_thread_job_titles` (migration 20261101014031, SECURITY DEFINER, read-only) returns the title only for
 * jobs the caller has a message on, and nothing to anyone else.
 *
 * Enrichment, never identity: this RPC missing (PGRST202 naming it: the bundle shipped before db-deploy finished) returns an empty map without
 * reporting; any other error is reported and degrades the same way, to the jobs read's own title or "a job".
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { isMissingRpcNamed } from "@/lib/missingRpc";

export async function fetchMessageThreadJobTitles(jobIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(jobIds.filter(Boolean))].slice(0, 500);
  if (ids.length === 0) return out;
  const { data, error } = await supabase.rpc("get_message_thread_job_titles", { p_job_ids: ids });
  if (error) {
    if (!isMissingRpcNamed(error, "get_message_thread_job_titles")) report(error, { severity: "warning", tags: { source: "fetchMessageThreadJobTitles" } });
    return out;
  }
  for (const r of (data ?? []) as Array<{ job_id: string; title: string | null }>) if (r.title) out.set(r.job_id, r.title);
  return out;
}
