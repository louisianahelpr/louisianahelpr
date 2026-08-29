import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare } from "lucide-react";
import { useBroadcastMessage } from "@/components/activity/postedJobCard/useBroadcastMessage";
import { type Job, type EnrichedApplication } from "@/components/activity/activityConstants";

/**
 * "Message all N Helprs" — one message to every PENDING applicant on a job.
 *
 * This capability existed until 016acc4b9, which removed the inline applicant
 * preview from the posted-job card (owner: "applicants should not show here,
 * only when the applicants button is clicked"). The composer lived only inside
 * that block, so it disappeared as collateral; the commit flagged it as an open
 * decision rather than a deliberate removal, and the owner's answer was that
 * posters SHOULD be able to message applicants at once. This is its new home,
 * behind the Applicants button — the surface the removal pointed everything at.
 *
 * The send logic is unchanged: `useBroadcastMessage` was kept intact for
 * exactly this rebuild, so what shipped before is what ships now. Only the
 * placement is new.
 *
 * Hidden below two pending applicants. Broadcasting to one person is just a
 * message, and the per-applicant Message button already does that better — it
 * opens the real thread instead of firing a one-way blast.
 */
export function BroadcastComposer({
  job,
  posterId,
  applications,
}: {
  job: Job;
  /** The poster — always `selectedJob.customer_id`; this panel is theirs. */
  posterId: string;
  applications: EnrichedApplication[];
}) {
  // The hook keys its applicant lookup by job id, which is the shape the
  // posted-job card used to hand it. Rebuilt around the panel's flat list.
  const {
    broadcastOpen,
    setBroadcastOpen,
    broadcastText,
    setBroadcastText,
    broadcastSending,
    broadcastRef,
    handleBroadcastMessage,
  } = useBroadcastMessage(job, posterId, { [job.id]: applications });

  const pendingCount = applications.filter((a) => a.status === "pending").length;
  if (pendingCount < 2) return null;

  return (
    <div className="pt-2">
      {broadcastOpen ? (
        <div className="rounded-ds-md liquid-glass p-3 space-y-2">
          <Textarea
            ref={broadcastRef}
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            placeholder={`Message all ${pendingCount} Helprs — a question, a schedule change, anything they all need.`}
            className="min-h-[80px] text-ds-13"
            maxLength={1000}
          />
          {/* Said plainly BEFORE sending, not after. Each helper gets their own
              thread and cannot see the others, but the poster is still writing
              to a room — worth knowing while the message can still be edited. */}
          <p className="text-ds-10 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Sent privately to each Helpr — they won't see one another.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1 rounded-ds-md glass-press"
              disabled={!broadcastText.trim() || broadcastSending}
              onClick={handleBroadcastMessage}
            >
              {broadcastSending ? "Sending…" : `Send to ${pendingCount}`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-ds-md"
              disabled={broadcastSending}
              onClick={() => { setBroadcastOpen(false); setBroadcastText(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full rounded-ds-md glass-press"
          onClick={() => setBroadcastOpen(true)}
        >
          <MessageSquare className="w-4 h-4 mr-1" />
          Message all {pendingCount} Helprs
        </Button>
      )}
    </div>
  );
}
