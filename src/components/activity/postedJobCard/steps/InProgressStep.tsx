import { useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, MessageCircle, Image, HelpCircle } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip } from "../../JobActionRow";
import { SosShareButton } from "@/components/SosShareButton";
import { PhotoProofDialog } from "@/components/PhotoProof";
import { Dialog, DialogContent, DialogFooter, DialogHero, DialogSecondaryAction } from "@/components/ui/dialog";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { CompletionChoiceSheet } from "@/components/activity/CompletionChoiceSheet";
import { shouldShowDisputeLink } from "@/components/jobs/DisputeLink";
import { hasJobStarted } from "@/lib/dateUtils";
import { AUTO_COMPLETE_HOURS, hoursToMs } from "../../../../../supabase/functions/_shared/escrowTiming";
import {
  STALLED_APPROVE_DETAIL_TITLE,
  STALLED_APPROVE_DISABLED_DETAIL,
  STALLED_APPROVE_DISABLED_REASON,
} from "../../../../../supabase/functions/_shared/stalledCompletion";
import { PosterConfirmationPrimary } from "./PosterConfirmationPrimary";
import { posterStalledNotice, recentArrivalNearMiss, type PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 3 — the job is underway (or in a revision).
 *
 * The poster's counterpart to the helper's OnSite / Working / Submitted steps,
 * and the state where the slots earn their keep:
 *
 *   ask      — nothing here any more. The Helpr's proof photos used to fill it
 *              as a two-column panel ABOVE the row; owner item 10 (2026-09-19)
 *              made "before & after pictures" a BUTTON on the same row as the
 *              other action buttons, so the gallery is now the `Photos` chip
 *              and its dialog. It still appears at the moment the poster is
 *              asked to release money against it, and is still read-only.
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
  // The proof gallery is a dialog off the row now (owner item 10), so the step
  // owns its open state. It is the only state this step has: everything that
  // must outlive a re-render is still the container's (PosterStepCtx).
  const [photosOpen, setPhotosOpen] = useState(false);
  /* ── OWNER ITEM 7, SECOND PASS (2026-09-19): "trim to one sentence. rest
   *    behind the tap." ──────────────────────────────────────────────────────
   *
   * THE DESIGN PROBLEM: the control this notice explains is DISABLED, so it
   * cannot be the thing that receives the tap — and making a disabled primary
   * tappable is the anti-pattern this card already rejected twice (OpenStep's
   * greyed Boost chip that "invited a tap and an explanation", PayoutPrimary's
   * disabled twin carrying an instruction).
   *
   * THE HOUSE ANSWER, and it was decided on THIS step nine hours earlier: owner
   * item 10 moved the proof gallery off a panel above the row and onto the row
   * as a `Photos` chip that opens a dialog. Same shape here — a quiet chip
   * beside the disabled box, opening a dialog from the shell's `dialogs` slot
   * (portalled, zero layout cost). It reuses `JobActionChip` + `DialogHero`,
   * adds no new control type, and keeps the VN-21 one-row contract: the row's
   * ONE primary is still the disabled stalled box.
   *
   * WHY NOT AN INLINE EXPANDER (the `ApplyEarningsBreakdown` "see the math"
   * pattern, which is the other house disclosure): its trigger is a button, and
   * the only place to put it is the row's `note` host — which sits ABOVE
   * `[data-job-step-row]`. A button there is a card control outside the single
   * action row, which is exactly what `jobStepOneRow.test.tsx` fails on.
   */
  const [whyOpen, setWhyOpen] = useState(false);
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
  // The predicate itself lives beside the confirmation ladder that shares it.
  const recentNearMiss = recentArrivalNearMiss(job);
  // THE TWO VOUCHES ARE A LADDER NOW, not two independent `show*` flags — see
  // `posterConfirmationRung`. Two things were wrong with the flags:
  //
  //   1. each one disappeared the instant it was taken, so a poster who had
  //      already confirmed saw an empty primary slot and reported that the
  //      buttons did not exist (owner, 2026-09-19);
  //   2. BOTH tested `job.status === "in_progress"` LITERALLY, while
  //      `derivePosterStep` routes `revision_requested` to this same step — so
  //      a job in revision silently lost both confirmations. The ladder reads
  //      the DERIVED step, which is why this file no longer mentions the raw
  //      status here (owner item 6b).
  //
  // `showNoShow` below still reads `job.status` on purpose: it is a different
  // control with a different rule, and nobody asked for it to change.

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
  // The chip and the box it explains share ONE predicate (`posterStalledNotice`
  // reads the rung itself), so the card can never offer an explanation of a
  // notice that is not on screen — or hide the explanation of one that is.
  const stalled = posterStalledNotice(job);
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
      notice={
        <>
          {/* ONE ROW, PRIMARY IN THE DARK GREEN (owner, 2026-09-14, VN-21:
              "confirm they're working, no show, message etc — all of these
              buttons need to be on 1 line not multiple"; ruled: the primary is
              the dark green button, the others beside it). This box claims the
              row's primary slot from here — it renders in `notice` only
              because its REASON line has to reach the row's note host, and
              only a child of the shell can portal into it.

              NOTE the arrival tap DOES gate the helper again: since VN-33
              (owner, 2026-09-14) the Helpr cannot start working or mark the job
              complete until the server has verified their location AND this is
              tapped. The working confirmation still gates nothing. */}
          <PosterConfirmationPrimary
            job={job}
            step="in_progress"
            confirmingArrivalJobId={confirmingArrivalJobId}
            confirmingWorkingJobId={confirmingWorkingJobId}
            onConfirmArrival={onConfirmArrival}
            onConfirmWorking={onConfirmWorking}
          />
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
      actions={[
        showSos ? <SosShareButton key="sos" jobId={job.id} /> : null,
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
        /* THE PROOF PHOTOS, as a button on the row (owner item 10,
           2026-09-19: "before & after pictures" belongs with the other action
           buttons). Same gate the panel above the row had — the Helpr has
           marked the job done AND there is something to look at — so this
           changes WHERE the proof is, never WHEN it is offered. A chip with an
           empty gallery behind it would be a dead-end tap. */
        showApprove && hasProof ? (
          <JobActionChip
            key="photos"
            icon={Image}
            label="Photos"
            ariaLabel="Photos — your Helpr's before and after proof photos; check these before you approve"
            tone="neutral"
            onClick={() => setPhotosOpen(true)}
          />
        ) : null,
        /* THE REST OF THE STALLED NOTICE, behind one tap (owner item 7, second
           pass). `neutral` is the row's SUPPORTING tone — this neither decides
           anything nor destroys anything, and it must not compete with the
           No-Show chip beside it, which is the poster's real move here. */
        stalled ? (
          <JobActionChip
            key="why"
            icon={HelpCircle}
            label="Why?"
            ariaLabel="Why? — what happens next while this job waits, and what your payment is doing"
            tone="neutral"
            onClick={() => setWhyOpen(true)}
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
        <>
          {/* Rendered last and occupying no layout (JobStepCard `dialogs`), so
              the gallery costs the row nothing. */}
          <PhotoProofDialog
            open={photosOpen}
            onOpenChange={setPhotosOpen}
            beforeUrls={job.proof_before_urls || []}
            afterUrls={job.proof_after_urls || []}
          />
          {/* The stalled notice's detail. It REPEATS the visible sentence at
              the top rather than only showing the remainder: someone who taps
              "Why?" has usually stopped reading the line above it, and the two
              halves are one explanation. Both strings come from the sweep's own
              module, so the card and the cron can never tell different stories.
              There is nothing for the poster to DO here, so the footer holds a
              dismiss and nothing else — the shared shape's "dismiss only" case,
              not an exemption from it. Leaving the X as the sole exit would
              have made this the one popup in the app without a 44px way out,
              which is the same inconsistency the owner reported in item 9. */}
          <Dialog open={whyOpen} onOpenChange={setWhyOpen}>
            <DialogContent>
              <DialogHero title={STALLED_APPROVE_DETAIL_TITLE} />
              <div className="space-y-2">
                <p className="font-sans text-ds-13 leading-relaxed" style={{ color: "hsl(var(--ink-deep))" }}>
                  {STALLED_APPROVE_DISABLED_REASON}
                </p>
                <p className="font-sans text-ds-13 leading-relaxed" style={{ color: "hsl(var(--olivewood))" }}>
                  {STALLED_APPROVE_DISABLED_DETAIL}
                </p>
              </div>
              <DialogFooter>
                <DialogSecondaryAction onClick={() => setWhyOpen(false)}>Close</DialogSecondaryAction>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {showApprove ? (
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
          ) : null}
        </>
      }
    />
  );
}
