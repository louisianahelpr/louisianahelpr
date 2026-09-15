import { CheckCircle2, XCircle, AlertTriangle, MessageCircle } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip, JobStepPrimaryButton } from "../../JobActionRow";
import { SosShareButton } from "@/components/SosShareButton";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { CompletionChoiceSheet } from "@/components/activity/CompletionChoiceSheet";
import { shouldShowDisputeLink } from "@/components/jobs/DisputeLink";
import { hasJobStarted } from "@/lib/dateUtils";
import { AUTO_COMPLETE_HOURS, hoursToMs } from "../../../../../supabase/functions/_shared/escrowTiming";
import type { PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 3 — the job is underway (or in a revision).
 *
 * The poster's counterpart to the helper's OnSite / Working / Submitted steps,
 * and the state where the slots earn their keep:
 *
 *   ask      — the Helpr's proof photos, at the moment the poster is asked to
 *              release money against them. (Read-only: the poster never uploads
 *              here.) Both other PhotoProofGroup call sites are gated on
 *              completed / disputed, so before this the proof only appeared
 *              AFTER the release.
 *   primary  — the ONE vouch this step wants: Confirm They Arrived, then
 *              Confirm They're Working. They are mutually exclusive by their
 *              own gates, so the card never draws two. It leads the card's
 *              ONE action row (owner, 2026-09-14, VN-21).
 *   actions  — SOS · No-Show · Dispute · Message · Approve, beside it on that
 *              row. Order globally: danger left, Message middle, Approve
 *              right — the escalation and the release of money never land next
 *              to each other under a thumb.
 *   footnote — why Review and Tip are not here yet.
 */
export function InProgressStep(ctx: PosterStepCtx) {
  const {
    job,
    userId,
    helperNames,
    completingJobId,
    confirmingArrivalJobId,
    confirmingWorkingJobId,
    instantReleaseOn,
    navigate,
    onComplete,
    onNoShow,
    onDispute,
    onConfirmArrival,
    onConfirmWorking,
    onActionComplete,
    completionSheetOpen,
    setCompletionSheetOpen,
  } = ctx;

  // VN-33(b): also when the Helpr was refused as a little too far from a map
  // pin that may be wrong (within a mile, last 12h) — the poster at the real
  // door is the one who can say they're there. Same 12h window as the trigger.
  const nearMissAt = (job as { helper_arrival_near_miss_at?: string | null }).helper_arrival_near_miss_at;
  const recentNearMiss = !!nearMissAt && Date.now() - new Date(nearMissAt).getTime() < 12 * 3_600_000;
  const showConfirmArrival =
    job.status === "in_progress" &&
    (!!job.helper_arrived_at || recentNearMiss) &&
    !job.poster_confirmed_arrival_at &&
    !job.helper_completed_at;
  const showConfirmWorking =
    job.status === "in_progress" && !job.poster_confirmed_working_at && !!job.poster_confirmed_arrival_at;

  // Owner's rule: No-Show is tied to the CLOCK, not to whether the helper
  // accepted — hidden until the scheduled start time has come and gone.
  // VN-33(b): a Helpr whose location was recorded near the job in the last
  // 12h may be standing at the real door of a wrong pin — the server refuses a
  // no-show then (helper_near_miss_pending), so don't offer it.
  const showNoShow =
    job.status === "in_progress" &&
    !job.poster_completed_at &&
    !job.helper_arrived_at &&
    !recentNearMiss &&
    hasJobStarted(job.date_needed, job.start_time);
  // SOS is gated on the helper actually BEING on site, and it ENDS when the job
  // does — a safety control that outlives the situation is noise.
  const jobIsOver = !!job.poster_completed_at || !!job.helper_completed_at;
  const showSos = !!job.helper_arrived_at && !jobIsOver;
  const showApprove = !!job.helper_completed_at;
  // Dispute only where the shared predicate already allows it (an open revision
  // on the customer side) — no new dispute surface.
  const showDispute = shouldShowDisputeLink(job, "customer");
  const hasProof = (job.proof_before_urls?.length ?? 0) > 0 || (job.proof_after_urls?.length ?? 0) > 0;

  const awaitingApproval =
    !!job.helper_completed_at && !job.poster_completed_at && !job.revision_requested_at;

  return (
    <JobStepCard
      side="poster"
      step="in_progress"
      ask={
        showApprove && hasProof ? (
          <div className="space-y-1.5">
            <p className="font-sans leading-snug text-ds-11 px-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Your Helpr's proof photos — check these before you approve.
            </p>
            <PhotoProofGroup
              jobId={job.id}
              beforeUrls={job.proof_before_urls || []}
              afterUrls={job.proof_after_urls || []}
              canUpload={false}
            />
          </div>
        ) : null
      }
      notice={
        <>
          {/* The "Is the Helpr working?" prompt was REMOVED here (owner,
              2026-09-11: "not needed. these are also on the tracker"). It
              labelled the "Confirm They're Working" button that sits directly
              under it, so it asked the question the button already answers,
              while the tracker beside it already shows which step is current. */}
          {/* The deadline reads the shared constant — 24h, TIGHTENED from 48 on
              2026-08-24. Do not "restore" a 48: that would double every
              poster's review window and delay every helper payout by a day. */}
          {awaitingApproval && instantReleaseOn && (
            <div
              className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm"
              style={{ background: "hsl(var(--bark) / 0.08)", color: "hsl(var(--bark))" }}
            >
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">
                Instant Release is on — payment releases within minutes. Request a revision now if something's wrong.
              </span>
            </div>
          )}
          {awaitingApproval && !instantReleaseOn && job.helper_completed_at && (
            <DeadlineCountdown
              deadline={new Date(new Date(job.helper_completed_at).getTime() + hoursToMs(AUTO_COMPLETE_HOURS)).toISOString()}
              expiredText={`${AUTO_COMPLETE_HOURS} hours passed — payment auto-released to Helpr`}
              // One line (owner). The Approve sheet itself walks through
              // release vs revision, so the banner only owes the deadline and
              // its consequence.
              consequenceText="to review — payment auto-releases after"
              inline
              variant="warning"
            />
          )}
        </>
      }
      primary={
        /* ONE ROW, PRIMARY IN THE DARK GREEN (owner, 2026-09-14, VN-21:
           "confirm they're working, no show, message etc — all of these
           buttons need to be on 1 line not multiple"; ruled: the primary is
           the dark green button, the others beside it). This reverses the
           quiet-tint styling of 2026-08-24 for these two vouches — they lead
           the row now, so they wear the row's primary surface.

           NOTE the arrival tap DOES gate the helper again: since VN-33 (owner,
           2026-09-14) the Helpr cannot start working or mark the job complete
           until the server has verified their location AND this is tapped.
           The working confirmation still gates nothing. */
        showConfirmArrival ? (
          <JobStepPrimaryButton
            icon={CheckCircle2}
            label={confirmingArrivalJobId === job.id ? "…" : "Confirm They Arrived"}
            disabled={confirmingArrivalJobId === job.id}
            onClick={() => onConfirmArrival(job.id)}
          />
        ) : showConfirmWorking ? (
          <JobStepPrimaryButton
            icon={CheckCircle2}
            label={confirmingWorkingJobId === job.id ? "…" : "Confirm They're Working"}
            disabled={confirmingWorkingJobId === job.id}
            onClick={() => onConfirmWorking(job.id)}
          />
        ) : null
      }
      actions={[
        showSos ? <SosShareButton key="sos" jobId={job.id} variant="chip" /> : null,
        showNoShow ? (
          <JobActionChip
            key="noshow"
            icon={XCircle}
            label="No-Show"
            ariaLabel="No-Show — report that the Helpr never turned up"
            tone="danger"
            onClick={() => onNoShow(job.id)}
          />
        ) : null,
        showDispute ? (
          <JobActionChip
            key="dispute"
            icon={AlertTriangle}
            label="Dispute"
            ariaLabel="Dispute — something wrong? open a dispute about this job"
            tone="danger"
            onClick={() => onDispute(job)}
          />
        ) : null,
        <JobActionChip
          key="message"
          icon={MessageCircle}
          label="Message"
          ariaLabel="Message Helpr"
          tone="message"
          // Straight into the thread with THIS helpr on THIS job.
          onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}
        />,
        showApprove ? (
          <JobActionChip
            key="approve"
            icon={CheckCircle2}
            label={job.poster_completed_at ? "Approved" : "Approve"}
            ariaLabel={
              job.poster_completed_at
                ? "Approved — you already released payment for this job"
                : "Approve — accept the work and release payment to your Helpr"
            }
            tone="approve"
            disabled={completingJobId === job.id || !!job.poster_completed_at}
            onClick={() => {
              if (!job.poster_completed_at) setCompletionSheetOpen(true);
            }}
          />
        ) : null,
      ]}
      footnote={
        /* Approving IS the escrow release, and Review and Tip only unlock once
           the money has moved — the order is real, but nothing said so and the
           card read as if the two actions had gone missing (owner, 2026-08-25). */
        showApprove ? (
          <p className="font-sans leading-snug text-ds-11 px-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Approve to release payment — then you can review and tip.
          </p>
        ) : null
      }
      dialogs={
        showApprove ? (
          <CompletionChoiceSheet
            open={completionSheetOpen}
            jobId={job.id}
            jobTitle={job.title}
            helperId={job.helper_id}
            helperName={job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"}
            userId={userId}
            proofBeforeUrls={job.proof_before_urls || []}
            proofAfterUrls={job.proof_after_urls || []}
            onClose={() => setCompletionSheetOpen(false)}
            onConfirm={() => onComplete(job.id)}
            onRevisionSubmitted={onActionComplete}
          />
        ) : null
      }
    />
  );
}
