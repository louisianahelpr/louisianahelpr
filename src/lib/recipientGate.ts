/**
 * Receiver gate: who this viewer may message in a job thread.
 *
 * Owner decisions 2026-09-14 (migrations 20260914210443 + 20260914215014):
 * only the poster may message applicants and the offered (not yet accepted)
 * Helpr, and a messaged applicant or an offered Helpr reaches only the poster.
 * The server enforces it in `can_send_message_to_in_job`, which the messages
 * INSERT policy calls. So a non-poster who already had a thread with an
 * applicant, or with an offered Helpr, opens a thread whose every send RLS
 * refuses with 42501 and no reason.
 *
 * The client never re-implements the rule: it asks that same server function
 * for the open thread, and the composer is replaced by a read-only notice
 * (the messaging lockout's pattern, src/lib/messagingLockout.ts).
 *
 * The gate answers one boolean, and it is also false when the CALLER cannot
 * send at all: banned, no longer a party (a replaced Helpr), thread closed, or
 * at the 30/hour cap (counted in server time). Every one of those also makes
 * the same gate refuse the POSTER as receiver, while the recipient rule never
 * does (the poster is reachable by anyone who may post). (A block between the
 * two users is receiver-specific, but blocked threads are filtered out of the
 * inbox, and a blocked SEND is refused by its trigger with its own message
 * before RLS runs, which the send path does not attribute here.) So the
 * control question "may I reach the poster?" separates them, entirely on the
 * server's clock and data: restricted = gate(receiver) false AND
 * gate(poster) true. The poster itself, and ownerless jobs, are never
 * restricted by this rule.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Conversation } from "@/components/messages/types";

export const RECIPIENT_RESTRICTED_NOTICE =
  "You can't send messages in this conversation. On this job, only the person who posted it can message applicants and anyone with a pending offer. You can still read everything here.";
export const RECIPIENT_RESTRICTED_TOAST =
  "Only the person who posted this job can message them, so the message wasn't sent.";

/** The server gate's answer, or null when it could not be asked. */
async function askGate(jobId: string, receiverId: string): Promise<boolean | null> {
  // Not in the generated types yet (20260914210443); a known server function.
  const { data, error } = await supabase.rpc("can_send_message_to_in_job" as never, {
    _job_id: jobId,
    _receiver: receiverId,
  } as never);
  if (error) {
    if ((error as { code?: string }).code !== "PGRST202") {
      report(error, { severity: "warning", tags: { source: "recipientGate.askGate" } });
    }
    return null;
  }
  return typeof data === "boolean" ? data : null;
}

/**
 * True only when the server refuses this receiver for the caller AND still
 * lets the caller reach the job's poster (so the recipient rule is the
 * reason). Any error, including the RPC not being deployed (PGRST202), fails
 * open to false: the server still refuses the send, and the send path keeps
 * its ordinary retry.
 */
export async function fetchRecipientRestricted(
  jobId: string,
  receiverId: string,
  userId: string,
  posterId: string | null | undefined,
): Promise<boolean> {
  if (!jobId || !receiverId || !userId || !posterId) return false;
  if (userId === posterId || receiverId === posterId) return false;
  if ((await askGate(jobId, receiverId)) !== false) return false;
  return (await askGate(jobId, posterId)) === true;
}

/**
 * Whether the open thread is read-only for this viewer under the receiver
 * rule. Never asked for the poster (the poster reaches every party of its own
 * job), nor while `skip` (another notice already owns the dock). A refusal the
 * send path recorded on the open conversation wins immediately; reopening the
 * thread from the inbox asks the server again.
 */
export function useRecipientRestricted({
  activeConvo,
  userId,
  skip,
}: {
  activeConvo: Conversation | null;
  userId: string | null;
  skip: boolean;
}): boolean {
  const jobId = activeConvo?.jobId ?? "";
  const otherUserId = activeConvo?.otherUserId ?? "";
  const posterId = activeConvo?.posterId ?? null;
  const viewerIsPoster = activeConvo?.viewerIsPoster === true;
  const key = `${jobId}|${otherUserId}`;
  const [answer, setAnswer] = useState<{ key: string; restricted: boolean } | null>(null);

  useEffect(() => {
    if (skip || viewerIsPoster || !userId || !jobId || !otherUserId || !posterId) return;
    let cancelled = false;
    fetchRecipientRestricted(jobId, otherUserId, userId, posterId).then(
      (restricted) => {
        if (!cancelled) setAnswer({ key, restricted });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [skip, viewerIsPoster, userId, jobId, otherUserId, posterId, key]);

  if (skip || viewerIsPoster) return false;
  if (activeConvo?.recipientRestricted) return true;
  return answer?.key === key && answer.restricted;
}
