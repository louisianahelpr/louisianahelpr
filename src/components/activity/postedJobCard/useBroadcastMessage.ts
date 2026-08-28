/**
 * PARKED, NOT DEAD — deliberately kept with no caller.
 *
 * 016acc4b9 removed the inline applicant preview from PostedJobApplicants
 * (owner: "applicants should not show here, only when the applicants button is
 * clicked"). The "Message all N applicants" composer lived only in that block,
 * so this hook lost its only consumer. That commit flagged the capability as a
 * decision to make rather than silently dropping it — see the note at the top
 * of PostedJobApplicants.tsx — so the implementation is kept intact for a
 * rebuild inside ApplicantsPanel.
 *
 * knip.json runs `"files": "error"`, so an unused file REDS THE BUILD (it is
 * what took `Test` red on 016acc4b9, the only failing rule; unused *exports*
 * and duplicates are merely warnings). This file is therefore listed in
 * knip.json's `ignore`. Delete both together if the decision lands on "no
 * broadcast" — the ignore entry must not outlive the file.
 */
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { successToast } from "@/lib/toast";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { type Job, type EnrichedApplication } from "../activityConstants";

/**
 * useBroadcastMessage — "Message all applicants" compose state + send handler,
 * extracted verbatim from PostedJobCard. Inserts one message row per pending
 * applicant into the `messages` table, targeting their per-applicant
 * conversation thread with the poster (keyed by job_id + participant pair).
 * Each insert uses the poster's userId as sender_id and the applicant's
 * helper_id as receiver_id, matching the schema used by the ChatView. Errors
 * are surfaced individually; a partial failure still shows the success count so
 * the poster knows which sends went through.
 */
export function useBroadcastMessage(
  job: Job,
  userId: string,
  inlineApplicants: Record<string, EnrichedApplication[]>,
) {
  // "Message all applicants" compose state — inline below the applicant list.
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const broadcastRef = useRef<HTMLTextAreaElement>(null);

  const handleBroadcastMessage = async () => {
    if (!broadcastText.trim() || broadcastSending) return;
    const pendingApplicants = (inlineApplicants[job.id] ?? []).filter(
      (a) => a.status === "pending",
    );
    if (pendingApplicants.length === 0) return;

    setBroadcastSending(true);
    let successCount = 0;
    let failCount = 0;

    await Promise.all(
      pendingApplicants.map(async (app) => {
        const { error } = await supabase.from("messages").insert({
          job_id: job.id,
          sender_id: userId,
          receiver_id: app.helper_id,
          content: broadcastText.trim(),
        });
        if (error) {
          failCount++;
          report(error, { tags: { source: "PostedJobCard.broadcastMessage", jobId: job.id } });
        } else {
          successCount++;
          // Notify the helper so they see the message in their inbox.
          void createNotification({
            user_id: app.helper_id,
            title: "New message from poster",
            message: broadcastText.trim().slice(0, 120),
            type: "info",
            link: `/messages`,
          });
        }
      }),
    );

    setBroadcastSending(false);

    if (successCount > 0) {
      hapticSuccess();
      successToast(
        `Message sent to ${successCount} Helpr${successCount !== 1 ? "s" : ""}${failCount > 0 ? ` (${failCount} failed)` : ""}`,
      );
      setBroadcastOpen(false);
      setBroadcastText("");
    } else {
      hapticError();
      toast.error("Couldn't send the message — please try again.");
    }
  };

  return {
    broadcastOpen,
    setBroadcastOpen,
    broadcastText,
    setBroadcastText,
    broadcastSending,
    broadcastRef,
    handleBroadcastMessage,
  };
}
