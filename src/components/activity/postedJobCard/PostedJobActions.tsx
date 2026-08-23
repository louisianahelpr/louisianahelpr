import { useState } from "react";
import { messageButtonStyle } from "@/components/activity/JobActionRow";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import {
   DollarSign, XCircle, CheckCircle2, RotateCcw, Star, MessageSquare,
  MessageCircle, Pencil, AlertTriangle, Rocket, Clock, Wrench,
} from "lucide-react";
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
  jobActionChipStyle,
} from "../JobActionRow";
import { ShareJobButton } from "@/components/jobs/ShareJobButton";
import { shouldShowDisputeLink } from "@/components/jobs/DisputeLink";

interface PostedJobActionsProps {
  job: Job;
  userId: string;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  startRequestedJobIds: Set<string>;
  onBoost: (jobId: string) => void;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onRevision: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  onViewDispute: (job: Job) => void;
  onConfirmStart: (jobId: string) => void;
  confirmingStartJobId: string | null;
  onConfirmArrival: (jobId: string) => void;
  confirmingArrivalJobId: string | null;
  onConfirmWorking: (jobId: string) => void;
  confirmingWorkingJobId: string | null;
  onActionComplete: () => void;
}

/**
 * PostedJobActions — the state-specific action area (open / accepted /
 * in-progress / revision / completed / disputed) at the bottom of a
 * PostedJobCard. Extracted verbatim from PostedJobCard; owns the completion
 * sheet + dispute-action in-flight state that only this section reads.
 */
