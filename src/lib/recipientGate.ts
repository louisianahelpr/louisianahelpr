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
 * gate(poster) true. Ownerless jobs are never restricted by this rule.
 *
 * THE POSTER TOO (A3-B3, app audit 2026-10-29). The same gate refuses the
 * POSTER when the person in the thread is no longer anyone on the job: no
 * application, no offer, not hired, not on the crew (and not "off the job" in
 * is_off_job's sense, i.e. they never applied or were offered; that case has
 * its own notice, src/lib/offJobGate.ts). The poster's thread kept a live
 * composer, every send bounced with RLS 42501, and the bubble said "tap to
 * retry", which could never work. The control question works for the poster
 * unchanged: gate(poster) asks whether the poster may reach themself on their
 * own job, which is true exactly when the poster can send at all (not banned,
 * thread open, under the 30/hour cap). So the poster's thread closes up front
 * on the server's own answer, with its own one-line reason.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import type { Conversation } from "@/components/messages/types";

export const RECIPIENT_RESTRICTED_NOTICE =
  "You can't send messages in this conversation. On this job, only the person who posted it can message applicants and anyone with a pending offer. You can still read everything here.";
export const RECIPIENT_RESTRICTED_TOAST =
  "Only the person who posted this job can message them, so the message wasn't sent.";

/** The poster's version: the person in the thread is no longer on this job. */
export const RECIPIENT_NOT_ON_JOB_NOTICE =
  "You can't send messages in this conversation: this person hasn't applied, been offered or been hired for this job. You can still read everything here.";
export const RECIPIENT_NOT_ON_JOB_TOAST =
  "This person isn't on this job, so the message wasn't sent.";

/** The one-line reason the composer shows, for the poster or anyone else. */
export function recipientRestrictedNotice(viewerIsPoster: boolean): string {
  return viewerIsPoster ? RECIPIENT_NOT_ON_JOB_NOTICE : RECIPIENT_RESTRICTED_NOTICE;
}
/** The toast a refused send shows, for the poster or anyone else. */
export function recipientRestrictedToast(viewerIsPoster: boolean): string {
  return viewerIsPoster ? RECIPIENT_NOT_ON_JOB_TOAST : RECIPIENT_RESTRICTED_TOAST;
}

/** The server gate's answer, or null when it could not be asked. */
async function askGate(jobId: string, receiverId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("can_send_message_to_in_job", {
    _job_id: jobId,
    _receiver: receiverId,
  });
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
  if (receiverId === posterId) return false;
  if ((await askGate(jobId, receiverId)) !== false) return false;
  return (await askGate(jobId, posterId)) === true;
}

/**
 * Whether the open thread is read-only for this viewer under the receiver
 * rule, the poster included (A3-B3). Not asked while `skip` (another notice
 * already owns the dock). A refusal the
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
  const key = `${jobId}|${otherUserId}`;
  const [answer, setAnswer] = useState<{ key: string; restricted: boolean } | null>(null);

  useEffect(() => {
    if (skip || !userId || !jobId || !otherUserId || !posterId) return;
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
  }, [skip, userId, jobId, otherUserId, posterId, key]);

  if (skip) return false;
  if (activeConvo?.recipientRestricted) return true;
  return answer?.key === key && answer.restricted;
}
