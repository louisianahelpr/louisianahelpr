import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation } from "@/lib/mutationResult";
import { notifyJobParty } from "@/lib/notifications";

/**
 * The poster's "Confirm arrival": ONE write, shared by the Posted card's step (useLifecycleHandlers) and the
 * job page's own button (audit 2026-10-28 F14: the page's tracker said "Confirm they arrived" and offered only
 * "Manage job"). The arrival ladder's gate is the server's (the jobs triggers); this only stamps the poster's
 * confirm and tells the hired Helpr.
 *
 * Throws when the write is refused or touches no row (unwrapMutation reports those itself); the Helpr's
 * notification never throws (notifyJobParty reports its own failure), so a lost notice never undoes a confirm.
 */
export async function confirmPosterArrival(job: { id: string; helper_id: string | null | undefined }, arrivedAt: string = new Date().toISOString()): Promise<void> {
  const jobId = job.id;
  unwrapMutation(
    await supabase.from("jobs").update({ poster_confirmed_arrival_at: arrivedAt }).eq("id", jobId).select("id"),
    {
      action: "confirm arrival",
      rejectedMessage: "We couldn't confirm arrival — this job may have already been cancelled. Refresh the page.",
      context: { jobId },
    },
  );
  // Server-built copy (Q223).
  if (job.helper_id) await notifyJobParty({ user_id: job.helper_id, job_id: jobId, template: "arrival_confirmed" });
}
