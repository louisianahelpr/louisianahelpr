import { CheckCircle2 } from "lucide-react";
import { CardSubPanel } from "@/components/ui/CardSubPanel";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { AUTO_COMPLETE_HOURS, PAYOUT_HOLD_HOURS, hoursToMs } from "../../../../../supabase/functions/_shared/escrowTiming";
import { JobStepCard } from "@/components/activity/JobStepCard";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 4 — the helper has marked the job done.
 *
 * There is no ask and no primary: the next move belongs to the poster. So the
 * card is the tracker, a notice, and Message — and the notice is a
 * {@link CardSubPanel}, which is the shape the "Marked Complete" box was
 * hand-drawing (a primary-tinted header strip with an icon and a padded body).
 *
 * The copy is unchanged, including the two numbers: approval is NOT payment —
 * the payout releases PAYOUT_HOLD_HOURS after it, and both figures come from
 * escrowTiming, which the cron reads too.
 */
export function SubmittedStep({
  job,
  tracker,
  messageChip,
  escape,
  posterInstantRelease,
}: HelperStepProps & { posterInstantRelease: boolean }) {
  const fullyComplete = !!job.poster_completed_at;

  const notice = fullyComplete ? (
    <div className="rounded-ds-sm bg-primary/10 border border-primary/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
        <span className="text-ds-13 font-medium text-primary">Job complete</span>
      </div>
      {job.payment_status === "released" ? (
        <p className="text-ds-10 text-muted-foreground/70 pt-1">
          Payout sent. It lands in your bank on your usual payout schedule.
        </p>
      ) : (
        <p className="text-ds-10 text-muted-foreground/70 pt-1">
          Approved. Your payout releases {PAYOUT_HOLD_HOURS} hours after approval,
          then lands in your bank on your usual payout schedule.
        </p>
      )}
    </div>
  ) : job.revision_requested_at ? (
    /* A revision has been asked for on this job at some point and the poster
       has not closed it out — "Waiting for the poster to approve" would be the
       wrong sentence. Same guard the notice carried before the split. */
    null
  ) : (
    <CardSubPanel icon={CheckCircle2} title="Marked Complete" tone="primary">
      <div className="space-y-1">
        <p className="text-ds-11 text-muted-foreground">Waiting for the poster to:</p>
        <ul className="text-ds-11 text-muted-foreground list-disc pl-4 space-y-0.5">
          <li><span className="text-foreground font-medium">Approve &amp; complete</span> the job</li>
          <li>Or <span className="text-foreground font-medium">request a revision</span></li>
        </ul>
        <p className="text-ds-10 text-muted-foreground/70 pt-1">
          {posterInstantRelease
            ? `This poster approves instantly — then your payout is released ${PAYOUT_HOLD_HOURS} hours later.`
            : `If the poster doesn't respond within ${AUTO_COMPLETE_HOURS} hours, the job completes automatically and your payout is released ${PAYOUT_HOLD_HOURS} hours after that.`}
        </p>
        {/* No countdown when the poster releases instantly (owner,
            2026-08-24): a 24h timer that ends within minutes is a lie. */}
        {job.helper_completed_at && !posterInstantRelease && (
          <div className="pt-1.5">
            <DeadlineCountdown
              deadline={new Date(new Date(job.helper_completed_at).getTime() + hoursToMs(AUTO_COMPLETE_HOURS)).toISOString()}
              expiredText={`${AUTO_COMPLETE_HOURS} hours passed — completing automatically, payout ${PAYOUT_HOLD_HOURS}h later`}
              consequenceText={`The job completes automatically when this timer expires. Your payout is released ${PAYOUT_HOLD_HOURS} hours after that.`}
              variant="warning"
            />
          </div>
        )}
      </div>
    </CardSubPanel>
  );

  return (
    <JobStepCard
      side="helper"
      step="submitted"
      header={tracker}
      notice={notice}
      actions={[messageChip]}
      escape={escape}
    />
  );
}
