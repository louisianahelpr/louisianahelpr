import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import {
  MapPin, DollarSign, XCircle, CheckCircle2, RotateCcw, Star, MessageSquare,
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
import { DisputeLink } from "@/components/jobs/DisputeLink";

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
                {confirmingStartJobId === job.id ? "Starting…" : "Confirm start"}
              </Button>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" className="flex-1" onClick={() => onCancel(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
            </div>
            {/* Share link — lets the poster spread the word even
                after a helper has been accepted. Opens the OS
                Share Sheet on native; copies the URL on web. */}
            <ShareJobButton
              job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
              className="w-full glass-press border-0"
              style={{ background: "hsl(var(--info-tint) / 0.10)", color: "hsl(var(--info-ink))", border: "0.5px solid hsl(var(--info-tint) / 0.28)" }}
            />
          </div>
        )}
        {(job.status === "in_progress" || job.status === "revision_requested") && (
          <div className="space-y-2">
            {/* Confirm Arrival notice */}
            {job.helper_arrived_at && !job.poster_confirmed_arrival_at && (
              <div className="flex items-center gap-2 text-ds-11 px-2.5 py-1.5 rounded-ds-sm" style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}>
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} says they've arrived</span>
                <span className="ml-auto text-ds-10 text-muted-foreground">{new Date(job.helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
            {/* Confirm Arrival */}
            {job.status === "in_progress" && (
              <div className="flex items-center gap-2">
                {job.helper_arrived_at && !job.poster_confirmed_arrival_at && (
                  <Button size="sm" className="flex-1" disabled={confirmingArrivalJobId === job.id} onClick={() => onConfirmArrival(job.id)}>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> {confirmingArrivalJobId === job.id ? "…" : "Confirm Arrival"}
                  </Button>
                )}
              </div>
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
            {/* Approve & Complete (primary) — only after helper marks done.
                Opens the two-path CompletionChoiceSheet so the poster
                can either confirm ("looks great") or request a revision
                before escrow releases. */}
            {job.helper_completed_at && (
              <>
                <Button
                  size="sm"
                  className="w-full rounded-ds-md"
                  onClick={() => {
                    if (!job.poster_completed_at) {
                      setCompletionSheetOpen(true);
                    }
                  }}
                  disabled={completingJobId === job.id || !!job.poster_completed_at}
                  style={
                    !job.poster_completed_at
                      ? {
                          background: "hsl(var(--bark))",
                          backgroundImage: "none",
                          border: "1px solid hsl(var(--bark))",
                          color: "hsl(var(--parchment))",
                          boxShadow: "var(--elev-bark-raised)",
                        }
                      : undefined
                  }
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  {completingJobId === job.id ? "…" : job.poster_completed_at ? "Approved" : "Approve & release payment"}
                </Button>
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
              </>
            )}
            {/* Message / Share / No-Show as one icon-over-label row.
                These were three full-width stacked buttons, three rows deep —
                together with the tracking card they pushed the next job almost
                entirely off screen. Same shape as the four-chip row on an open
                job (owner: "this can be icons but just put the words under it
                like the other page does for shared edit etc.").

                Order is SOS · Share · Message, per the owner ("move sos to the
                left of messages and move messages to the right of share"), with
                SOS relocated here out of the tracking card's header.

                Message is SOLID BARK IN EVERY STATE. It used to demote to a
                muted tint once "Approve & release payment" appeared above it,
                which meant the same button was two different colours on two
                cards in the same list — the owner's "Message should be the same
                color for all places". Hierarchy against the Approve button is
                carried by SIZE and POSITION instead: Approve is full-width and
                sits above the row, so it still reads as the bigger move without
                Message having to change colour to say so. No-Show keeps the
                destructive tint.

                Visible labels are terse ("Message", not "Message Helpr") so
                nothing truncates in a three-up row at 320px; the full name is
                on aria-label, so the spoken name is unabbreviated. */}
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
              // Same rule as the tracker header it moved out of, which gates on
              // the "arrived" step.
              //
              // `helper_arrived_at` is the only stamp for that step and is
              // written before the helper can advance to Working, so gating on
              // it also covers the later states.
              //
              // That rule ALSO excluded completed/cancelled jobs. Those checks
              // are not repeated here: this branch only renders for a job whose
              // status is already narrowed to "in_progress" | "revision_requested",
              // so tsc rejected them as comparisons that can never be true.
              const showSos = !!job.helper_arrived_at;
              const columns = (2 + (showSos ? 1 : 0) + (showNoShow ? 1 : 0)) as 2 | 3 | 4;
              return (
                <JobActionRow columns={columns}>
                  {showSos && <SosShareButton jobId={job.id} variant="chip" />}
                  {/* ShareJobButton renders its own <Button> (it owns the
                      native-share fallback chain), so it takes the shared chip
                      class + tone rather than being wrapped. */}
                  <ShareJobButton
                    job={{ id: job.id, title: job.title, budget: job.budget, category: job.category }}
                    layout="stack"
                    className={JOB_ACTION_CHIP_CLASS}
                    style={jobActionChipStyle("info")}
                  />
                  <JobActionChip
                    icon={MessageCircle}
                    label="Message"
                    ariaLabel="Message Helpr"
                    tone="primary"
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
                </JobActionRow>
              );
            })()}
            {/* Request Revision — only after helper marks complete (Stage 2) */}
            {job.status === "in_progress" && !job.poster_completed_at && job.helper_completed_at && (
              <Button size="sm" variant="ghost" className="w-full text-muted-foreground hover:text-destructive text-ds-11" onClick={() => onRevision(job.id)}>
                <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Request a revision instead
              </Button>
            )}
            {/* Dispute — Stage 3, only after revision deadline has passed without resolution */}
            {job.status === "revision_requested" && job.revision_deadline && new Date(job.revision_deadline) < new Date() && !job.revision_completed_at && (
              <button
                onClick={() => onDispute(job)}
                className="w-full text-ds-11 text-muted-foreground hover:text-destructive underline underline-offset-2 py-1 transition-colors"
              >
                Still unresolved? File a formal dispute
              </button>
            )}
            {/* Issue #113 — always-findable dispute path during a
                pending revision. Distinct from the deadline-gated
                button above: this surfaces *whenever* a revision is
                open, not only after the deadline elapses. The
                component self-hides for jobs already in dispute. */}
            <DisputeLink
              job={job}
              side="customer"
              onOpenDispute={() => onDispute(job)}
            />
          </div>
        )}
        {job.status === "completed" && (() => {
          const meta = completedJobMeta[job.id];
          const hasTipped = meta?.tipped;
          const hasReviewed = meta?.reviewed;
          const helperName = job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";
          return (
            <div className="space-y-2">
              <PhotoProofGroup
                jobId={job.id}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
                canUpload={false}
              />
              {!hasTipped ? (
                <Button size="sm" className="w-full bg-accent/15 text-accent hover:bg-accent/25 border-0" onClick={() => onTip(job.id, helperName)}>
                  <DollarSign className="w-4 h-4 mr-1" /> Tip {helperName}
                </Button>
              ) : (
                <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Tipped
                </Button>
              )}
              {job.payment_status === "released" && (
                !hasReviewed ? (
                  <Button size="sm" className="w-full bg-accent/15 text-accent hover:bg-accent/25 border-0" onClick={() => onReview(job)}>
                    <Star className="w-4 h-4 mr-1" /> Review
                  </Button>
                ) : (
                  <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                    <CheckCircle2 className="w-4 h-4 mr-1" /> Reviewed
                  </Button>
                )
              )}
              {/* Hire again — direct offer to the same helper.
                  Routes to PostJob with offerTo + rebook query so
                  the form is prefilled AND the offer goes straight
                  to them (skipping the open-application queue). */}
              {job.helper_id ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full rounded-ds-md"
                  onClick={() => navigate(`/post-job?rebook=${job.id}&offerTo=${job.helper_id}`)}
                >
                  <RotateCcw className="w-4 h-4 mr-1" /> Hire {helperName} again
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="w-full liquid-glass glass-press" onClick={() => navigate(`/post-job?rebook=${job.id}`)}>
                  <RotateCcw className="w-4 h-4 mr-1" /> Re-post this job
                </Button>
              )}
              {!job.poster_completed_at && (
                <>
                  {job.revision_requested_at ? (
                    <Button size="sm" variant="outline" className="w-full text-[hsl(var(--danger-ink))] border-destructive/30 hover:bg-destructive/5" onClick={() => onDispute(job)}>
                      <AlertTriangle className="w-4 h-4 mr-1" /> Dispute
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="w-full text-[hsl(var(--danger-ink))] border-destructive/30 hover:bg-destructive/5" onClick={() => onRevision(job.id)}>
                        <AlertTriangle className="w-4 h-4 mr-1" /> Request Revision
                      </Button>
                      <p className="text-ds-10 text-muted-foreground text-center italic">Request a revision first before filing a dispute</p>
                    </>
                  )}
                </>
              )}
              {/* Issue #113 — quiet, always-findable dispute path for
                  the 7-day window after completion. The component
                  self-hides outside that window or once a dispute is
                  already filed, so this lives unconditionally here. */}
              <DisputeLink
                job={job}
                side="customer"
                onOpenDispute={() => onDispute(job)}
              />
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
              <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message Helpr</Button>
              <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact admin</Button>
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
