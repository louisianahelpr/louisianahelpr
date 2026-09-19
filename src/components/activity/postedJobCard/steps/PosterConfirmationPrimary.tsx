import { CheckCircle2 } from "lucide-react";
import { JobStepPrimaryButton } from "../../JobActionRow";
import { JobStepRowSlot } from "../../jobStepRow";
import { posterConfirmationRung, type PosterStepId } from "./posterStepContract";
import type { Job } from "../../activityConstants";

/**
 * THE POSTER'S ONE CONFIRMATION BOX, drawn the house way.
 *
 * The rule it draws lives in `posterConfirmationRung` (posterStepContract.ts);
 * this file is only its rendering, and it is deliberately the SAME pattern
 * JobTracking uses for its own blocked CTA (JobTracking.tsx, `reasonEl` +
 * `ctaEl` through `JobStepRowSlot`): a disabled primary in the row's `primary`
 * slot, and one line in the row's `note` slot saying why. Amber when the line
 * is a GATE, muted when it is an ordinary wait — the same two treatments, read
 * off `rung.gate`.
 *
 * Both ANTI-PATTERNS this codebase has already rejected are avoided on
 * purpose: this is not a greyed chip that "invites a tap and an explanation"
 * (OpenStep's dropped Boost), and it is not a disabled twin carrying the
 * instruction while the real control sits elsewhere (PayoutPrimary). It is the
 * step's ONE control, in the one place that control ever lives.
 *
 * It goes in a step's `notice` slot rather than its `primary` prop because the
 * reason has to reach the row's note host, and only a child of `JobStepCard`
 * can portal into it. Claiming the `primary` slot stands the step's own
 * `primary` prop down, which is the shell's existing one-primary rule.
 */
export function PosterConfirmationPrimary({
  job,
  step,
  confirmingArrivalJobId,
  confirmingWorkingJobId,
  onConfirmArrival,
  onConfirmWorking,
}: {
  job: Job;
  step: PosterStepId;
  confirmingArrivalJobId: string | null;
  confirmingWorkingJobId: string | null;
  onConfirmArrival: (jobId: string) => void;
  onConfirmWorking: (jobId: string) => void;
}) {
  const rung = posterConfirmationRung(job, step);
  if (!rung) return null;

  const busy =
    (rung.action === "arrival" && confirmingArrivalJobId === job.id) ||
    (rung.action === "working" && confirmingWorkingJobId === job.id);

  return (
    <>
      <JobStepRowSlot slot="note">
        {rung.reason ? (
          <p
            className={`text-ds-11 text-center${rung.gate ? " font-semibold" : " text-muted-foreground"}`}
            style={rung.gate ? { color: "hsl(var(--amber-ink))" } : undefined}
          >
            {rung.reason}
          </p>
        ) : null}
      </JobStepRowSlot>
      <JobStepRowSlot slot="primary">
        <JobStepPrimaryButton
          icon={CheckCircle2}
          label={busy ? "…" : rung.label}
          tone={rung.done ? "done" : "primary"}
          disabled={!rung.enabled || busy}
          /* APPENDED to the visible label, never substituted
             (composeAccessibleName, WCAG 2.5.3): a poster using voice control
             still says the words on the box, and a screen-reader user out of
             the row's context still gets the reason the sighted user reads on
             the line above. */
          ariaLabel={rung.reason ?? undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (!rung.enabled || busy) return;
            if (rung.action === "arrival") onConfirmArrival(job.id);
            else if (rung.action === "working") onConfirmWorking(job.id);
          }}
        />
      </JobStepRowSlot>
    </>
  );
}
