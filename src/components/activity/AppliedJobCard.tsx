import { memo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, Star, MessageSquare, Users, AlertTriangle,
  RefreshCw, ThumbsUp, ThumbsDown, Send, XCircle,
  Paperclip, FileText, Trash2, Pencil, Check, X, ChevronRight,
  ChevronUp, ChevronDown, ClipboardList, Eye, CalendarPlus,
} from "lucide-react";
import { downloadIcs } from "@/lib/icalExport";
import { AttachmentLink } from "@/components/AttachmentLink";
import { formatDistanceToNow } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking, type TrackingData } from "@/components/JobTracking";
import { WhatToBringChecklist } from "@/components/jobs/WhatToBringChecklist";
import type { Application, AppliedApp, Job } from "./activityConstants";
import {
  EscrowProgressBar,
  deriveEscrowStepFromJob,
} from "@/components/payment/EscrowProgressBar";
import { DisputeLink } from "@/components/jobs/DisputeLink";
import { HelperRevisionCard } from "@/components/activity/HelperRevisionCard";
import { JobCardShell } from "./JobCardShell";
import { JobCardTitleBar } from "./JobCardTitleBar";
import { JobCardMetaRow } from "./JobCardMetaRow";
import { JobCardPhotoStrip } from "./JobCardPhotoStrip";
import { SendReportCard } from "./PetReportCard";

interface AppliedJobCardProps {
  /** The application + its embedded job — one row of the applied feed. */
  app: AppliedApp;
  /** When true, scroll this card into view on mount and apply a brief
   *  pulse ring so the helper knows which application the notification
   *  was about (/my-jobs?highlight=<appId> deep-link). Respects
   *  prefers-reduced-motion — animation skipped but scroll still fires. */
  highlight?: boolean;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperReviewedJobIds: Set<string>;
  /** Pre-fetched latest tracking row for this job. `null` = pre-fetched
      and no row exists yet; `undefined` = not pre-fetched (the child
      <JobTracking> falls back to its own per-mount query). Hoisting this
      up to useActivityData eliminates an N+1 across confirmed/in-progress
      cards on the helper's Activity tab. */
  initialTracking?: TrackingData | null;
  userId: string;
  /** Job-lifecycle handlers, owned by the parent ActivityTab. */
  onHelperResponse: (app: Application, accept: boolean) => void;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onResolveRevision: (jobId: string) => void;
  onHelperReview: (jobId: string, posterId: string, posterName: string) => void;
  /** Open the dispute dialog for this job — helper-initiated dispute (issue #113). */
  onDispute: (job: Job) => void;
  /** Open the read-only timeline + follow-up evidence uploader for a
   *  job that's already in dispute. */
  onViewDispute: (job: Job) => void;
  /** Re-fetch the activity feed after a card-local mutation (dispute response). */
  onRefresh: () => void;
  /** Dispute-response state (parent-owned; keyed by job id). */
  disputeResponse: string;
  setDisputeResponse: (value: string) => void;
  respondingJobId: string | null;
  setRespondingJobId: (id: string | null) => void;
  submittingResponse: boolean;
  setSubmittingResponse: (value: boolean) => void;
  /** Withdraw flow — the confirm sheet lives on the parent. */
  withdrawingAppId: string | null;
  setWithdrawTarget: (target: { appId: string; jobTitle: string; jobId?: string | null } | null) => void;
  /** Application-message edit + attachment state (parent-owned). */
  uploadingAttachment: string | null;
  editingMessageAppId: string | null;
  setEditingMessageAppId: (id: string | null) => void;
  editMessageText: string;
  setEditMessageText: (value: string) => void;
  savingMessage: boolean;
  handleSaveMessage: (appId: string) => void;
  handleAddAttachment: (appId: string, jobId: string, currentUrls: string[], file: File) => void;
  handleRemoveAttachment: (appId: string, currentUrls: string[], urlToRemove: string) => void;
}

/**
 * AppliedJobCard — one card in the helper's "applied jobs" feed: the
 * job summary plus the state-specific section (pending / offered /
 * confirmed / in-progress / disputed / completed) and its actions.
 *
 * Extracted verbatim from AppliedJobsTab.tsx (which was a 989-line file
 * whose bulk was this one render function). Faithful relocation — the
 * JSX is unchanged; every value the card read from the parent is now a
 * prop. The parent still owns the state + handlers and threads them in.
 */
