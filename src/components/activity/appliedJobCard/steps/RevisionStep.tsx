import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { HelperRevisionCard } from "@/components/activity/HelperRevisionCard";
import { JobStepCard } from "@/components/activity/JobStepCard";
import type { HelperStepProps } from "./stepContract";

/**
 * STEP 5 — the poster asked for a revision.
 *
 * The ask is the revision itself (HelperRevisionCard owns the "I'll Fix It" /
 * "Discuss" decision and reads the `job_revisions` row, falling back to
 * `jobs.revision_note`). There is no photo ask in this state — one ask at a
 * time, and this is the one.
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
  escape,
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
          expiredText="Revision deadline passed — poster can dispute or complete"
          consequenceText="Fix the revision before the deadline. If not completed, the poster can file a dispute."
          variant="warning"
        />
      )}
      {job.revision_completed_at && (
        <div className="space-y-2">
          <div
            className="text-ds-11 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded font-medium w-full"
            style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}
          >
            <Check className="w-3 h-3 shrink-0" strokeWidth={3} /> Marked as fixed — waiting for poster
          </div>
          {job.revision_acceptance_deadline && (
            <DeadlineCountdown
              deadline={job.revision_acceptance_deadline}
              expiredText="Poster didn't respond — payment auto-releasing"
              consequenceText="If the poster doesn't accept or dispute, payment auto-releases to you."
              variant="warning"
            />
          )}
        </div>
      )}
    </>
  );

  const primary =
    !job.revision_completed_at && revisionAccepted ? (
      <Button size="sm" variant="outline" className="w-full" disabled={resolving} onClick={onMarkFixed}>
        <RefreshCw className={`w-4 h-4 mr-1${resolving ? " animate-spin" : ""}`} /> {resolving ? "Marking…" : "Mark Fixed"}
      </Button>
    ) : null;

  return (
    <JobStepCard
      side="helper"
      step="revision"
      header={tracker}
      ask={ask}
      notice={notice}
      primary={primary}
      actions={[messageChip]}
      escape={escape}
    />
  );
}