export function PostedJobActions({
  job,
  userId,
  helperNames,
  completedJobMeta,
  startRequestedJobIds,
  onBoost,
  onEdit,
  onCancel,
  onComplete,
  completingJobId,
  onRevision,
  onNoShow,
  onTip,
  onReview,
  onDispute,
  onViewDispute,
  onConfirmStart,
  confirmingStartJobId,
  onConfirmArrival,
  confirmingArrivalJobId,
  onConfirmWorking,
  confirmingWorkingJobId,
  onActionComplete,
}: PostedJobActionsProps) {
  const navigate = useNavigate();
  const [completionSheetOpen, setCompletionSheetOpen] = useState(false);
  // Guards the Mark Resolved / Escalate to Admin buttons while their
  // supabase UPDATE is in-flight — prevents double-tap submission.
  const [disputeActing, setDisputeActing] = useState(false);

  // A cancelled job has no actions here — its one move ("Re-post This Job")
  // is rendered by the card itself. Without this the component still returned
  // its bordered, padded shell around an empty div, so every cancelled card
  // carried a ~44px band of ruled card stock below the button with nothing in
  // it (owner: "remove this spacing").
  if (job.status === "cancelled") return null;

  return (
    <div className="border-t border-[hsl(var(--olivewood)/0.1)] bg-card px-4 py-3">
      <div className="space-y-2">
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
                  style={jobActionChipStyle("info")}
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
            <p className="text-ds-11 text-muted-foreground text-center">
              <Clock className="w-3 h-3 inline mr-1" />
              Helpr must confirm 24 hours before the job starts — tracking actions unlock then
            </p>
            {startRequestedJobIds.has(job.id) && !job.helper_confirmed_at && (
              <Button size="sm" className="w-full" disabled={confirmingStartJobId === job.id} onClick={() => onConfirmStart(job.id)}>
                <CheckCircle2 className="w-4 h-4 mr-1" />
                {confirmingStartJobId === job.id ? "Starting…" : "Confirm Start"}
              </Button>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" style={messageButtonStyle} className="flex-1" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
              {/* TINTED, not a solid red slab (owner: "cancel should be the
                  lighter red, for the other tabs also"). Solid destructive is
                  the loudest surface the app has and it belongs to a
                  confirmation dialog's final button — on a card it made
                  "Cancel this job" the visually dominant thing on a job that
                  is going perfectly. Same triple the `danger` chip uses, so
                  every Cancel in Activity now reads at one volume. */}
              <Button
                size="sm"
                variant="outline"
                className="flex-1 border-0"
                style={jobActionChipStyle("danger")}
                onClick={() => onCancel(job)}
              >
                <XCircle className="w-4 h-4 mr-1" /> Cancel
              </Button>
            </div>
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
              <Button size="sm" className="w-full" disabled={confirmingArrivalJobId === job.id} onClick={() => onConfirmArrival(job.id)}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> {confirmingArrivalJobId === job.id ? "…" : "Confirm Arrival"}
              </Button>
            )}
            {/* Confirm Working */}
            {job.status === "in_progress" && !job.poster_confirmed_working_at && job.poster_confirmed_arrival_at && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm" style={{ background: "hsl(var(--amber-tint) / 0.10)", color: "hsl(var(--amber-ink))" }}>
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">Is the Helpr working?</span>
                </div>
                <Button size="sm" className="w-full" disabled={confirmingWorkingJobId === job.id} onClick={() => onConfirmWorking(job.id)}>
                  <CheckCircle2 className="w-4 h-4 mr-1" /> {confirmingWorkingJobId === job.id ? "…" : "Confirm Working"}
                </Button>
              </div>
            )}
            {/* 48h auto-release countdown after helper marks complete
                (matches auto-release-payment cron cutoff). */}
            {job.helper_completed_at && !job.poster_completed_at && !job.revision_requested_at && (
              <DeadlineCountdown
                deadline={new Date(new Date(job.helper_completed_at).getTime() + 48 * 60 * 60 * 1000).toISOString()}
                expiredText="48 hours passed — payment auto-released to Helpr"
                consequenceText="Approve & complete or request a revision before the timer expires, or payment will auto-release to the Helpr."
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
              const showSos = !!job.helper_arrived_at;
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
              return (
                <>
                  <JobActionRow columns={columns}>
                    {showSos && <SosShareButton jobId={job.id} variant="chip" />}
                    <JobActionChip
                      icon={MessageCircle}
                      label="Message"
                      ariaLabel="Message Helpr"
                      // Blue. Owner: "I think blue suits messages better."
                      tone="info"
                      // Straight into the thread with THIS helpr on THIS job, not
                      // the conversation list — owner: "when I tap message it
                      // should take me right into Eli's message". Same
                      // jobId+userId contract the card's other Message entry
                      // points already use.
                      onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}
                    />
                    {showNoShow && (
                      <JobActionChip
                        icon={XCircle}
                        label="No-Show"
                        ariaLabel="Report the Helpr as a no-show"
                        tone="danger"
                        onClick={() => onNoShow(job.id)}
                      />
                    )}
                    {showDispute && (
                      <JobActionChip
                        icon={AlertTriangle}
                        label="Dispute"
                        ariaLabel="Something wrong? Open a dispute about this job"
                        tone="danger"
                        onClick={() => onDispute(job)}
                      />
                    )}
                    {showApprove && (
                      <JobActionChip
                        icon={CheckCircle2}
                        label={job.poster_completed_at ? "Approved" : "Approve"}
                        ariaLabel="Approve the work and release payment"
                        tone="primary"
                        disabled={completingJobId === job.id || !!job.poster_completed_at}
                        onClick={() => {
                          if (!job.poster_completed_at) {
                            setCompletionSheetOpen(true);
                          }
                        }}
                      />
                    )}
                  </JobActionRow>
                  {showApprove && (
                    <CompletionChoiceSheet
                      open={completionSheetOpen}
                      jobId={job.id}
                      jobTitle={job.title}
                      helperId={job.helper_id}
                      helperName={job.helper_id ? (helperNames[job.helper_id] || "Helpr") : "Helpr"}
                      userId={userId}
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

                  The fourth slot is the single "something wrong" affordance.
                  It is Revision while the revision path is still open, and
                  Dispute once a revision has been asked for (or once the job
                  settled without one) — which is exactly what the deleted
                  footnote was explaining in prose. Its Dispute branch is gated
                  by DisputeLink's own exported predicate, so the 7-day window
                  and the never-double-file rule are unchanged. */}
              {(() => {
                const canReview = job.payment_status === "released";
                // Revision first, dispute second — same escalation order the
                // footnote used to spell out.
                const canRevise = !job.poster_completed_at && !job.revision_requested_at;
                // NOT after the poster approved (owner: "if the job is already
                // marked complete this should not be an option"). Approving IS
                // the release — the money has left escrow and the poster said
                // the work was good — so a Dispute chip there invites a fight
                // over a decision they already made. A job that auto-released
                // without them ever approving keeps the 7-day window: they
                // never got their say.
                const canDispute =
                  !canRevise &&
                  !job.poster_completed_at &&
                  shouldShowDisputeLink(job, "customer");
                const columns = (2 + (canReview ? 1 : 0) + (canRevise || canDispute ? 1 : 0)) as 2 | 3 | 4;
                return (
                  <JobActionRow columns={columns}>
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
                        ariaLabel={`Already tipped ${helperName}`}
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
                          ariaLabel={`Leave a review for ${helperName}`}
                          tone="edit"
                          onClick={() => onReview(job)}
                        />
                      ) : (
                        <JobActionChip
                          icon={CheckCircle2}
                          label="Reviewed"
                          ariaLabel={`Already reviewed ${helperName}`}
                          tone="done"
                          disabled
                          onClick={() => {}}
                        />
                      )
                    )}
                    {canRevise && (
                      <JobActionChip
                        icon={AlertTriangle}
                        label="Revision"
                        ariaLabel="Something wrong? Request a revision"
                        tone="danger"
                        onClick={() => onRevision(job.id)}
                      />
                    )}
                    {canDispute && (
                      <JobActionChip
                        icon={AlertTriangle}
                        label="Dispute"
                        ariaLabel="Something wrong? Open a dispute about this job"
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
                        label="Hire again"
                        ariaLabel={`Hire ${helperName} again`}
                        tone="primary"
                        onClick={() => navigate(`/post-job?rebook=${job.id}&offerTo=${job.helper_id}`)}
                      />
                    ) : (
                      <JobActionChip
                        icon={RotateCcw}
                        label="Re-post"
                        ariaLabel="Re-post this job"
                        tone="primary"
                        onClick={() => navigate(`/post-job?rebook=${job.id}`)}
                      />
                    )}
                  </JobActionRow>
                );
              })()}
            </div>
          );
        })()}
        {job.status === "disputed" && (() => {
          const disputeStatus = job.dispute_status || "open";
          const isDisputer = job.disputed_by === userId;
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
              <p className="text-ds-11 text-destructive font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />
                {disputeStatus === "escalated" ? "Escalated to Admin" : disputeStatus === "resolved" ? "Dispute Resolved" : "Dispute Under Review"}
              </p>
              <p className="text-ds-11 text-muted-foreground mt-1">Payment is on hold pending resolution.</p>
              {job.dispute_reason && <p className="text-ds-11 text-muted-foreground mt-1 italic">"{job.dispute_reason}"</p>}
              {job.dispute_helper_response && (
                <div className="mt-2 p-2 rounded bg-muted/50">
                  <p className="text-ds-10 text-muted-foreground font-medium">Helpr's response:</p>
                  <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
                </div>
              )}
              {job.dispute_deadline && disputeStatus !== "resolved" && (
                <DeadlineCountdown
                  deadline={job.dispute_deadline}
                  expiredText="Deadline passed — payment auto-releasing to Helpr"
                  consequenceText="Confirm the issue is fixed or escalate to admin. If no action is taken, payment auto-releases to the Helpr."
                  variant="destructive"
                />
              )}
            </div>
            <div className="p-2 rounded-ds-sm bg-card">
              <p className="text-ds-10 text-muted-foreground leading-relaxed">
                <strong>Policy:</strong> You have 72 hours to confirm the issue is fixed or escalate to admin. If you do nothing, payment auto-releases to the Helpr.
              </p>
            </div>
            {/* Disputer actions: Mark Resolved or Escalate */}
            {isDisputer && disputeStatus === "open" && (
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" disabled={disputeActing} className="w-full bg-success text-success-foreground hover:bg-success/90 disabled:opacity-60" onClick={async (e) => {
                  e.stopPropagation();
                  setDisputeActing(true);
                  try {
                    const { error } = await supabase.from("jobs").update({ status: "completed", dispute_status: "resolved", dispute_resolved_at: new Date().toISOString() }).eq("id", job.id);
                    if (error) { hapticError(); toast.error("We couldn't mark that resolved — please try again."); return; }
                    if (job.helper_id) await createNotification({ user_id: job.helper_id, title: "Dispute resolved ✓", message: `The poster confirmed the issue on "${job.title}" is resolved. Payment will be released.`, type: "payment", link: "/my-jobs?filter=completed" });
                    hapticSuccess();
                    toast.success("Dispute resolved — payment released to Helpr");
                    onActionComplete();
                  } finally {
                    setDisputeActing(false);
                  }
                }}><CheckCircle2 className="w-4 h-4 mr-1" /> Mark Resolved</Button>
                <Button size="sm" variant="outline" disabled={disputeActing} className="w-full text-[hsl(var(--danger-ink))] border-destructive/30 hover:bg-destructive/5 disabled:opacity-60" onClick={async (e) => {
                  e.stopPropagation();
                  setDisputeActing(true);
                  try {
                    const { error } = await supabase.from("jobs").update({ dispute_status: "escalated" }).eq("id", job.id);
                    if (error) { hapticError(); toast.error("We couldn't escalate that — please try again."); return; }
                    const { data: adminRoles, error: adminErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
                    if (adminErr) report(adminErr, { tags: { source: "PostedJobCard.escalateNotifyAdmins" } });
                    if (adminRoles) { for (const admin of adminRoles) { await createNotification({ user_id: admin.user_id, title: "🚨 Dispute escalated", message: `"${job.title}" dispute has been escalated and requires admin decision.`, type: "warning", link: "/admin" }); } }
                    hapticSuccess();
                    toast.success("Dispute escalated to admin for final decision");
                    onActionComplete();
                  } finally {
                    setDisputeActing(false);
                  }
                }}><AlertTriangle className="w-4 h-4 mr-1" /> Escalate to Admin</Button>
              </div>
            )}
            {isDisputer && disputeStatus === "escalated" && (
              <div className="text-ds-11 text-center text-muted-foreground px-2 py-1.5 rounded bg-muted/50">Admin is reviewing this dispute. You'll be notified of the outcome.</div>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={(e) => { e.stopPropagation(); onViewDispute(job); }}
            >
              <AlertTriangle className="w-4 h-4 mr-1" /> View timeline & add evidence
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" style={messageButtonStyle} className="w-full" onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message Helpr</Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact Admin</Button>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
