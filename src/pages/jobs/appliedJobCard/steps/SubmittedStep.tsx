import { CheckCircle2 } from "lucide-react";
import { CardSubPanel } from "@/components/ui/CardSubPanel";
import DeadlineCountdown from "@/components/job-card/DeadlineCountdown";
import { APPROVAL_WINDOW_HOURS, STANDARD_PAYOUT_PHRASE, hoursToMs, payoutDayLabel } from "../../../../../supabase/functions/_shared/escrowTiming";
import { JobStepCard } from "@/components/job-card/JobStepCard";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 4 — the helper has marked the job done.
 *
 * There is no ask and no primary: the next move belongs to the poster. So the
 * card is the tracker, a notice, and Message — and the notice is a
 * {@link CardSubPanel}, which is the shape the "Marked complete" box was
 * hand-drawing (a primary-tinted header strip with an icon and a padded body).
 *
 * Approval is NOT payment: the payout is sent STANDARD_PAYOUT_PHRASE, and once
 * it is scheduled the card names the DAY (payout_scheduled_at, payoutDayLabel).
 * Nothing releases on a timer (owner 2026-10-23): past APPROVAL_WINDOW_HOURS
 * without an answer, Helpr support steps in. Every figure comes from
 * escrowTiming, which the crons read too.
 */
export function SubmittedStep({
  job,
  tracker,
  messageChip,
  reportChip,
  posterInstantRelease,
}: HelperStepProps & { posterInstantRelease: boolean }) {
  const fullyComplete = !!job.poster_completed_at;
  const payDay = payoutDayLabel(job.payout_scheduled_at);

  const notice = fullyComplete ? (
    <div className="rounded-ds-sm bg-primary/10 border border-primary/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
        <span className="text-ds-13 font-medium text-primary">Job complete</span>
      </div>
      {job.payment_status === "released" ? (
        <p className="text-ds-10 text-muted-foreground pt-1">
          Payout sent. It lands in your bank on your usual payout schedule.
        </p>
      ) : (
        <p className="text-ds-10 text-muted-foreground pt-1">
          {payDay
            ? <>Approved. Your payout will be sent {payDay}, then lands in your bank on your usual payout schedule.</>
            : <>Approved. Your payout is sent {STANDARD_PAYOUT_PHRASE}, then lands in your bank on your usual payout schedule.</>}
        </p>
      )}
    </div>
  ) : job.revision_requested_at ? (
    /* A revision has been asked for on this job at some point and the poster
       has not closed it out — "Waiting for the poster to approve" would be the
       wrong sentence. Same guard the notice carried before the split. */
    null
  ) : (
    <CardSubPanel icon={CheckCircle2} title="Marked complete" tone="primary">
      <div className="space-y-1">
        <p className="text-ds-11 text-muted-foreground">Waiting for the person who posted this job to:</p>
        <ul className="text-ds-11 text-muted-foreground list-disc pl-4 space-y-0.5">
          <li><span className="text-foreground font-medium">Approve &amp; complete</span> the job</li>
          <li>Or <span className="text-foreground font-medium">request a revision</span></li>
        </ul>
        <p className="text-ds-10 text-muted-foreground pt-1">
          {posterInstantRelease
            ? `They approve instantly. Your payout is sent ${STANDARD_PAYOUT_PHRASE}.`
            : `If they haven't answered within ${APPROVAL_WINDOW_HOURS} hours, Helpr support steps in. Your payment stays held until the job is approved, and your payout is sent ${STANDARD_PAYOUT_PHRASE}.`}
        </p>
        {/* No countdown when the poster releases instantly (owner,
            2026-08-24): a 24h timer that ends within minutes is a lie. */}
        {job.helper_completed_at && !posterInstantRelease && (
          <div className="pt-1.5">
            <DeadlineCountdown
              deadline={new Date(new Date(job.helper_completed_at).getTime() + hoursToMs(APPROVAL_WINDOW_HOURS)).toISOString()}
              expiredText={`${APPROVAL_WINDOW_HOURS} hours passed — Helpr support is stepping in. Your payment stays held.`}
              consequenceText="for them to answer. After that, Helpr support steps in."
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
      /* CHIP ORDER IS PINNED AT BOTH ENDS (owner, 2026-09-19): "report a
         problem always all the way on the left" (superseded 2026-09-27: Report a Problem now lives inside More — MORE_ONLY_CHIP_KEYS in JobStepCard), and "before and after photos
         should be to the left of the primary buttons". The primary is already
         far right (V2/V3), so the row reads:
           Report a Problem · …middle… · Before/After photo · [green primary]
         The ends are also what the overflow control may never take — see
         `allocateJobStepRow`. */
      actions={[reportChip, messageChip]}
    />
  );
}
