import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AUTO_COMPLETE_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";
import { DollarSign, XCircle, CheckCircle2, RotateCcw, Star, MessageSquare, MessageCircle, Pencil, AlertTriangle, Rocket, Wrench, Flag } from "lucide-react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { SosShareButton } from "@/components/SosShareButton";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { CompletionChoiceSheet } from "@/components/activity/CompletionChoiceSheet";
import { hasJobStarted } from "@/lib/dateUtils";
import { type Job } from "../activityConstants";
import {
  JobActionRow,
  JobActionChip,
  JOB_ACTION_CHIP_CLASS,
  JOB_ACTION_FULL_CLASS,
  jobActionChipStyle,
} from "../JobActionRow";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { shouldShowDisputeLink } from "@/components/jobs/DisputeLink";

interface PostedJobActionsProps {
  job: Job;
  userId: string;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  onBoost: (jobId: string) => void;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  /**
   * NO LONGER READ HERE — kept only so PostedJobCard keeps compiling while it
   * still passes it.
   *
   * It opened the revision dialog from the `completed` action row, and the
   * server can never accept that: `create-payment`'s `request_revision` branch
   * requires `job.status === 'in_progress'`, and the transition matrix in
   * 20260828020000_cancellation_requires_rpc.sql has no `completed ->
   * revision_requested` edge. The poster typed their note FIRST
   * (ActivityDialogs gates submit on non-empty text), so every tap threw their
   * writing away behind an error. The revision path that DOES work is
   * CompletionChoiceSheet's — offered on the in_progress card, where the
   * server accepts it. Drop this prop from PostedJobCard and Activity.tsx.
   */
  onRevision: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  onReport: (job: Job) => void;
  onViewDispute: (job: Job) => void;
  onConfirmArrival: (jobId: string) => void;
  confirmingArrivalJobId: string | null;
  onConfirmWorking: (jobId: string) => void;
  confirmingWorkingJobId: string | null;
  onActionComplete: () => void;
}

/**
 * PostedJobActions — the state-specific action area (pending approval / open /
 * accepted / in-progress / revision / completed / disputed) at the bottom of a
 * PostedJobCard. Extracted verbatim from PostedJobCard; owns the completion
 * sheet, the resolve-dispute confirm, and the dispute-action in-flight state
 * that only this section reads.
 *
 * EVERY job_status must land in a branch, or be classified `false` in
 * STATUS_RENDERS_ACTIONS so the early return sends it out as `null`. A status
 * that falls through them all still renders this component's ruled, padded
 * shell around an empty div — a band of card stock with no controls in it.
 * That is what `pending_approval` did, twice.
 *
 * That sentence used to be the whole safeguard, and it failed twice — a comment
 * cannot fail a build. STATUS_RENDERS_ACTIONS below turns it into a type error.
 */

/**
 * Which statuses this component actually renders controls for.
 *
 * `satisfies Record<Job["status"], boolean>` is the entire point: `Job["status"]`
 * IS the `job_status` DB enum (activityConstants.ts:5 → generated types), so
 * adding a value to that enum and regenerating types makes THIS OBJECT a
 * compile error until somebody classifies the new status. The failure mode this
 * replaces is silent and visual — a status with no branch fell through the JSX
 * chain below and left the component's bordered `px-4 py-3` shell wrapped
 * around an empty `space-y-2`, i.e. a ruled band of blank card stock where the
 * poster's controls should be. It shipped that way for `pending_approval`
 * twice — once with no branch, and again after its branch was deleted as
 * residue without this map being updated to match. A comment saying "every status must land in a branch" cannot
 * enforce itself; this can.
 *
 * `false` is a real answer, not an omission — it means "this status
 * deliberately has no actions here", and the reason belongs beside it.
 */
