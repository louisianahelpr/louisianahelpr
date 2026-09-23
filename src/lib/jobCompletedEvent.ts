/**
 * The `job_completed` analytics event (docs/OPEN.md Q222).
 *
 * COMPLETION IS A SERVER DECISION: create-payment's `release` action flips
 * jobs.status to completed when both parties have confirmed (and the 24h
 * sweep / dispute paths do it with no client at all). The client only LEARNS
 * it, from the release response: `bothDone: true`. That response is also sent
 * for a duplicate call (`alreadyReleased` / `alreadyConfirmed`, the replay
 * guard in useLifecycleHandlers), which is not a new completion.
 *
 * So every client call site that reads a release response calls this, and
 * this is the one place the event is emitted. Once per job per session (the
 * Set below), so a retry or a second handler seeing the same answer cannot
 * count one completion twice. Called from event handlers only, never render.
 *
 * Ground truth for the Q72 monitor: scripts/lib/analyticsFreshness.mjs
 * (`job_completed`).
 */
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";

export interface ReleaseResponse {
  bothDone?: boolean;
  alreadyReleased?: boolean;
  alreadyConfirmed?: boolean;
}

const emitted = new Set<string>();

/** Test hook: forget which jobs already emitted. */
export function __resetJobCompletedForTests() {
  emitted.clear();
}

/**
 * Emit job_completed when `release` says this call completed the job.
 * Returns true when it emitted. `userId` (the caller) decides the
 * first-completion variant; omitted -> no first_job_completed.
 */
export function trackJobCompleted(
  jobId: string,
  release: ReleaseResponse | null | undefined,
  source: string,
  userId?: string | null,
): boolean {
  if (!release?.bothDone || release.alreadyReleased || release.alreadyConfirmed) return false;
  if (emitted.has(jobId)) return false;
  emitted.add(jobId);
  track(AhaEvent.JobCompleted, { job_id: jobId, source });
  if (userId) void trackFirstCompletion(jobId, userId);
  return true;
}

// First-completion aha: the caller's completed jobs (either side). <= 1 covers
// the row this release just completed. Analytics must never break the flow.
async function trackFirstCompletion(jobId: string, userId: string) {
  try {
    const { count, error } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .or(`customer_id.eq.${userId},helper_id.eq.${userId}`);
    if (!error && (count ?? 0) <= 1) track(AhaEvent.FirstJobCompleted, { job_id: jobId });
  } catch { /* analytics must never break the flow */ }
}
