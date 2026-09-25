/**
 * Off-the-job gate: a job thread is read-only once either person in it is no
 * longer on the job.
 *
 * Owner decision 2026-09-25 (docs/OPEN.md Q407 addendum 14): once someone is
 * off a job (rejected applicant, crew member removed from the roster, declined
 * or expired offeree) neither side may start a new message with them on that
 * job; earlier messages stay readable. The server enforces it in the messages
 * INSERT gate (can_message_in_job + can_send_message_to_in_job, migrations
 * 20260925175953 and 20260925230845), which refuses with a bare 42501.
 *
 * The client never re-implements the rule. It asks the server's own read,
 * get_off_job_thread_state(job, other), which answers 'self' (the viewer is
 * off the job), 'other' (the person they are talking to is, and the viewer
 * already has a thread with them) or null. The composer is then replaced by a
 * read-only notice, the lockout's pattern (src/lib/messagingLockout.ts), so a
 * send that RLS will refuse is never offered.
 *
 * The copy names what happened, never a role: every account posts and does
 * jobs, so it must read correctly whichever side the viewer is on.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Conversation } from "@/components/messages/types";

export type OffJobState = "self" | "other";

export function offJobNotice(state: OffJobState): string {
  return state === "self"
    ? "This conversation is closed because you're no longer on this job. You can still read everything here."
    : "This conversation is closed because they're no longer on this job. You can still read everything here.";
}

export const OFF_JOB_TOAST = "This conversation is closed, so the message wasn't sent.";

/**
 * The server's answer, or null when there is nothing to say or it could not
 * be asked. Any error, including the RPC not being deployed yet (PGRST202),
 * fails open to null: the server still refuses the send, and the send path
 * keeps its ordinary handling.
 */
export async function fetchOffJobState(
  jobId: string,
  otherUserId: string | null | undefined,
): Promise<OffJobState | null> {
  if (!jobId) return null;
  // nullable-arg: _other is NULL when the other party deleted their account
  // (messages.receiver_id ON DELETE SET NULL); get_off_job_thread_state then
  // answers only for the viewer ('self' or NULL), never 'other'.
  const { data, error } = await supabase.rpc("get_off_job_thread_state", {
    _job_id: jobId,
    // Q262: the other party may have deleted their account; the viewer's own
    // status is still worth asking about.
    _other: otherUserId ?? (null as unknown as string),
  });
  if (error) {
    if ((error as { code?: string }).code !== "PGRST202") {
      report(error, { severity: "warning", tags: { source: "offJobGate.fetchOffJobState" } });
    }
    return null;
  }
  return data === "self" || data === "other" ? data : null;
}

/**
 * Whether the open thread is read-only because someone in it is off the job.
 * Not asked while `skip` (another notice already owns the dock). A refusal the
 * send path recorded on the open conversation wins immediately; reopening the
 * thread from the inbox asks the server again.
 */
export function useOffJobState({
  activeConvo,
  userId,
  skip,
}: {
  activeConvo: Conversation | null;
  userId: string | null;
  skip: boolean;
}): OffJobState | null {
  const jobId = activeConvo?.jobId ?? "";
  const otherUserId = activeConvo?.otherUserId ?? null;
  const key = `${jobId}|${otherUserId ?? ""}`;
  const [answer, setAnswer] = useState<{ key: string; state: OffJobState | null } | null>(null);

  useEffect(() => {
    if (skip || !userId || !jobId) return;
    let cancelled = false;
    fetchOffJobState(jobId, otherUserId).then(
      (state) => {
        if (!cancelled) setAnswer({ key, state });
      },
      // fetchOffJobState never rejects (errors resolve to null); nothing to do.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [skip, userId, jobId, otherUserId, key]);

  if (skip) return null;
  if (activeConvo?.offJobState) return activeConvo.offJobState;
  return answer?.key === key ? answer.state : null;
}