const STATUS_RENDERS_ACTIONS = {
  open: true,
  accepted: true,
  in_progress: true,
  revision_requested: true,
  completed: true,
  disputed: true,
  /**
   * FALSE, and the key stays. Nothing in the product can produce this status:
   * the `businesses` table it belongs to does not exist in the database,
   * `initialStatus` has zero call sites so the post flow can never write it,
   * and there is no `/business` route for the approver notification to link
   * to. The only rows carrying it are seed fixtures. The key is kept because
   * `satisfies Record<Job["status"], boolean>` requires it — `job_status` is
   * still a DB enum value — and because `false` is the answer that routes it
   * through the early return below, which renders NOTHING. Deleting the key
   * would be a compile error, which is the guard doing its job; deleting the
   * branch without setting this to `false` would put the empty bordered band
   * back, which is the bug that started this.
   */
  pending_approval: false,
  /** Its one move, "Re-post This Job", is rendered by the card, not here. */
  cancelled: false,
} as const satisfies Record<Job["status"], boolean>;
export function PostedJobActions({
  job,
  userId,
  helperNames,
  completedJobMeta,
  onBoost,
  onEdit,
  onCancel,
  onComplete,
  completingJobId,
  // onRevision — deliberately not destructured; see the interface note.
  onNoShow,
  onTip,
  onReview,
  onDispute,
  onReport,
  onViewDispute,
  onConfirmArrival,
  confirmingArrivalJobId,
  onConfirmWorking,
  confirmingWorkingJobId,
  onActionComplete,
}: PostedJobActionsProps) {
  // Own instant-release flag — when on, the 24h review countdown is replaced
  // by an honest "releases within minutes" line (owner, 2026-08-24). Cast:
  // generated types predate migration 20260824238000.
  const { profile: _ownProfile } = useCurrentUser();
  const instantReleaseOn = !!(_ownProfile as { auto_release_on_complete?: boolean } | null)?.auto_release_on_complete;
  const navigate = useNavigate();
  const [completionSheetOpen, setCompletionSheetOpen] = useState(false);
  // Guards the Resolve & Pay / Escalate to Admin buttons while their
  // supabase UPDATE is in-flight — prevents double-tap submission.
  const [disputeActing, setDisputeActing] = useState(false);
  // Resolving a dispute RELEASES THE FULL ESCROW. It was a single tap on a
  // chip whose label ("Mark Resolved") and spoken name ("Mark this dispute
  // resolved") both said "close a ticket" and neither said "move money" —
  // while Approve, the exact same money action one state earlier, opens
  // CompletionChoiceSheet first. Same consequence, same class of confirm.
  const [resolveConfirmOpen, setResolveConfirmOpen] = useState(false);

  // Lifted out of the chip's onClick so the confirm dialog below can call the
  // same code path — the chip now only opens the dialog. Body is otherwise
  // unchanged apart from the success toast it never had.
  const resolveDisputeAndRelease = async () => {
    setDisputeActing(true);
    try {
      // Two steps, both server-side: close the dispute record
      // (rpc_withdraw_dispute hands the job back to 'in_progress'), then
      // settle through the SAME release path an ordinary completion uses.
      // The old version wrote status='completed' straight from the client and
      // promised the helper payment that no release path would ever pick up —
      // escrow stayed held forever.
      const { error } = await supabase.rpc("rpc_withdraw_dispute" as never, { _job_id: job.id } as never);
      if (error) { hapticError(); toast.error("We couldn't mark that resolved — please try again."); return; }
      const { data: releaseData, error: releaseError } = await supabase.functions.invoke("create-payment", { body: { action: "release", jobId: job.id } });
      if (releaseError || releaseData?.error) {
        report(releaseError ?? new Error(String(releaseData?.error)), { tags: { source: "PostedJobCard.resolveDisputeRelease" }, context: { job_id: job.id } });
        hapticError();
        toast.error("Dispute closed, but the payment didn't release. Contact support so we can finish it.");
        onActionComplete();
        return;
      }
      if (job.helper_id) await createNotification({ user_id: job.helper_id, title: "Dispute resolved ✓", message: `The poster confirmed the issue on "${job.title}" is resolved. Payment will be released.`, // `?job=` — `completed` is a legacy key (the chip is "Done"), and the
        // payment is still releasing, so the bucket is not settled yet.
        type: "payment", link: `/my-jobs?job=${job.id}` });
      hapticSuccess();
      // The one action in this card that moves money and said NOTHING when it
      // landed — every sibling handler (confirm arrival, confirm working)
      // toasts. Silence after releasing escrow reads as "did that work?".
      toast.success("Dispute resolved — payment released to your Helpr.");
      onActionComplete();
    } finally {
      setDisputeActing(false);
    }
  };

  // THE EXHAUSTIVENESS GATE — see STATUS_RENDERS_ACTIONS above.
  //
  // A cancelled job has no actions here — its one move ("Re-post This Job")
  // is rendered by the card itself. Without this the component still returned
  // its bordered, padded shell around an empty div, so every cancelled card
  // carried a ~44px band of ruled card stock below the button with nothing in
  // it (owner: "remove this spacing").
  //
  // The `?? false` is the other half: a status the generated types have never
  // heard of (types.ts is a SNAPSHOT of the DB enum, so it can lag a migration
  // by a deploy) is missing from the map at RUNTIME, and falls out here as
  // "renders nothing" rather than as the empty band. Reported, not swallowed —
  // an unknown status means the card is silently offering a poster no controls
  // at all, which we want to see in Sentry rather than in a screenshot.
  if (!(STATUS_RENDERS_ACTIONS[job.status] ?? false)) {
    if (!(job.status in STATUS_RENDERS_ACTIONS)) {
      report(new Error(`PostedJobActions: unhandled job status "${job.status}"`), {
        tags: { area: "activity", jobId: job.id, status: String(job.status) },
      });
    }
    return null;
  }

  return (
    // STOP THE CLICK HERE (owner: "the job card shouldn't expand every time a
    // button is clicked at the bottom of the card").
    //
    // The card shell owns the expand toggle — a deliberate decision, the
    // chevron was dropped in favour of it — so every click inside the card
    // bubbles up to it. Tapping Share, Boost, Edit or Cancel therefore fired
    // the action AND toggled the card underneath it. Now that cards open
    // collapsed, that stray toggle would COLLAPSE the row you just tapped.
    //
    // One wrapper rather than a stopPropagation on each of a dozen handlers:
    // this subtree is nothing but controls, so there is no click in it that
    // was ever meant to reach the shell. Same pattern the JobTracking and
    // status-gated blocks in PostedJobCard already use, and the same one
    // PostedJobApplicants uses on its own root.
    //
    // It cannot swallow anything a child needs: this is the OUTERMOST node of
    // the subtree, so every child handler has already run by the time the
    // event reaches it — stopping here only prevents the shell's toggle.
    <div
      className="border-t border-[hsl(var(--olivewood)/0.1)] bg-card px-4 py-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="space-y-2">
        {/* NO `pending_approval` BRANCH — the state itself is residue.

            Owner, 2026-08-30, on the amber panel that used to be here
            ("Waiting on your team's approver…"): "waiting on team?? what team??
            no such thing." They are right, and it checks out end to end:
            `public.businesses` does not exist (a query returns PGRST205), no
            call site anywhere in `src/` passes `initialStatus`, so the post
            flow cannot produce this status, there is no `/business` route in
            the router, and migration 20260828011811_remove_business_seats_residue
            already recorded that the approver notification links to a route
            that isn't there. The only rows in this state are seed fixtures with
            a null `business_id` — the status was written by fixtures, not
            earned. Explaining a team-approval queue to a poster who has no team
            is worse than saying nothing.

            So the status renders NOTHING now — see STATUS_RENDERS_ACTIONS,
            where it is `false` — and "nothing" means the early return above,
            not this component's bordered shell wrapped around an empty
            `space-y-2`. That empty band is the defect this whole area has now
            shipped twice; the gate is what stops it a third time. */}
        {job.status === "open" && (() => {
          // Boost cooldown — show when the job is currently
          // boosted so the poster knows the boost is running
          // and when they can re-boost (after expiry).
          const boostExp = job.boost_expires_at
            ? new Date(job.boost_expires_at)
            : null;
          const isBoosted = boostExp && boostExp > new Date();
          return (
          <>
            {isBoosted && (
              <div
                className="rounded-ds-md px-3 py-2 mb-2 flex items-center gap-2"
                style={{
                  background: "hsl(var(--gold-warm) / 0.10)",
                  border: "0.5px solid hsl(var(--gold-warm) / 0.32)",
                }}
              >
                <Rocket className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--gold-warm))" }} strokeWidth={2.25} />
                <p
                  className="font-serif italic leading-snug text-ds-12"
                  style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
                    Boosted until {boostExp.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}.
                  </span>{" "}
                  Re-boost available after expiry.
                </p>
              </div>
            )}
            {/* Color-coded actions — each lever gets its own muted
                hue so the row reads at a glance without shouting:
                Share = blue, Boost = orange (visibility), Edit =
                gold/yellow, Cancel = red. Order is Share, Boost, Edit,
                Cancel — least destructive first, Cancel last so the
                one irreversible action is furthest from the thumb's
                resting position. Applicants (above) stays
                the single solid-green primary, so these four sit
                together as one secondary icon row — Boost included,
                not promoted to a full-width near-primary. Tints are
                kept low so it's colorful, not loud. */}
            <div className="space-y-2">
              {/* Compact glanceable row: at 375px four labelled
                  pills won't fit side-by-side, so each cell stacks
                  its icon over a small label. Keeps every action
                  named (clearer than icon-only) while the color
                  tints still let the row read at a glance. */}
              {/* Rendered through the shared JobActionRow/JobActionChip that
                  was extracted FROM this row. Colours are carried across
                  verbatim in jobActionChipStyle — the only rendered change is
                  the 44px minimum height these were ~3px short of. */}
              <JobActionRow columns={4}>
                <ShareJobButton
                  job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
                  layout="stack"
                  className={JOB_ACTION_CHIP_CLASS}
                  style={jobActionChipStyle("share")}
                />
                <JobActionChip
                  icon={Rocket}
                  label={isBoosted ? "Boosted" : "Boost"}
                  tone="boost"
                  disabled={!!isBoosted}
                  onClick={() => onBoost(job.id)}
                />
                <JobActionChip
                  icon={Pencil}
                  label="Edit"
                  ariaLabel="Edit job"
                  tone="edit"
                  onClick={() => onEdit(job)}
                />
                <JobActionChip
                  icon={XCircle}
                  label="Cancel"
                  ariaLabel="Cancel job"
                  tone="danger"
                  onClick={() => onCancel(job)}
                />
              </JobActionRow>
            </div>
          </>
          );
        })()}
        {job.status === "accepted" && (
          <div className="space-y-2">
            {/* REMOVED: "Helpr must confirm 24 hours before the job starts —
                tracking actions unlock then."
                It was the THIRD statement of one fact on a single card, and the
                least useful of the three. Directly above it, JobConfirmation
                already says "Confirmation opens in 3d 6h" with the same
                explanation and a live number; above that, JobCountdown says
                "Job starts in 4d 14h". This one restated both in flat grey with
                no number at all. Owner: "needs better organization globally."
                One fact, one place — the countdown that actually moves. */}
            {/* REMOVED: "Confirm Start". It was gated on
                `startRequestedJobIds`, built from `job_checkins` rows of type
                'start_request' — and NOTHING in this codebase has ever written
                a job_checkins row (0 in prod), so the button could never
                render for anyone. What it did was set status = 'in_progress',
                which the helper's own On the Way / Arrived transition already
                does. A control that can never appear, for a state change that
                happens anyway, is not a feature to wire up — it's dead. */}
            {/* ONE chip row, same as every other state's (owner: "button
                inconsistency in size etc."). These two were the last hand-rolled
                pair in the card: a `flex gap-2` of horizontal outline Buttons at
                text-ds-15/font-bold, directly above and below icon-over-label
                chip rows at gap-1.5 and text-ds-11. Same actions, same colours —
                Message keeps `info` (the one Message tone the whole app shares)
                and Cancel keeps `danger` (owner: "cancel should be the lighter
                red"), so the semantic coding is untouched and only the geometry
                is now the row geometry. */}
            <JobActionRow columns={2}>
              <JobActionChip
                icon={MessageSquare}
                label="Message"
                ariaLabel="Message Helpr"
                tone="message"
                onClick={() => navigate(job.helper_id ? `/messages?jobId=${job.id}&userId=${job.helper_id}` : "/messages")}
              />
              <JobActionChip
                icon={XCircle}
                label="Cancel"
                ariaLabel="Cancel job"
                tone="danger"
                onClick={() => onCancel(job)}
              />
            </JobActionRow>
            {/* NO SHARE once a helpr is assigned (owner: "not sure this is
                necessary in some places"). Share exists to get more eyes on a
                job that still needs someone — on an OPEN job it is one of the
                four main actions and it stays there. On a job that is already
                booked, underway, or in a revision, the link it copies leads to
                a job nobody else can take, so the chip was a control whose
                whole purpose had already been served. */}
          </div>
        )}
        {(job.status === "in_progress" || job.status === "revision_requested") && (
          <div className="space-y-2">
            {/* No arrival BANNER — see the note on the same removal in
                PostedJobCard. The action survives, gated on the work not
                already being finished: "confirm they arrived" under a tracker
                sitting on Done is a question about a moment that has passed. */}
            {job.status === "in_progress"
              && job.helper_arrived_at
              && !job.poster_confirmed_arrival_at
              && !job.helper_completed_at && (
              /* A VOUCH, not homework (owner, 2026-08-24): these taps no
                 longer gate the helper's payout — they're evidence, so they
                 dress like the quiet secondary action they are. */
              <Button size="sm" variant="outline" className={JOB_ACTION_FULL_CLASS} style={jobActionChipStyle("primary")} disabled={confirmingArrivalJobId === job.id} onClick={() => onConfirmArrival(job.id)}>
                <CheckCircle2 className="w-4 h-4" /> {confirmingArrivalJobId === job.id ? "…" : "Confirm They Arrived"}
              </Button>
            )}
            {/* Confirm Working */}
            {job.status === "in_progress" && !job.poster_confirmed_working_at && job.poster_confirmed_arrival_at && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm" style={{ background: "hsl(var(--amber-tint) / 0.10)", color: "hsl(var(--amber-ink))" }}>
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">Is the Helpr working?</span>
                </div>
                <Button size="sm" variant="outline" className={JOB_ACTION_FULL_CLASS} style={jobActionChipStyle("primary")} disabled={confirmingWorkingJobId === job.id} onClick={() => onConfirmWorking(job.id)}>
                  <CheckCircle2 className="w-4 h-4" /> {confirmingWorkingJobId === job.id ? "…" : "Confirm They're Working"}
                </Button>
              </div>
            )}
            {/* 48h auto-release countdown after helper marks complete
                (matches auto-release-payment cron cutoff). */}
            {job.helper_completed_at && !job.poster_completed_at && !job.revision_requested_at && instantReleaseOn && (
              <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm" style={{ background: "hsl(var(--bark) / 0.08)", color: "hsl(var(--bark))" }}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium">Instant Release is on — payment releases within minutes. Request a revision now if something's wrong.</span>
              </div>
            )}
            {job.helper_completed_at && !job.poster_completed_at && !job.revision_requested_at && !instantReleaseOn && (
              <DeadlineCountdown
                deadline={new Date(new Date(job.helper_completed_at).getTime() + hoursToMs(AUTO_COMPLETE_HOURS)).toISOString()}
                expiredText={`${AUTO_COMPLETE_HOURS} hours passed — payment auto-released to Helpr`}
                // One line (owner). The Approve sheet itself walks through
                // release vs revision, so the banner only owes the deadline
                // and its consequence.
                consequenceText="to review — payment auto-releases after"
                inline
                variant="warning"
              />
            )}
            {/* ONE icon-over-label action row for the whole in-progress state.

                It used to be three stacked full-width buttons around the chip
                row — "Approve & release payment", "Request a revision
                instead", "Still unresolved? File a formal dispute" — plus the
                DisputeLink footer, so a single card could stack four
                full-width controls around a four-up chip row. Owner: one
                consistent icon row per card, not a different arrangement per
                state.

                Order is SOS · Share · Message · Approve · No-Show/Dispute, with
                SOS relocated here out of the tracking card's header (owner:
                "move sos to the left of messages and move messages to the right
                of share").

                Two controls were FOLDED IN rather than moved, because they were
                duplicates:
                  - "Request a revision instead" — the Approve chip opens
                    CompletionChoiceSheet, which is itself the two-path
                    confirm-or-request-a-revision sheet. The ghost button was a
                    second door onto the same sheet's second path.
                  - the deadline-gated "Still unresolved? File a formal dispute"
                    button and the DisputeLink footer both call onDispute for a
                    revision_requested job; the Dispute chip is the single
                    affordance now, gated by DisputeLink's own exported
                    visibility predicate so the rules did not fork.

                Visible labels are terse ("Message", not "Message Helpr") so
                nothing truncates at 320px; the full name is on aria-label, so
                the spoken name is unabbreviated. */}
            {(() => {
              // Owner's rule: No-Show is tied to the CLOCK, not to whether the
              // helper accepted — hidden until the scheduled start time has come
              // and gone. (It used to appear as soon as the job was offered when
              // the helper had marked themselves on-the-way an hour earlier.)
              const showNoShow =
                job.status === "in_progress" &&
                !job.poster_completed_at &&
                !job.helper_arrived_at &&
                hasJobStarted(job.date_needed, job.start_time);
              // SOS is a personal-safety escalation, so it is gated on the
              // helper actually BEING on site — the arrival stamp, not the
              // on-the-way one (owner: "SOS should be when they are there
              // arrived and working"). Someone still driving over is not a
              // safety situation yet, and an SOS offered then reads as routine.
              // ...and it ENDS when the job does (owner: "if they're done
              // remove SOS"). `helper_arrived_at` is a stamp, never cleared, so
              // on its own it kept a personal-safety escalation on the card
              // forever — including on a finished job sitting in history, where
              // the helper left days ago and there is no situation to escalate.
              // A safety control that outlives the situation is noise, and
              // noise is what gets ignored when it matters.
              // Either side's completion stamp marks it over. The tracker's
              // "Done" step lights on `helper_completed_at`, and a card whose
              // own tracker says Done while its action row still offers SOS is
              // contradicting itself (owner, 2026-08-24: "if the job tracker
              // is on done then the bottom buttons should not be that") — the
              // helper has finished and left; there is no live situation.
              // (The status union on this branch is only in_progress |
              // revision_requested, so status comparisons stay dead code.)
              const jobIsOver = !!job.poster_completed_at || !!job.helper_completed_at;
              const showSos = !!job.helper_arrived_at && !jobIsOver;
              const showApprove = !!job.helper_completed_at;
              // Dispute only where the shared predicate already allows it (an
              // open revision on the customer side) — no new dispute surface,
              // just the existing one moved into the row.
              const showDispute = shouldShowDisputeLink(job, "customer");
              // Base of ONE — Message. It was two while Share sat beside it;
              // see the note above on why Share is gone from an assigned job.
              const columns = Math.min(
                1 +
                  (showSos ? 1 : 0) +
                  (showApprove ? 1 : 0) +
                  (showNoShow ? 1 : 0) +
                  (showDispute ? 1 : 0),
                5,
              ) as 2 | 3 | 4 | 5;
              // The proof photos the helper uploaded, ON the screen where the
              // poster releases the money. Both other PhotoProofGroup call
              // sites in this file are gated on `completed` / `disputed`, so
              // at Approve time — status still in_progress, helper_completed_at
              // set — neither fired and the proof only appeared AFTER the
              // release. The helper's own upload copy says "they're the proof
              // that releases your payment", which was not true of the
              // approver's view: the poster was asked to release escrow on a
              // description of the work rather than a picture of it.
              const hasProof =
                (job.proof_before_urls?.length ?? 0) > 0 ||
                (job.proof_after_urls?.length ?? 0) > 0;
              return (
                <>
                  {showApprove && hasProof && (
                    <div className="space-y-1.5">
                      <p
                        className="font-serif italic leading-snug text-ds-11 px-1"
                        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                      >
                        Your Helpr's proof photos — check these before you approve.
                      </p>
                      <PhotoProofGroup
                        jobId={job.id}
                        beforeUrls={job.proof_before_urls || []}
                        afterUrls={job.proof_after_urls || []}
                        canUpload={false}
                      />
                    </div>
                  )}
                  <JobActionRow columns={columns}>
                    {showSos && <SosShareButton jobId={job.id} variant="chip" />}
                    {showNoShow && (
                      <JobActionChip
                        icon={XCircle}
                        label="No-Show"
                        // ARIA STARTS WITH THE VISIBLE LABEL (WCAG 2.5.3).
                        // JobActionRow sets aria-label, which REPLACES the
                        // name rather than adding to it, so "Report the Helpr
                        // as a no-show" made the visible word "No-Show" a name
                        // voice control could not say. Label first, context
                        // after — the same shape every chip in this file now
                        // uses.
                        ariaLabel="No-Show — report that the Helpr never turned up"
                        tone="danger"
                        onClick={() => onNoShow(job.id)}
                      />
                    )}
                    {showDispute && (
                      <JobActionChip
                        icon={AlertTriangle}
                        label="Dispute"
                        ariaLabel="Dispute — something wrong? open a dispute about this job"
                        tone="danger"
                        onClick={() => onDispute(job)}
                      />
                    )}
                    {/* ORDER, GLOBALLY: danger left · Message middle · Approve
                        right (owner: "move to middle globally and dispute or
                        SOS on left").

                        Message is the one action present on EVERY assigned job,
                        so it is the fixed point the eye scans to; the
                        situational chips (SOS, No-show, Dispute) queue to its
                        left and the terminal one (Approve) stays right. That
                        also keeps the two consequential ends apart — the
                        escalation and the release of money never land next to
                        each other under a thumb. */}
                    <JobActionChip
                      icon={MessageCircle}
                      label="Message"
                      ariaLabel="Message Helpr"
                      // Quiet olivewood outline — owner call 2026-08-24
                      // ("brand the action buttons"), superseding the earlier
                      // blue. Still one Message colour everywhere.
                      tone="message"
                      // Straight into the thread with THIS helpr on THIS job, not
                      // the conversation list — owner: "when I tap message it
                      // should take me right into Eli's message". Same
                      // jobId+userId contract the card's other Message entry
                      // points already use.
                      onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}
                    />
                    {showApprove && (
                      <JobActionChip
                        icon={CheckCircle2}
                        label={job.poster_completed_at ? "Approved" : "Approve"}
                        // Tracks the visible label through both states, so the
                        // spoken name still opens with the word on the chip.
                        ariaLabel={job.poster_completed_at
                          ? "Approved — you already released payment for this job"
                          : "Approve — accept the work and release payment to your Helpr"}
                        tone="approve"
                        disabled={completingJobId === job.id || !!job.poster_completed_at}
                        onClick={() => {
                          if (!job.poster_completed_at) {
                            setCompletionSheetOpen(true);
                          }
                        }}
                      />
                    )}
                  </JobActionRow>
                  {/* Why Review and Tip are not on this row yet. Approving IS
                      the escrow release, and both unlock only once the money
                      has moved (canReview gates on payment_status released /
                      payout_pending), so the order is real — but nothing said
                      so, and the card read as if the two actions had gone
                      missing (owner, 2026-08-25: "if the tracker shows done,
                      why does the card say message or approve? Where is review
                      and tip?"). One line, only while Approve is the pending
                      step. */}
                  {showApprove && (
                    <p
                      className="font-serif italic leading-snug text-ds-11 px-1"
                      style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                    >
                      Approve to release payment — then you can review and tip.
                    </p>
                  )}
                  {showApprove && (
                    <CompletionChoiceSheet
                      open={completionSheetOpen}
                      jobId={job.id}
                      jobTitle={job.title}
                      helperId={job.helper_id}
                      helperName={job.helper_id ? (helperNames[job.helper_id] || "Helpr") : "Helpr"}
                      userId={userId}
                      proofBeforeUrls={job.proof_before_urls || []}
                      proofAfterUrls={job.proof_after_urls || []}
                      onClose={() => setCompletionSheetOpen(false)}
                      onConfirm={() => onComplete(job.id)}
                      onRevisionSubmitted={onActionComplete}
                    />
                  )}
                </>
              );
            })()}
          </div>
        )}
        {job.status === "completed" && (() => {
          const meta = completedJobMeta[job.id];
          const hasTipped = meta?.tipped;
          const hasReviewed = meta?.reviewed;
          const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";
          return (
            <div className="space-y-2">
              {/* Photo proof only when there IS any (owner: "move to the
                  collapsed part"). An empty group printed a header plus "No
                  photos were uploaded for this job" — two rows of chrome to
                  report an absence — directly above the action row on every
                  completed job. When photos exist the group still renders here;
                  the expandable body below carries the rest of the detail. */}
              {((job.proof_before_urls?.length ?? 0) > 0 ||
                (job.proof_after_urls?.length ?? 0) > 0) && (
                <PhotoProofGroup
                  jobId={job.id}
                  beforeUrls={job.proof_before_urls || []}
                  afterUrls={job.proof_after_urls || []}
                  canUpload={false}
                />
              )}
              {/* ONE icon-over-label action row, same shape as the
                  in-progress state's. Tip / Review / Hire again / Something
                  wrong were four stacked full-width buttons (plus an italic
                  "request a revision first" footnote and the DisputeLink
                  footer) — six rows of chrome on a job that is already done.
                  Owner: one consistent icon row per card, not a different
                  arrangement per state.

                  The fourth slot is the single "something wrong" affordance:
                  Dispute, gated by DisputeLink's own exported predicate, so
                  the 7-day window and the never-double-file rule are
                  unchanged.

                  It used to be Revision first, Dispute second. The Revision
                  half is GONE — not re-routed, deleted — because the server
                  could never accept it. It was gated on
                  `!poster_completed_at && !revision_requested_at`, which on a
                  `completed` job selects exactly the population that got here
                  by AUTO-RELEASE; `create-payment`'s request_revision branch
                  requires `job.status === 'in_progress'` and the transition
                  matrix has no `completed -> revision_requested` edge, so the
                  chip failed 100% of the time. Worse, ActivityDialogs makes
                  the poster type the revision note BEFORE it will submit, so
                  every tap threw their writing away behind an error toast. */}
              {(() => {
                // Approving completion leaves the job at 'payout_pending' until
                // the transfer settles (hours later), so gating the Review chip
                // on 'released' hid it during exactly the window when the app
                // auto-opens the rating sheet — dismiss that sheet and there was
                // no way back to leaving a review. Matches the reviews INSERT
                // policy, which accepts both settlement states.
                const canReview =
                  job.payment_status === "released" || job.payment_status === "payout_pending";
                // NOT after the poster approved (owner: "if the job is already
                // marked complete this should not be an option"). Approving IS
                // the release — the money has left escrow and the poster said
                // the work was good — so a Dispute chip there invites a fight
                // over a decision they already made. A job that auto-released
                // without them ever approving keeps the 7-day window: they
                // never got their say.
                //
                // That auto-released job is also the one the deleted Revision
                // chip used to sit on, so dropping the `!canRevise` term isn't
                // a widening for its own sake — it hands that poster the ONE
                // escalation the server actually honours (`completed ->
                // disputed` is in the matrix) in place of one it never would.
                const canDispute =
                  !job.poster_completed_at &&
                  shouldShowDisputeLink(job, "customer");
                // +1 for Report, unconditional on Done — a distinct
                // conduct/safety escape hatch alongside Tip/Review/Hire
                // Again, separate from the payment-dispute chip above.
                const columns = (3 + (canReview ? 1 : 0) + (canDispute ? 1 : 0)) as 3 | 4 | 5;
                return (
                  <JobActionRow columns={columns}>
                    {/* TIP IS NOT GATED ON THE HELPER BEING PAYABLE, and this
                        component cannot gate it. `create-payment` refuses a
                        tip outright when the helper has no
                        `profiles.stripe_account_id` ("This helper hasn't set
                        up their payout account yet"), so a poster picks an
                        amount, opens Checkout and is only then refused.
                        Nothing in scope here carries that fact: `job` is a
                        raw jobs row and `helperNames` is names only. Gating it
                        needs the helper's Connect status plumbed down —
                        cheapest honest shape is a
                        `helperPayoutReady: Record<string, boolean>` built
                        beside `helperNames` from
                        `profiles.stripe_account_id IS NOT NULL` (the exact
                        field the edge function checks). Not guessed at here.*/}
                    {!hasTipped ? (
                      <JobActionChip
                        icon={DollarSign}
                        label="Tip"
                        ariaLabel={`Tip ${helperName}`}
                        tone="boost"
                        onClick={() => onTip(job.id, helperName)}
                      />
                    ) : (
                      <JobActionChip
                        icon={CheckCircle2}
                        label="Tipped"
                        ariaLabel={`Tipped — you already tipped ${helperName}`}
                        tone="done"
                        disabled
                        onClick={() => {}}
                      />
                    )}
                    {canReview && (
                      !hasReviewed ? (
                        <JobActionChip
                          icon={Star}
                          label="Review"
                          ariaLabel={`Review — leave a review for ${helperName}`}
                          tone="edit"
                          onClick={() => onReview(job)}
                        />
                      ) : (
                        <JobActionChip
                          icon={CheckCircle2}
                          label="Reviewed"
                          ariaLabel={`Reviewed — you already reviewed ${helperName}`}
                          tone="done"
                          disabled
                          onClick={() => {}}
                        />
                      )
                    )}
                    {canDispute && (
                      <JobActionChip
                        icon={AlertTriangle}
                        label="Dispute"
                        ariaLabel="Dispute — something wrong? open a dispute about this job"
                        tone="danger"
                        onClick={() => onDispute(job)}
                      />
                    )}
                    {/* Hire again — direct offer to the same helper.
                        Routes to PostJob with offerTo + rebook query so
                        the form is prefilled AND the offer goes straight
                        to them (skipping the open-application queue). */}
                    {job.helper_id ? (
                      <JobActionChip
                        icon={RotateCcw}
                        label="Hire Again"
                        ariaLabel={`Hire Again — hire ${helperName} for a new job`}
                        tone="primary"
                        onClick={() => navigate(`/post-job?rebook=${job.id}&offerTo=${job.helper_id}`)}
                      />
                    ) : (
                      <JobActionChip
                        icon={RotateCcw}
                        label="Re-Post"
                        ariaLabel="Re-Post — post this job again"
                        tone="primary"
                        onClick={() => navigate(`/post-job?rebook=${job.id}`)}
                      />
                    )}
                    {/* Report — a distinct escape hatch from Dispute above:
                        Dispute is a payment disagreement while the job is
                        still settling; Report is for a conduct/safety
                        concern once the job is already over.

                        Its aria used to end "…with this job or Helpr" — a
                        promise the control does not keep. Activity.tsx opens
                        ReportDialog with reportedType="job", so the PERSON
                        cannot be reported from here at all; the spoken name
                        now describes only what the tap actually does. */}
                    <JobActionChip
                      icon={Flag}
                      /* "Report Job", not "Report" (owner, on the Done tab:
                         "if the job is done why would they report it? change
                         that to report job or something"). A bare "Report"
                         beside Tip / Reviewed / Hire Again names no object, so
                         on a finished job it reads as an offer to report
                         something that is already over — the listing? the
                         Helpr? a payment? Naming the object is the fix, and it
                         is also the honest one: this chip really can only
                         report the JOB.

                         Two words, not "Report a problem": this is a 5-up chip
                         row at 320px, and the shorter label is the one that
                         stays on one line beside "Hire Again". */
                      label="Report Job"
                      ariaLabel="Report Job — report a problem with this job"
                      tone="danger"
                      onClick={() => onReport(job)}
                    />
                  </JobActionRow>
                );
              })()}
            </div>
          );
        })()}
        {job.status === "disputed" && (() => {
          const disputeStatus = job.dispute_status || "open";
          const isDisputer = job.disputed_by === userId;
          // Once escalated, nothing auto-releases and there is nothing for the
          // poster to do — `auto-resolve-disputes` skips escalated disputes and
          // only nags admins. Both the 72h countdown and the static policy box
          // below therefore have to stay quiet, or they promise a deadline that
          // will never fire. This became load-bearing with helper_abort_job
          // (20260825190000), which opens ESCALATED disputes on purpose so a
          // helper who walked off a started job can't be paid in full by a
          // timeout — but the copy was already wrong for a poster-escalated one.
          const awaitingAdmin = disputeStatus === "escalated";
          const showDeadline = !!job.dispute_deadline && disputeStatus !== "resolved" && !awaitingAdmin;
          return (
          <div className="space-y-2">
            {job.poster_confirmed_working_at && (
              <PhotoProofGroup
                jobId={job.id}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
                canUploadBefore={false}
                canUploadAfter={false}
                requireAfter={true}
                budget={job.budget}
              />
            )}
            <div className="p-3 rounded-ds-sm bg-destructive/5 border border-destructive/20">
              <p className="text-ds-11 text-[hsl(var(--destructive-ink))] font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />
                {disputeStatus === "escalated" ? "Escalated to Admin" : disputeStatus === "resolved" ? "Dispute Resolved" : "Dispute Under Review"}
              </p>
              {/* The "Admin is reviewing…" line used to be its OWN separate
                  gray box below this one — two stacked boxes saying
                  overlapping things about the same escalated dispute.
                  Merged into this box's body copy instead. */}
              <p className="text-ds-11 text-muted-foreground mt-1">
                {awaitingAdmin
                  ? "Admin is reviewing this dispute. You'll be notified of the outcome, and nothing is charged or released until then."
                  : "Payment is on hold pending resolution."}
              </p>
              {job.dispute_reason && <p className="text-ds-11 text-muted-foreground mt-1 italic">"{job.dispute_reason}"</p>}
              {job.dispute_helper_response && (
                <div className="mt-2 p-2 rounded bg-muted/50">
                  <p className="text-ds-10 text-muted-foreground font-medium">Helpr's response:</p>
                  <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
                </div>
              )}
              {showDeadline && job.dispute_deadline && (
                <DeadlineCountdown
                  deadline={job.dispute_deadline}
                  expiredText="Deadline passed — payment auto-releasing to Helpr"
                  consequenceText="Confirm the issue is fixed or escalate to admin. If no action is taken, payment auto-releases to the Helpr."
                  variant="destructive"
                />
              )}
            </div>
            {/* Static fallback ONLY when there is no live deadline to count
                (owner, 2026-08-24 transition audit): with dispute_deadline
                present, the DeadlineCountdown above already says all of this
                with a live number — the box was the same sentence twice. */}
            {!showDeadline && !awaitingAdmin && (
              <div className="p-2 rounded-ds-sm bg-card">
                <p className="text-ds-10 text-muted-foreground leading-relaxed">
                  <strong>Policy:</strong> You have 72 hours to confirm the issue is fixed or escalate to admin. If you do nothing, payment auto-releases to the Helpr.
                </p>
              </div>
            )}
            {/* Disputer actions: Resolve & Pay or Escalate */}
            {isDisputer && disputeStatus === "open" && (
              /* Same JobActionRow every other state uses — this was a
                 hand-rolled `grid-cols-2 gap-2` of a SOLID success button
                 beside an outline one, the loudest pair in the card, on the
                 card that least needs shouting. Tones carry the semantics
                 instead: `approve` for the resolution, `danger` for the
                 escalation. */
              <>
              <JobActionRow columns={2}>
                {/* "Mark Resolved" was a lie of omission: one tap released the
                    ENTIRE escrow to the helper, and neither the label nor the
                    spoken name mentioned money. It is named for its
                    consequence now and confirms before it moves anything —
                    the same bar Approve already met via
                    CompletionChoiceSheet. */}
                <JobActionChip
                  icon={CheckCircle2}
                  label="Resolve & Pay"
                  ariaLabel="Resolve & Pay — close this dispute and release the payment to your Helpr"
                  tone="approve"
                  disabled={disputeActing}
                  onClick={(e) => { e.stopPropagation(); setResolveConfirmOpen(true); }}
                />
                <JobActionChip icon={AlertTriangle} label="Escalate" ariaLabel="Escalate — send this dispute to a Helpr admin to decide" tone="danger" disabled={disputeActing} onClick={async (e) => {
                  e.stopPropagation();
                  setDisputeActing(true);
                  try {
                    // BELONGS IN AN RPC, AND CANNOT BE FIXED FROM HERE.
                    //
                    // 20260825190000_dispute_single_source.sql declares
                    // public.disputes the record of truth and the jobs.dispute_*
                    // columns a denormalised mirror; every other transition has a
                    // server-side writer (rpc_open_dispute, rpc_decide_dispute,
                    // rpc_withdraw_dispute) that writes BOTH in one statement.
                    // Escalation has none, so this writes only the mirror and the
                    // disputes row stays 'open'.
                    //
                    // Mirroring it client-side is not merely unclean, it is
                    // impossible: disputes.status carries
                    // CHECK (status IN ('open','decided','withdrawn')) — no
                    // 'escalated' value — and the "disputes opener update" policy
                    // pins WITH CHECK (status = 'open'), so the write would be
                    // refused twice over. There is no escalated_at column either.
                    // FOLLOW-UP: an rpc_escalate_dispute that widens the CHECK and
                    // writes both sides. Not this lane (no new migrations here).
                    //
                    // What keeps this honest meanwhile: the admin queue reads
                    // disputes WHERE status='open', so an escalated dispute is
                    // still in it, and the fan-out below tells the admins directly.
                    try {
                      unwrapMutation(
                        await supabase.from("jobs").update({ dispute_status: "escalated" }).eq("id", job.id).select("id"),
                        { action: "escalate this dispute" },
                      );
                    } catch (err) {
                      hapticError();
                      toast.error(mutationErrorMessage(err, "We couldn't escalate that — please try again."));
                      return;
                    }
                    const { data: adminRoles, error: adminErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
                    if (adminErr) report(adminErr, { tags: { source: "PostedJobCard.escalateNotifyAdmins" } });
                    if (adminRoles) { for (const admin of adminRoles) { await createNotification({ user_id: admin.user_id, title: "🚨 Dispute escalated", message: `"${job.title}" dispute has been escalated and requires admin decision.`, type: "warning", link: "/admin", job_id: job.id }); } }
                    hapticSuccess();
                    // Escalating froze the payout and handed the decision to a
                    // human, and the card said nothing about it.
                    toast.success("Escalated — an admin will review this and decide.");
                    onActionComplete();
                  } finally {
                    setDisputeActing(false);
                  }
                }} />
              </JobActionRow>
              {/* The shared confirm — NOT a new modal. BrandConfirmDialog is
                  the shell behind every confirm in the app (Log Out, Decline
                  This Job, Delete Account) and rides the same Dialog /
                  DialogHero / .glass-modal stack dialogShell.test.ts
                  enforces. `sienna` because this is irreversible and
                  one-directional: the money leaves escrow and the dispute the
                  poster raised is over. */}
              <BrandConfirmDialog
                open={resolveConfirmOpen}
                onOpenChange={setResolveConfirmOpen}
                title="Release the payment?"
                description={`Resolving this dispute closes it and releases the full amount held for this job to ${job.helper_id ? (helperNames[job.helper_id] || "your Helpr") : "your Helpr"}. You can't reopen this dispute afterwards.`}
                callout={{ icon: DollarSign, text: "This moves real money. Only resolve if the issue is actually fixed." }}
                primaryLabel="Resolve & Release Payment"
                primaryTone="sienna"
                primaryDisabled={disputeActing}
                onPrimary={() => { void resolveDisputeAndRelease(); }}
                secondaryLabel="Cancel"
              />
              </>
            )}
            {/* View Timeline / Message / Contact Admin used to be two rows —
                View Timeline alone as a full-width button, then Message +
                Contact Admin below it as a 2-up row. Folded into one 3-up
                chip row (owner: "make one row") so the three dispute
                actions read as one group instead of a stray extra row. */}
            <JobActionRow columns={3}>
              <JobActionChip
                icon={AlertTriangle}
                /* "Timeline & Evidence", not "View Timeline & Add Evidence".
                   Five words in a chip sized for one clipped at BOTH ends —
                   the owner read it as "v Timeline & Add Evid…". The helper
                   side of this same control was already shortened to this
                   exact string, so the two ends of one dispute now name it
                   identically instead of the poster getting a longer label for
                   the same panel.

                   WCAG 2.5.3 (label in name): the accessible name still OPENS
                   with the visible text, so a voice-control user saying "click
                   Timeline and Evidence" still matches; the extra clause after
                   the dash is description, not a rename. */
                label="Timeline & Evidence"
                ariaLabel="Timeline & Evidence — this dispute's full history, and a place to attach proof"
                tone="neutral"
                onClick={() => onViewDispute(job)}
              />
              <JobActionChip
                icon={MessageSquare}
                label="Message"
                ariaLabel="Message Helpr"
                tone="message"
                onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}
              />
              <JobActionChip
                icon={AlertTriangle}
                label="Contact Admin"
                ariaLabel="Contact Admin — get help from a Helpr admin about this dispute"
                tone="neutral"
                onClick={() => navigate("/support")}
              />
            </JobActionRow>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