function AppliedJobCardInner({
  app,
  highlight = false,
  expandedJobId,
  setExpandedJobId,
  helperReviewedJobIds,
  initialTracking,
  userId,
  onHelperResponse,
  onComplete,
  completingJobId,
  onResolveRevision,
  onHelperReview,
  onDispute,
  onViewDispute,
  onRefresh,
  disputeResponse,
  setDisputeResponse,
  respondingJobId,
  setRespondingJobId,
  submittingResponse,
  setSubmittingResponse,
  withdrawingAppId,
  setWithdrawTarget,
  uploadingAttachment,
  editingMessageAppId,
  setEditingMessageAppId,
  editMessageText,
  setEditMessageText,
  savingMessage,
  handleSaveMessage,
  handleAddAttachment,
  handleRemoveAttachment,
}: AppliedJobCardProps) {
  const navigate = useNavigate();
  const cardRef = useRef<HTMLDivElement>(null);
  const [showReportCard, setShowReportCard] = useState(false);

  // Deep-link highlight — scroll into view + apply pulse ring once on mount
  // when this card is the target of a ?highlight= notification link.
  // The CSS class drives the animation; prefers-reduced-motion is handled
  // entirely in the stylesheet (scroll still fires regardless).
  useEffect(() => {
    if (!highlight) return;
    const el = cardRef.current;
    if (!el) return;
    // Small delay so the list has finished laying out before we scroll.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("highlight-pulse");
      // Remove the class after the animation ends so a future re-render
      // doesn't re-apply it and so the outline doesn't persist.
      const onEnd = () => el.classList.remove("highlight-pulse");
      el.addEventListener("animationend", onEnd, { once: true });
    });
    return () => cancelAnimationFrame(raf);
    // Run once on mount — `highlight` is stable (set from initial URL param).
  }, []);

  // Counter-offer response — local state so the pending card reflects the
  // helper's accept/decline immediately without waiting for a data refetch.
  const [counterResponding, setCounterResponding] = useState(false);
  const [localCounterStatus, setLocalCounterStatus] = useState<"countered" | "counter_accepted" | "counter_declined" | null>(null);

  const handleRespondCounter = async (appId: string, accept: boolean) => {
    setCounterResponding(true);
    try {
      const { error } = await (supabase.rpc as any)("respond_to_counter_offer", {
        p_application_id: appId,
        p_accept: accept,
      });
      if (error) {
        if ((error as any).code === "PGRST202") {
          toast.error("Counter-offer feature not yet deployed — try again later.");
        } else {
          hapticError();
          toast.error("Couldn't respond to the counter-offer. Please try again.");
        }
        return;
      }
      setLocalCounterStatus(accept ? "counter_accepted" : "counter_declined");
      toast.success(accept ? "Counter accepted! The poster will be notified." : "Counter declined. The poster will be notified.");
    } catch {
      hapticError();
      toast.error("Something went wrong.");
    } finally {
      setCounterResponding(false);
    }
  };

  const job = app.job;
  if (!job) return null;
  const status = job.status;
  const isOffered = app.status === "accepted" && status === "accepted" && !job.helper_confirmed_at;
  const isConfirmed = app.status === "accepted" && status === "accepted" && !!job.helper_confirmed_at;
  const isActive = app.status === "accepted" && (status === "in_progress" || status === "revision_requested");
  const isDisputed = app.status === "accepted" && status === "disputed";
  const isCompleted = app.status === "accepted" && status === "completed";
  const isCancelled = job.status === "cancelled";
  const isPending = app.status === "pending";
  const isRejected = app.status === "rejected";
  const isFullyDone = isCompleted && helperReviewedJobIds.has(app.job_id);
  const isExpanded = expandedJobId === app.job_id;

  // Payout calc
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelper = job.budget / helpers;
  const commissionPercent = job.helper_fee_percent ?? 10;
  const commission = (perHelper * commissionPercent) / 100;
  const payout = perHelper - commission + (job.urgent_fee ?? 0);

  const isMinimalCard = isRejected || isCancelled;

  // Escrow progress for the helper's view — same source of truth as the
  // customer's PostedJobCard. Hides for jobs where escrow doesn't apply
  // (pending applications, rejected/cancelled, no payment intent).
  const escrowStep = isMinimalCard || isPending ? null : deriveEscrowStepFromJob(job);

  return (
    <>
        <div ref={cardRef}>
        <JobCardShell
          expandable={!isMinimalCard}
          expanded={isExpanded}
          onToggle={() => setExpandedJobId(isExpanded ? null : app.job_id)}
        >
          <JobCardTitleBar
            title={job.title || "Task"}
            amount={payout.toFixed(2)}
            amountTitle={`Budget: $${job.budget} · Fee: ${commissionPercent}%`}
          />

          {/* Escrow progress — gives the helpr context on where the
              customer's payment sits in the lifecycle (held / verified /
              released). Sits above the action area for high context
              without nudging. Hides itself when escrow does not apply. */}
          {escrowStep && (
            <div className="px-4 pt-3" onClick={(e) => e.stopPropagation()}>
              <EscrowProgressBar currentStep={escrowStep} compact />
            </div>
          )}

          {/* Summary info line */}
          <div className="px-4 py-3 space-y-2.5">
            <JobCardMetaRow
              dateNeeded={job.date_needed}
              startTime={job.start_time}
              location={job.location}
              latitude={job.latitude}
              longitude={job.longitude}
              estimatedHours={job.estimated_hours}
              expiresAt={isPending && !job.helper_id ? job.expires_at : null}
            />

            {/* Description preview — collapsed to keep cards compact.
                Full details live on the job page (chevron link below). */}
            {!isMinimalCard && job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase() && (
              <p className="text-ds-11 text-muted-foreground leading-relaxed line-clamp-2">{job.description}</p>
            )}
            {!isMinimalCard && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate(`/dashboard?job=${job.id}`); }}
                className="inline-flex items-center gap-0.5 text-ds-11 font-medium text-primary hover:underline active:opacity-70"
              >
                View details <ChevronRight className="w-3 h-3" />
              </button>
            )}

            {/* Poster name */}
            {!isMinimalCard && app.posterName && (
              <p className="text-ds-11 text-muted-foreground">
                Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{app.posterName}</a>
              </p>
            )}
            {isMinimalCard && (
              <div className="space-y-1.5">
                <p className="text-ds-11 text-muted-foreground italic">{isCancelled ? "Job was cancelled" : "Not selected"}</p>
                {/* Cancellation fee status — shown to the helper when
                    the poster cancelled after the helper was selected and a
                    fee was assessed. Subtle pill; only when data is present. */}
                {isCancelled && job.cancellation_fee != null && job.cancellation_fee > 0 && (() => {
                  const feeAmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(job.cancellation_fee);
                  const status = job.cancellation_fee_status;
                  if (!status) return null;
                  const statusCopy: Record<string, string> = {
                    pending: `Cancellation fee ${feeAmt} — payment pending`,
                    charged: `Cancellation fee ${feeAmt} — paid to you`,
                    waived:  `Cancellation fee ${feeAmt} — waived`,
                  };
                  const label = statusCopy[status] ?? `Cancellation fee ${feeAmt}`;
                  const isPending = status === "pending";
                  const isCharged = status === "charged";
                  return (
                    <span
                      className="inline-flex items-center gap-1 text-ds-11 font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: isCharged
                          ? "hsl(142 35% 96%)"
                          : isPending
                          ? "hsl(var(--gold-warm) / 0.12)"
                          : "hsl(var(--olivewood) / 0.08)",
                        color: isCharged
                          ? "hsl(142 38% 28%)"
                          : isPending
                          ? "hsl(36 72% 28%)"
                          : "hsl(var(--olivewood))",
                        border: `0.5px solid ${isCharged ? "hsl(142 35% 78%)" : isPending ? "hsl(var(--gold-warm) / 0.30)" : "hsl(var(--olivewood) / 0.22)"}`,
                      }}
                    >
                      {label}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Pending expandable section */}
          {!isMinimalCard && isPending && isExpanded && (
            <div className="px-4 pb-3 space-y-2">
              <JobCardPhotoStrip urls={job.photos || []} size="sm" stopPropagation />

              {/* Your application message — editable */}
              <div className="rounded-ds-sm bg-primary/5 border border-primary/15 p-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-ds-10 text-muted-foreground font-medium">Your Message</p>
                  {editingMessageAppId !== app.id && (
                    <button
                      type="button"
                      aria-label="Edit your message"
                      className="text-primary hover:text-primary/80 btn-press p-0.5 -m-0.5"
                      onClick={() => { setEditingMessageAppId(app.id); setEditMessageText(app.message || ""); }}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {editingMessageAppId === app.id ? (
                  <div className="space-y-1.5">
                    <Textarea
                      value={editMessageText}
                      onChange={(e) => setEditMessageText(e.target.value)}
                      placeholder="Introduce yourself or share relevant experience…"
                      rows={3}
                      className="text-ds-11"
                    />
                    <div className="flex items-center gap-1.5 justify-end">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-ds-11" onClick={() => setEditingMessageAppId(null)} disabled={savingMessage}>
                        <X className="w-3 h-3 mr-0.5" /> Cancel
                      </Button>
                      <Button size="sm" className="h-7 px-2 text-ds-11" onClick={() => handleSaveMessage(app.id)} disabled={savingMessage}>
                        <Check className="w-3 h-3 mr-0.5" /> {savingMessage ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-ds-11 text-foreground">{app.message || <span className="text-muted-foreground italic">No message — tap the pencil to add one</span>}</p>
                )}
              </div>

              {/* Your attachments */}
              <div className="space-y-1.5">
                <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide">Your Attachments</p>
                {(app.attachment_urls || []).map((url, i) => {
                  const last = url.split('/').pop() || `File ${i + 1}`;
                  let filename = last;
                  try { filename = decodeURIComponent(last); } catch {}
                  return (
                    <div key={i} className="flex items-center gap-2 text-ds-11 bg-secondary/30 rounded-ds-sm px-2.5 py-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="truncate flex-1 text-foreground">
                        {filename.length > 30 ? filename.slice(-30) : filename}
                      </span>
                      <AttachmentLink url={url} index={i} variant="chip" className="!px-1.5 !py-0.5" />
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleRemoveAttachment(app.id, app.attachment_urls || [], url); }} aria-label="Remove attachment" className="text-destructive hover:text-destructive/80">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
                {(app.attachment_urls || []).length < 5 && (
                  <label className="flex items-center gap-2 text-ds-11 text-primary cursor-pointer hover:underline" onClick={(e) => e.stopPropagation()}>
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>{uploadingAttachment === app.id ? "Uploading…" : "Add cert or work sample"}</span>
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf,.doc,.docx"
                      disabled={uploadingAttachment === app.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleAddAttachment(app.id, app.job_id, app.attachment_urls || [], file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                {(app.attachment_urls || []).length === 0 && !uploadingAttachment && (
                  <p className="text-muted-foreground text-ds-11">No attachments yet</p>
                )}
              </div>
            </div>
          )}

          {/* Counter-offer notification bar — only shown when the poster
              has sent a counter price. The helper can accept or decline
              directly from this bar without opening the full detail view.
              Uses optimistic local state so the response is reflected
              immediately (no reload needed). */}
          {!isMinimalCard && isPending && (() => {
            const effectiveStatus = localCounterStatus ?? (app as any).negotiation_status;
            if (effectiveStatus === "countered") {
              return (
                <div
                  className="mx-4 mb-2 rounded-ds-md p-3 flex items-center justify-between gap-3"
                  style={{
                    background: "hsl(var(--heritage-gold) / 0.1)",
                    border: "1px solid hsl(var(--heritage-gold) / 0.3)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="min-w-0">
                    <p className="text-ds-12 font-semibold" style={{ color: "hsl(var(--heritage-gold))" }}>
                      Poster countered: ${(app as any).counter_price}
                    </p>
                    {(app as any).proposed_price != null && (
                      <p className="text-ds-11 text-muted-foreground">
                        Your bid: ${(app as any).proposed_price} · Accept or decline?
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={counterResponding}
                      onClick={() => handleRespondCounter(app.id, true)}
                      className="text-ds-12 font-semibold px-3 py-1 rounded-full disabled:opacity-50 active:opacity-70 transition-opacity"
                      style={{ background: "hsl(var(--sage) / 0.15)", color: "hsl(var(--sage))" }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={counterResponding}
                      onClick={() => handleRespondCounter(app.id, false)}
                      className="text-ds-12 px-3 py-1 rounded-full disabled:opacity-50 active:opacity-70 transition-opacity"
                      style={{ background: "hsl(var(--olivewood) / 0.1)", color: "hsl(var(--olivewood) / 0.7)" }}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            }
            if (effectiveStatus === "counter_accepted") {
              return (
                <div
                  className="mx-4 mb-2 rounded-ds-md px-3 py-2 flex items-center gap-2"
                  style={{
                    background: "hsl(var(--sage) / 0.10)",
                    border: "0.5px solid hsl(var(--sage) / 0.30)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--sage))" }} />
                  <p className="text-ds-12 font-semibold" style={{ color: "hsl(var(--sage))" }}>
                    You accepted the counter offer at ${(app as any).counter_price}
                  </p>
                </div>
              );
            }
            if (effectiveStatus === "counter_declined") {
              return (
                <div
                  className="mx-4 mb-2 rounded-ds-md px-3 py-2 flex items-center gap-2"
                  style={{
                    background: "hsl(var(--olivewood) / 0.06)",
                    border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
                    Counter offer declined — the poster may revise or hire someone else.
                  </p>
                </div>
              );
            }
            return null;
          })()}

          {/* Pending withdraw — slightly more discoverable than the
              previous ghost text. Tucked inside a sienna-tinted pill
              that reads as "available, low-stakes" without competing
              with primary actions. */}
          {!isMinimalCard && isPending && (
            <div
              className="px-4 py-2.5 flex items-center justify-between"
              style={{ borderTop: "0.5px solid hsl(var(--olivewood) / 0.10)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* "Seen" trust chip — visible when the poster has opened
                  the applicant list and viewed this application. Subtle
                  olivewood colour so it reads as informational, not urgent. */}
              {(app as any).poster_viewed_at ? (
                <span
                  className="flex items-center gap-0.5 text-ds-10 font-medium"
                  style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                  title={`Poster viewed on ${new Date((app as any).poster_viewed_at).toLocaleDateString()}`}
                >
                  <Eye className="w-3 h-3" aria-hidden="true" /> Seen
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                disabled={withdrawingAppId === app.id}
                onClick={() => setWithdrawTarget({ appId: app.id, jobTitle: job.title || "Task", jobId: job.id ?? null })}
                className="inline-flex items-center gap-1.5 text-[0.72rem] font-sans font-semibold tracking-wide px-2.5 py-1 rounded-full active:opacity-70 transition-opacity disabled:opacity-50"
                style={{
                  color: "hsl(var(--burnt-sienna))",
                  background: "hsl(var(--burnt-sienna) / 0.08)",
                  border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                }}
              >
                <XCircle className="w-3.5 h-3.5" strokeWidth={2.25} />
                {withdrawingAppId === app.id ? "Withdrawing…" : "Withdraw application"}
              </button>
            </div>
          )}

          {/* === ACTION SECTIONS === */}

          {/* Offered: accept/decline — celebratory framing since this
              is a poster reaching out directly. Gold-warm accent
              surfaces the "you were picked" moment without shouting. */}
          {isOffered && (
            <div
              className="px-4 py-3 space-y-2.5"
              onClick={(e) => e.stopPropagation()}
              style={{
                borderTop: "0.5px solid hsl(var(--gold-warm) / 0.30)",
                background:
                  "radial-gradient(80% 100% at 50% 0%, hsl(var(--gold-warm) / 0.10) 0%, transparent 60%)",
              }}
            >
              <p
                className="font-serif italic uppercase inline-flex items-center gap-1.5"
                style={{ fontSize: "0.62rem", color: "hsl(var(--gold-warm))", letterSpacing: "0.18em" }}
              >
                <ThumbsUp className="w-3 h-3" /> You were picked
              </p>
              {app.offer_message && (
                <div
                  className="rounded-ds-md p-3"
                  style={{
                    background: "hsla(0, 0%, 100%, 0.65)",
                    border: "0.5px solid hsl(var(--olivewood) / 0.12)",
                  }}
                >
                  <p
                    className="font-serif italic uppercase mb-1 inline-flex items-center gap-1"
                    style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
                  >
                    <MessageSquare className="w-3 h-3" /> Message from poster
                  </p>
                  <p className="font-serif italic leading-relaxed" style={{ fontSize: "0.88rem", color: "hsl(var(--ink-deep))" }}>
                    "{app.offer_message}"
                  </p>
                </div>
              )}
              {/* Job countdown */}
              <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
              {job.date_needed && (
                <button
                  type="button"
                  aria-label="Add to calendar"
                  className="inline-flex items-center gap-1 text-ds-11 font-medium mt-1"
                  style={{ color: "hsl(var(--olivewood) / 0.65)" }}
                  onClick={() =>
                    downloadIcs({
                      id: job.id,
                      title: job.title,
                      location: job.location ?? null,
                      description: job.description ?? null,
                      dateNeeded: job.date_needed!,
                      startTime: job.start_time ?? null,
                      estimatedHours: typeof job.estimated_hours === "number" ? job.estimated_hours : null,
                    })
                  }
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  Add to Calendar
                </button>
              )}
              {job.response_deadline && (
                <DeadlineCountdown
                  deadline={job.response_deadline}
                  expiredText="Response deadline expired"
                  consequenceText="Accept or decline before the deadline"
                />
              )}
              {/* Category-aware "what to bring" checklist — informational,
                  ticks persist locally. Renders nothing if the category
                  has no curated list (see src/data/whatToBring.ts). */}
              <WhatToBringChecklist jobId={app.job_id} category={job.category} />
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 rounded-ds-md"
                  onClick={() => onHelperResponse(app, false)}
                  style={{
                    color: "hsl(var(--burnt-sienna))",
                    borderColor: "hsl(var(--burnt-sienna) / 0.30)",
                  }}
                >
                  <ThumbsDown className="w-4 h-4 mr-1" /> Decline
                </Button>
                <Button
                  variant="bark"
                  size="sm"
                  className="flex-1 rounded-ds-md"
                  onClick={() => onHelperResponse(app, true)}
                >
                  <ThumbsUp className="w-4 h-4 mr-1" /> Accept job
                </Button>
              </div>
            </div>
          )}

          {/* Confirmed: show tracking + message */}
          {isConfirmed && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              {/* Job countdown */}
              <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
              {job.date_needed && (
                <button
                  type="button"
                  aria-label="Add to calendar"
                  className="inline-flex items-center gap-1 text-ds-11 font-medium mt-1"
                  style={{ color: "hsl(var(--olivewood) / 0.65)" }}
                  onClick={() =>
                    downloadIcs({
                      id: job.id,
                      title: job.title,
                      location: job.location ?? null,
                      description: job.description ?? null,
                      dateNeeded: job.date_needed!,
                      startTime: job.start_time ?? null,
                      estimatedHours: typeof job.estimated_hours === "number" ? job.estimated_hours : null,
                    })
                  }
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  Add to Calendar
                </button>
              )}
              {/* Tracking — only active on the day of the job */}
              <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} />
              {/* Job confirmation for helper */}
              <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
              {/* Category-aware "what to bring" checklist — quiet pre-job
                  packing prompt. Collapsed by default, ticks persist per
                  job id. No-op when the category has no curated list. */}
              <WhatToBringChecklist jobId={app.job_id} category={job.category} />

              <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
            </div>
          )}

          {/* In Progress / Revision */}
          {isActive && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              {/* Live tracking for in-progress jobs */}
              <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} />

              {/* What-to-bring checklist — still useful during the job
                  itself (e.g. "did I bring the bug spray?"). Stays
                  collapsed and renders nothing for uncovered categories. */}
              <WhatToBringChecklist jobId={app.job_id} category={job.category} />

              {/* Pet care report card — only for pet_care jobs */}
              {job.category === "pet_care" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowReportCard(true)}
                >
                  <ClipboardList className="w-4 h-4 mr-1.5" />
                  Send report card
                </Button>
              )}

              {/* Completion status — right after tracker */}
              {job.helper_completed_at && !job.poster_completed_at && !job.revision_requested_at && (
                <div className="rounded-ds-md border border-primary/20 bg-primary/5 overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-ds-13 font-semibold text-primary">Marked Complete</span>
                  </div>
                  <div className="px-3 pb-2.5 space-y-1">
                    <p className="text-ds-11 text-muted-foreground">Waiting for the poster to:</p>
                    <ul className="text-ds-11 text-muted-foreground list-disc pl-4 space-y-0.5">
                      <li><span className="text-foreground font-medium">Approve & complete</span> the job</li>
                      <li>Or <span className="text-foreground font-medium">request a revision</span></li>
                    </ul>
                    <p className="text-ds-10 text-muted-foreground/70 pt-1">If the poster doesn't respond within 72 hours, payment will automatically be released to you.</p>
                  </div>
                  {job.helper_completed_at && (
                    <div className="px-3 pb-2.5">
                      <DeadlineCountdown
                        deadline={new Date(new Date(job.helper_completed_at).getTime() + 72 * 60 * 60 * 1000).toISOString()}
                        expiredText="72 hours passed — payment auto-releasing to you"
                        consequenceText="Payment will auto-release to you when this timer expires."
                        variant="warning"
                      />
                    </div>
                  )}
                </div>
              )}
              {job.helper_completed_at && job.poster_completed_at && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-ds-sm bg-primary/10 border border-primary/20">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-ds-13 font-medium text-primary">Job complete</span>
                </div>
              )}

              {/* Job confirmation for helper during active job */}
              <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
              {/* Revision notice — HelperRevisionCard shows the formal
                  job_revisions row (or falls back to jobs.revision_note).
                  The "I'll fix it" / "Discuss" path lives there. */}
              {status === "revision_requested" && (
                <div className="space-y-2">
                  <HelperRevisionCard
                    jobId={app.job_id}
                    posterId={job.customer_id ?? null}
                    legacyRevisionNote={job.revision_note ?? null}
                    onAccepted={() => { /* optimistically keep showing the card — parent refetches */ }}
                  />
                  {job.revision_deadline && !job.revision_completed_at && (
                    <DeadlineCountdown
                      deadline={job.revision_deadline}
                      expiredText="Revision deadline passed — poster can dispute or complete"
                      consequenceText="Fix the revision before the deadline. If not completed, the poster can file a dispute."
                      variant="warning"
                    />
                  )}
                  {job.revision_completed_at ? (
                    <div className="space-y-2">
                      <div className="text-ds-11 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-emerald-500/10 text-emerald-600 font-medium w-full"><Check className="w-3 h-3 shrink-0" strokeWidth={3} /> Marked as fixed — waiting for poster</div>
                      {job.revision_acceptance_deadline && (
                        <DeadlineCountdown
                          deadline={job.revision_acceptance_deadline}
                          expiredText="Poster didn't respond — payment auto-releasing"
                          consequenceText="If the poster doesn't accept or dispute, payment auto-releases to you."
                          variant="warning"
                        />
                      )}
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="w-full" onClick={() => onResolveRevision(app.job_id)}><RefreshCw className="w-4 h-4 mr-1" /> Mark Fixed</Button>
                  )}
                </div>
              )}

              {/* Photo proof - only when working */}
              {job.poster_confirmed_working_at && (
                <PhotoProofGroup
                  jobId={app.job_id}
                  beforeUrls={job.proof_before_urls || []}
                  afterUrls={job.proof_after_urls || []}
                  canUploadBefore={true}
                  canUploadAfter={true}
                  requireAfter={true}
                  budget={job.budget || 0}
                />
              )}

              {/* Complete + Message */}
              <div className="space-y-2">
                {!job.helper_completed_at && job.helper_arrived_at && job.poster_confirmed_working_at && (() => {
                  const beforePhotos = job.proof_before_urls || [];
                  const afterPhotos = job.proof_after_urls || [];
                  const hasPhotos = beforePhotos.length > 0 && afterPhotos.length > 0;
                  const workingStart = job.poster_confirmed_working_at ? new Date(job.poster_confirmed_working_at) : null;
                  const minWorkMs = 30 * 60 * 1000;
                  const tooEarly = workingStart ? (Date.now() - workingStart.getTime()) < minWorkMs : false;
                  const minutesLeft = workingStart ? Math.ceil((minWorkMs - (Date.now() - workingStart.getTime())) / 60000) : 0;
                  const disabled = completingJobId === app.job_id || !hasPhotos || tooEarly;
                  const label = completingJobId === app.job_id ? "…" : !hasPhotos ? "Upload before & after photos first" : tooEarly ? `Available in ${minutesLeft} min` : "Mark Complete";
                  return (
                    <>
                      <Button
                        size="sm"
                        className="w-full rounded-ds-md"
                        onClick={() => onComplete(app.job_id)}
                        disabled={disabled}
                        style={
                          !disabled
                            ? {
                                background: "hsl(var(--bark))",
                                backgroundImage: "none",
                                border: "1px solid hsl(var(--bark))",
                                color: "hsl(var(--parchment))",
                                fontFamily: "Montserrat, system-ui, sans-serif",
                                fontWeight: 600,
                                letterSpacing: "0.01em",
                                boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
                              }
                            : undefined
                        }
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        {label === "Mark Complete" ? "I'm done — request payout" : label}
                      </Button>
                      {tooEarly && (
                        <p className="font-serif italic text-center" style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.7)" }}>
                          Available 30 minutes after arrival to ensure quality.
                        </p>
                      )}
                    </>
                  );
                })()}
                <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
              </div>
            </div>
          )}

          {/* Disputed */}
          {isDisputed && (() => {
            const disputeStatus = job.dispute_status || "open";
            const hasResponded = !!job.dispute_helper_response;
            return (
              <div
                className="px-4 py-3 space-y-2.5"
                onClick={(e) => e.stopPropagation()}
                style={{
                  borderTop: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
                  background: "hsl(var(--burnt-sienna) / 0.06)",
                }}
              >
                {/* Dispute info */}
                <div
                  className="rounded-ds-md p-3"
                  style={{
                    background: "hsl(var(--burnt-sienna) / 0.10)",
                    border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
                  }}
                >
                  <span
                    className="font-serif italic uppercase inline-flex items-center gap-1.5"
                    style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
                  >
                    <AlertTriangle className="w-3 h-3" />
                    {disputeStatus === "escalated" ? "Admin reviewing" : "Dispute open"}
                  </span>
                  <p
                    className="font-display italic font-bold leading-tight mt-1"
                    style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                  >
                    {disputeStatus === "escalated"
                      ? "An admin is on it."
                      : "Both sides are talking it out."}
                  </p>
                  {job.dispute_reason && (
                    <p
                      className="font-serif italic mt-1.5"
                      style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.85)" }}
                    >
                      Reason: {job.dispute_reason}
                    </p>
                  )}
                  {job.disputed_at && (
                    <p
                      className="font-serif italic mt-1"
                      style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.6)" }}
                    >
                      Filed {formatDistanceToNow(new Date(job.disputed_at), { addSuffix: true })}
                    </p>
                  )}
                </div>

                {job.dispute_deadline && (
                  <DeadlineCountdown
                    deadline={job.dispute_deadline}
                    expiredText="Deadline passed — payment auto-releasing to you"
                    consequenceText="If the poster doesn't resolve or escalate, payment auto-releases to you after the deadline."
                    variant="destructive"
                  />
                )}

                {/* Photo proof */}
                {job.poster_confirmed_working_at && (
                  <PhotoProofGroup
                    jobId={app.job_id}
                    beforeUrls={job.proof_before_urls || []}
                    afterUrls={job.proof_after_urls || []}
                    canUploadBefore={true}
                    canUploadAfter={true}
                    requireAfter={true}
                    budget={job.budget || 0}
                  />
                )}

                {/* Helper's response */}
                {hasResponded && (
                  <div className="p-2 rounded-ds-sm bg-primary/5 border border-primary/20">
                    <p className="text-ds-10 text-muted-foreground font-medium">Your response:</p>
                    <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
                  </div>
                )}

                {/* Respond form */}
                {!hasResponded && disputeStatus === "open" && (
                  <div className="space-y-2">
                    {respondingJobId === app.job_id ? (
                      <div className="space-y-2">
                        <Textarea
                          aria-label="Your response to the dispute"
                          placeholder="Explain your side — what work was done, any issues, etc."
                          value={disputeResponse}
                          onChange={(e) => setDisputeResponse(e.target.value)}
                          rows={3}
                          maxLength={500}
                          className="text-ds-11"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" disabled={!disputeResponse.trim() || submittingResponse} onClick={async () => {
                            setSubmittingResponse(true);
                            const { error } = await supabase.from("jobs").update({ dispute_helper_response: disputeResponse.trim(), dispute_status: "helper_responded" }).eq("id", app.job_id);
                            if (error) { hapticError(); toast.error("We couldn't submit your response — please try again."); setSubmittingResponse(false); return; }
                            if (job.customer_id) await createNotification({ user_id: job.customer_id, title: "Helpr responded to dispute", message: `The helpr has responded to the dispute on "${job.title}". Please review and mark resolved or escalate.`, type: "info", link: "/my-posts?filter=disputed" });
                            toast.success("Response submitted — poster will review");
                            setSubmittingResponse(false);
                            setRespondingJobId(null);
                            setDisputeResponse("");
                            onRefresh();
                          }}>
                            <Send className="w-3.5 h-3.5 mr-1" /> {submittingResponse ? "Sending…" : "Submit"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setRespondingJobId(null); setDisputeResponse(""); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => setRespondingJobId(app.job_id)}>
                        <MessageSquare className="w-4 h-4 mr-1" /> Respond to Dispute
                      </Button>
                    )}
                  </div>
                )}

                {/* Policy note */}
                <p className="text-ds-10 text-muted-foreground leading-relaxed">
                  If not resolved within 72 hours, payment auto-releases to you.
                </p>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => onViewDispute(job)}
                >
                  <AlertTriangle className="w-4 h-4 mr-1" /> View timeline & add evidence
                </Button>

                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/messages?jobId=${app.job_id}&userId=${job.customer_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact Admin</Button>
                </div>
              </div>
            );
          })()}

          {/* Completed - not yet reviewed: always show photo proof + review button */}
          {isCompleted && !isFullyDone && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              <PhotoProofGroup
                jobId={app.job_id}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
                canUpload={false}
              />
              {job.payment_status === "released" && (
                helperReviewedJobIds.has(app.job_id) ? (
                  <Button size="sm" variant="outline" className="w-full" disabled><Star className="w-4 h-4 mr-1" /> Reviewed</Button>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => onHelperReview(app.job_id, job.customer_id, app.posterName || "Poster")}>
                    <Star className="w-4 h-4 mr-1" /> Review Poster
                  </Button>
                )
              )}
              {/* Issue #113 — discoverable dispute path for helpers within
                  the 7-day window after completion. Self-hides outside the
                  window or once a dispute is already filed. */}
              <DisputeLink
                job={job}
                side="helper"
                onOpenDispute={() => onDispute(job)}
              />
            </div>
          )}

          {/* Fully reviewed completed jobs still get the dispute link until
              the 7-day window closes — issue #113. Helpers may not realize
              there's a problem until after they've left a review. */}
          {isFullyDone && (
            <DisputeLink
              job={job}
              side="helper"
              onOpenDispute={() => onDispute(job)}
              className="px-4 pb-2"
            />
          )}

          {/* Fully done (reviewed) - collapsible */}
          {isFullyDone && (
            <div className="px-4 py-1.5 border-t border-[hsl(var(--olivewood)/0.1)] bg-card flex items-center justify-between">
              <span className="text-ds-11 text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Reviewed</span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </div>
          )}
          {isFullyDone && isExpanded && (
            <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
              <PhotoProofGroup
                jobId={app.job_id}
                beforeUrls={job.proof_before_urls || []}
                afterUrls={job.proof_after_urls || []}
                canUpload={false}
              />
            </div>
          )}


          {/* Footer: extra details (photos, requirements, group/recurring) */}
          {!isMinimalCard && (!isFullyDone || isExpanded) && ((job.photos || []).length > 0 || job.is_recurring || job.is_group_job) && (
            <div className="px-4 py-2.5 border-t border-border/20 space-y-2">
              <JobCardPhotoStrip urls={job.photos || []} size="sm" />
              {job.is_recurring && (
                <div className="flex items-center gap-1.5 text-ds-11 text-muted-foreground">
                  <RefreshCw className="w-3 h-3 text-primary" />
                  <span>{job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Recurring"}{job.recurrence_end_date && ` until ${new Date(job.recurrence_end_date).toLocaleDateString()}`}</span>
                </div>
              )}
              {job.is_group_job && (
                <div className="flex items-center gap-1.5 text-ds-11 text-muted-foreground">
                  <Users className="w-3 h-3 text-primary" />
                  <span>{job.helpers_needed ? `${job.helpers_needed} helprs needed` : "Group task"}</span>
                </div>
              )}
            </div>
          )}
        </JobCardShell>
        </div>

      {/* Pet report card sheet — mounted outside JobCardShell to avoid
          z-index clipping inside the card's overflow:hidden container */}
      {showReportCard && job.customer_id && (
        <SendReportCard
          jobId={app.job_id}
          helperId={userId}
          ownerId={job.customer_id}
          onClose={() => setShowReportCard(false)}
        />
      )}
    </>
  );
}

/** Memoized — re-renders only when its own props change, not on parent state updates. */
export const AppliedJobCard = memo(AppliedJobCardInner);
