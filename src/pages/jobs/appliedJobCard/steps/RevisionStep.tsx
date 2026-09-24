import { Check, RefreshCw } from "lucide-react";
import DeadlineCountdown from "@/components/job-card/DeadlineCountdown";
import { HelperRevisionCard } from "@/pages/jobs/HelperRevisionCard";
import { JobStepCard } from "@/components/job-card/JobStepCard";
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { HelperPhotoAsk } from "./HelperPhotoAsk";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 5 — the poster asked for a revision.
 *
 * The ask is the revision itself (HelperRevisionCard owns the "I'll Fix It" /
 * "Discuss" decision and reads the `job_revisions` row, falling back to
 * `jobs.revision_note`). It is still the only thing in the `ask` SLOT — one
 * ask at a time — but that was never a reason for the card to carry no photo
 * CONTROL, and it read like one until today.
 *
 * THE PHOTO CHIP (owner, 2026-09-19: "here they have no way to submit the
 * photos after the dispute or revision"). This step mounted none at all, so a
 * Helpr told to redo the work had nowhere to put the evidence that they had —
 * on the one state whose entire purpose is producing new proof for the poster
 * to judge. It is a chip in the one action row, beside Message and Report a
 * Problem, exactly as the on-site, working and disputed steps carry it; the
 * revision panel keeps the `ask` slot to itself. `HelperPhotoAsk` offers the
 * AFTER photo here and keeps offering it after one exists — see its note.
 *
 * ONE PRIMARY, THEN THE NEXT STEP. "Mark Fixed" appears only once the revision
 * has actually been accepted; before that, accept-the-work and declare-it-done
 * rendered side by side on a job the helper had not agreed to touch yet.
 */
export function RevisionStep({
  app,
  job,
  tracker,
  messageChip,
  reportChip,
  sosChip,
  revisionAccepted,
  onRevisionAcceptedChange,
  resolving,
  onMarkFixed,
}: HelperStepProps & {
  revisionAccepted: boolean;
  onRevisionAcceptedChange: (accepted: boolean) => void;
  resolving: boolean;
  onMarkFixed: () => void;
}) {
  const ask = (
    <HelperRevisionCard
      jobId={app.job_id}
      posterId={job.customer_id ?? null}
      legacyRevisionNote={job.revision_note ?? null}
      onAccepted={() => { /* optimistically keep showing the card — parent refetches */ }}
      onAcceptedChange={onRevisionAcceptedChange}
    />
  );

  const notice = (
    <>
      {job.revision_deadline && !job.revision_completed_at && (
        <DeadlineCountdown
          deadline={job.revision_deadline}
          expiredText="Revision deadline passed — they can dispute or complete"
          consequenceText="Fix the revision before the deadline. If not completed, the person who posted this job can file a dispute."
          variant="warning"
        />
      )}
      {job.revision_completed_at && (
        <div className="space-y-2">
          <div
            className="text-ds-11 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded font-medium w-full"
            style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}
          >
            <Check className="w-3 h-3 shrink-0" strokeWidth={3} /> Marked as fixed — waiting on them
          </div>
          {job.revision_acceptance_deadline && (
            <DeadlineCountdown
              deadline={job.revision_acceptance_deadline}
              expiredText="No response — payment auto-releasing"
              consequenceText="If the person who posted this job doesn't accept or dispute, payment auto-releases to you."
              variant="warning"
            />
          )}
        </div>
      )}
    </>
  );

  // ONE ROW (owner, 2026-09-14, VN-21: "can all the buttons be on 1 row like
  // i'll fix it, message etc"). Before acceptance the row's primary is the
  // revision card's "I'll Fix It", portalled in from HelperRevisionCard; from
  // acceptance it is "Mark Fixed". Either way it leads the row in the dark
  // green, with Message and Report a Problem beside it — never both at once.
  const primary =
    !job.revision_completed_at && revisionAccepted ? (
      <JobStepPrimaryButton
        icon={RefreshCw}
        iconClassName={resolving ? "animate-spin" : undefined}
        label={resolving ? "Marking…" : "Mark Fixed"}
        disabled={resolving}
        onClick={onMarkFixed}
      />
    ) : null;

  return (
    <JobStepCard
      side="helper"
      step="revision"
      header={tracker}
      ask={ask}
      notice={notice}
      primary={primary}
      /* CHIP ORDER IS PINNED AT BOTH ENDS (owner, 2026-09-19): "report a
         problem always all the way on the left", and "before and after photos
         should be to the left of the primary buttons". The primary is already
         far right (V2/V3), so the row reads:
           Report a Problem · …middle… · Before/After Photo · [green primary]
         The ends are also what the overflow control may never take — see
         `allocateJobStepRow`. */
      // Owner, 2026-09-24: at phone width Message stays in the row and
      // Report a Problem + SOS go into More, drawn to its left.
      soloChipKey="message"
      actions={[reportChip, sosChip, messageChip, <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step="revision" />]}
    />
  );
}
