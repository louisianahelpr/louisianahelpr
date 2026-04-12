import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MapPin, DollarSign, CheckCircle2,
  Star, MessageSquare, Users, AlertTriangle, RefreshCw,
  Rocket, Clock, Calendar, Timer, ThumbsUp, ThumbsDown,
  Navigation as NavigationIcon, Send, XCircle, Paperclip, FileText, Trash2, ExternalLink,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking } from "@/components/JobTracking";

import { type Job, type Application, type AppliedApp, categoryColors } from "./activityConstants";

interface AppliedJobsTabProps {
  apps: AppliedApp[];
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  startRequestedJobIds: Set<string>;
  helperReviewedJobIds: Set<string>;
  userId: string;
  onHelperResponse: (app: Application, accept: boolean) => void;
  onMarkOnTheWay: (jobId: string) => void;
  onTheWayLoading: string | null;
  onMarkArrived: (jobId: string) => void;
  arrivedLoading: string | null;
  onStartJob: (jobId: string) => void;
  startJobLoading: string | null;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onResolveRevision: (jobId: string) => void;
  onHelperReview: (jobId: string, posterId: string, posterName: string) => void;
}

export const AppliedJobsTab = ({
  apps, expandedJobId, setExpandedJobId, startRequestedJobIds,
  helperReviewedJobIds, userId, onHelperResponse,
  onMarkOnTheWay, onTheWayLoading, onMarkArrived, arrivedLoading,
  onStartJob, startJobLoading, onComplete, completingJobId,
  onResolveRevision, onHelperReview,
}: AppliedJobsTabProps) => {
  const navigate = useNavigate();
  const [disputeResponse, setDisputeResponse] = useState("");
  const [respondingJobId, setRespondingJobId] = useState<string | null>(null);
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [withdrawingAppId, setWithdrawingAppId] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState<string | null>(null);

  const handleWithdraw = async (appId: string, jobTitle: string) => {
    setWithdrawingAppId(appId);
    const { error } = await supabase.from("applications").delete().eq("id", appId).eq("helper_id", userId);
    if (error) {
      toast.error("Failed to withdraw application");
    } else {
      toast.success(`Withdrawn from "${jobTitle}"`);
    }
    setWithdrawingAppId(null);
  };

  const handleAddAttachment = async (appId: string, jobId: string, currentUrls: string[], file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
    setUploadingAttachment(appId);
    const ext = file.name.split('.').pop();
    const path = `${userId}/${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from("application-attachments").upload(path, file);
    if (uploadErr) { toast.error("Upload failed"); setUploadingAttachment(null); return; }
    const { data: urlData } = supabase.storage.from("application-attachments").getPublicUrl(path);
    const newUrls = [...currentUrls, urlData.publicUrl];
    const { error } = await supabase.from("applications").update({ attachment_urls: newUrls }).eq("id", appId);
    if (error) toast.error("Failed to save attachment");
    else toast.success("Attachment added");
    setUploadingAttachment(null);
  };

  const handleRemoveAttachment = async (appId: string, currentUrls: string[], urlToRemove: string) => {
    const newUrls = currentUrls.filter(u => u !== urlToRemove);
    const { error } = await supabase.from("applications").update({ attachment_urls: newUrls }).eq("id", appId);
    if (error) toast.error("Failed to remove attachment");
    else toast.success("Attachment removed");
  };

  if (apps.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">No applications match this filter.</p>
        <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
      </div>
    );
  }

  const formatCityState = (location: string) => {
    const parts = location.split(",").map(s => s.trim());
    if (parts.length >= 2) {
      const state = parts[parts.length - 1].replace(/\d{5}(-\d{4})?/, "").trim();
      const city = parts[parts.length - 2];
      return `${city}, ${state}`;
    }
    return location;
  };

  return (
    <div className="space-y-3">
      {apps.map((app) => {
        const job = app.job;
        if (!job) return null;
        const jobAny = job as any;
        const status = job.status;
        const isOffered = app.status === "accepted" && status === "accepted" && !jobAny.helper_confirmed_at;
        const isConfirmed = app.status === "accepted" && status === "accepted" && !!jobAny.helper_confirmed_at;
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
        const commissionPercent = jobAny.helper_fee_percent ?? 10;
        const commission = (perHelper * commissionPercent) / 100;
        const payout = perHelper - commission + (job.urgent_fee ?? 0);

        return (
          <div
            key={app.id}
            className={`rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 ${isFullyDone || isPending ? "cursor-pointer" : ""}`}
            onClick={isFullyDone || isPending ? () => setExpandedJobId(isExpanded ? null : app.job_id) : undefined}
          >
            {/* Header - matches poster layout */}
            <div className="w-full px-4 py-2.5 border-b border-border/30 bg-gradient-to-r from-muted/20 to-transparent flex items-center justify-between text-left">
              <h3 className={`font-medium text-[15px] leading-snug truncate min-w-0 ${(categoryColors[job.category || "other"] || categoryColors.other).title}`}>
                {job.title || "Task"}
              </h3>
              <span className="flex items-center gap-0.5 font-semibold text-primary text-sm bg-primary/8 px-2 py-0.5 rounded-full shrink-0 ml-3" title={`Budget: $${job.budget} · Fee: ${commissionPercent}%`}>
                <DollarSign className="w-3.5 h-3.5" />{payout.toFixed(2)}
              </span>
            </div>

            {/* Summary info line */}
            <div className="px-4 py-3 space-y-2.5">
              <div className="flex items-center gap-2.5 flex-wrap text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 shrink-0" />
                  {new Date(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {!job.start_time ? " · Flexible" : ` · ${new Date(`2000-01-01T${job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                </span>
                <a
                  onClick={(e) => e.stopPropagation()}
                  href={job.latitude && job.longitude ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}` : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-primary transition-colors"
                >
                  <MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[140px]">{formatCityState(job.location)}</span>
                </a>
                {job.estimated_hours && (
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3 shrink-0" /> {job.estimated_hours}h</span>
                )}
                {isPending && job.expires_at && !job.helper_id && (() => {
                  const expired = new Date(job.expires_at!) <= new Date();
                  const expiringSoon = differenceInHours(new Date(job.expires_at!), new Date()) < 24;
                  const text = expired ? "Expired" : formatDistanceToNow(new Date(job.expires_at!), { addSuffix: false }) + " left";
                  return (
                    <span className={`flex items-center gap-1 ${expiringSoon ? "text-destructive font-medium" : ""}`}>
                      <Timer className="w-3 h-3 shrink-0" /> {text}
                    </span>
                  );
                })()}
              </div>

              {/* For pending: description is expandable. For others: always visible */}
              {!isPending && job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase() && (
                <p className="text-xs text-muted-foreground leading-relaxed">{job.description}</p>
              )}
              {!isPending && job.special_requirements?.trim() && (
                <div className="rounded-lg bg-secondary/30 p-2">
                  <p className="text-[10px] text-muted-foreground mb-0.5">Special Requirements</p>
                  <p className="text-xs text-foreground">{job.special_requirements}</p>
                </div>
              )}

              {/* Poster name - always visible */}
              {app.posterName && (
                <p className="text-xs text-muted-foreground">
                  Posted by <a href={`/user/${job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{app.posterName}</a>
                </p>
              )}
            </div>

            {/* Pending expandable section */}
            {isPending && isExpanded && (
              <div className="px-4 pb-3 space-y-2">
                {job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase() && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                    <p className="text-xs text-foreground leading-relaxed">{job.description}</p>
                  </div>
                )}
                {job.special_requirements?.trim() && (
                  <div className="rounded-lg bg-secondary/30 p-2">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Special Requirements</p>
                    <p className="text-xs text-foreground">{job.special_requirements}</p>
                  </div>
                )}
                {(job.photos || []).length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(job.photos || []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <img src={url} alt={`Photo ${i + 1}`} className="w-24 h-16 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pending expand hint + withdraw */}
            {isPending && (
              <div className="px-4 py-2.5 border-t border-border/30 bg-muted/10 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-muted-foreground cursor-pointer" onClick={() => setExpandedJobId(isExpanded ? null : app.job_id)}>
                  {isExpanded ? "▲ Less" : "▼ Details"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/30 hover:bg-destructive/5"
                  disabled={withdrawingAppId === app.id}
                  onClick={() => handleWithdraw(app.id, job.title || "Task")}
                >
                  <XCircle className="w-4 h-4 mr-1" /> {withdrawingAppId === app.id ? "Withdrawing…" : "Withdraw"}
                </Button>
              </div>
            )}

            {/* === ACTION SECTIONS === */}

            {/* Offered: accept/decline */}
            {isOffered && (
              <div className="px-4 py-3 border-t border-border/30 bg-muted/10 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                {jobAny.response_deadline && (
                  <div className="text-xs text-muted-foreground text-center px-2 py-1 rounded bg-muted/50">
                    <Clock className="w-3 h-3 inline mr-1" />
                    Respond by {new Date(jobAny.response_deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => onHelperResponse(app, true)}><ThumbsUp className="w-4 h-4 mr-1" /> Accept Job</Button>
                  <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onHelperResponse(app, false)}><ThumbsDown className="w-4 h-4 mr-1" /> Decline</Button>
                </div>
              </div>
            )}

            {/* Confirmed: On My Way / Arrived flow */}
            {isConfirmed && (
              <div className="px-4 py-3 border-t border-border/30 bg-muted/10 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                {/* Progress steps */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">✓ Accepted</span>
                  {jobAny.helper_on_the_way_at && !jobAny.poster_confirmed_working_at && <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">✓ On the way</span>}
                  {jobAny.helper_arrived_at && !jobAny.poster_confirmed_working_at && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Arrived</span>}
                </div>

                {/* Next action */}
                {!jobAny.helper_on_the_way_at && (
                  <Button size="sm" className="w-full" onClick={() => onMarkOnTheWay(app.job_id)} disabled={onTheWayLoading === app.job_id}>
                    <NavigationIcon className="w-4 h-4 mr-1" /> {onTheWayLoading === app.job_id ? "Updating…" : "On My Way"}
                  </Button>
                )}
                {jobAny.helper_on_the_way_at && !jobAny.helper_arrived_at && (
                  <Button size="sm" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => onMarkArrived(app.job_id)} disabled={arrivedLoading === app.job_id}>
                    <MapPin className="w-4 h-4 mr-1" /> {arrivedLoading === app.job_id ? "Updating…" : "I've Arrived"}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>

                {/* Tracking */}
                <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} />
              </div>
            )}

            {/* In Progress / Revision */}
            {isActive && (
              <div className="px-4 py-3 border-t border-border/30 bg-muted/10 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                {/* Revision notice */}
                {status === "revision_requested" && (
                  <div className="space-y-2">
                    {jobAny.revision_note && (
                      <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                        <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                        <p className="text-xs text-muted-foreground mt-1">{jobAny.revision_note}</p>
                      </div>
                    )}
                    {jobAny.revision_deadline && !jobAny.revision_completed_at && (
                      <DeadlineCountdown
                        deadline={jobAny.revision_deadline}
                        expiredText="Revision deadline passed — poster can dispute or complete"
                        consequenceText="Fix the revision before the deadline. If not completed, the poster can file a dispute."
                        variant="warning"
                      />
                    )}
                    {jobAny.revision_completed_at ? (
                      <div className="space-y-2">
                        <div className="text-xs text-center px-2 py-1.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">✓ Marked as fixed — waiting for poster</div>
                        {jobAny.revision_acceptance_deadline && (
                          <DeadlineCountdown
                            deadline={jobAny.revision_acceptance_deadline}
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

                {/* Complete + Message */}
                <div className="grid grid-cols-2 gap-2">
                  {!jobAny.helper_completed_at && (
                    <Button size="sm" className="w-full" onClick={() => onComplete(app.job_id)} disabled={completingJobId === app.job_id}>
                      <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === app.job_id ? "…" : "Mark Complete"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                </div>

                {/* Completion status */}
                {jobAny.helper_completed_at && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-medium text-primary">
                      {jobAny.poster_completed_at ? 'Job complete ✓' : 'Marked complete — waiting for poster'}
                    </span>
                  </div>
                )}

                {/* Photo proof - last */}
                {jobAny.helper_arrived_at && (
                  <PhotoProofGroup
                    jobId={app.job_id}
                    beforeUrls={jobAny.proof_before_urls || []}
                    afterUrls={jobAny.proof_after_urls || []}
                    canUploadBefore={true}
                    canUploadAfter={true}
                    requireAfter={true}
                    budget={job.budget || 0}
                  />
                )}
              </div>
            )}

            {/* Disputed */}
            {isDisputed && (() => {
              const disputeStatus = jobAny.dispute_status || "open";
              const hasResponded = !!jobAny.dispute_helper_response;
              return (
                <div className="px-4 py-3 border-t border-border/30 bg-destructive/5 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                  {/* Dispute info */}
                  <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-xs font-semibold text-destructive flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {disputeStatus === "escalated" ? "Escalated to Admin" : "Dispute In Progress"}
                    </p>
                    {jobAny.dispute_reason && (
                      <p className="text-xs text-muted-foreground mt-1">Reason: {jobAny.dispute_reason}</p>
                    )}
                    {jobAny.disputed_at && (
                      <p className="text-[10px] text-muted-foreground mt-1">Filed {formatDistanceToNow(new Date(jobAny.disputed_at), { addSuffix: true })}</p>
                    )}
                  </div>

                  {jobAny.dispute_deadline && (
                    <DeadlineCountdown
                      deadline={jobAny.dispute_deadline}
                      expiredText="Deadline passed — payment auto-releasing to you"
                      consequenceText="If the poster doesn't resolve or escalate, payment auto-releases to you after the deadline."
                      variant="destructive"
                    />
                  )}

                  {/* Photo proof */}
                  {jobAny.helper_arrived_at && (
                    <PhotoProofGroup
                      jobId={app.job_id}
                      beforeUrls={jobAny.proof_before_urls || []}
                      afterUrls={jobAny.proof_after_urls || []}
                      canUploadBefore={true}
                      canUploadAfter={true}
                      requireAfter={true}
                      budget={job.budget || 0}
                    />
                  )}

                  {/* Helper's response */}
                  {hasResponded && (
                    <div className="p-2 rounded-lg bg-primary/5 border border-primary/20">
                      <p className="text-[10px] text-muted-foreground font-medium">Your response:</p>
                      <p className="text-xs text-foreground mt-0.5">"{jobAny.dispute_helper_response}"</p>
                    </div>
                  )}

                  {/* Respond form */}
                  {!hasResponded && disputeStatus === "open" && (
                    <div className="space-y-2">
                      {respondingJobId === app.job_id ? (
                        <div className="space-y-2">
                          <Textarea
                            placeholder="Explain your side — what work was done, any issues, etc."
                            value={disputeResponse}
                            onChange={(e) => setDisputeResponse(e.target.value)}
                            rows={3}
                            maxLength={500}
                            className="text-xs"
                          />
                          <div className="flex gap-2">
                            <Button size="sm" className="flex-1" disabled={!disputeResponse.trim() || submittingResponse} onClick={async () => {
                              setSubmittingResponse(true);
                              const { error } = await supabase.from("jobs").update({ dispute_helper_response: disputeResponse.trim(), dispute_status: "helper_responded" } as any).eq("id", app.job_id);
                              if (error) { toast.error("Failed to submit response"); setSubmittingResponse(false); return; }
                              if (job.customer_id) await createNotification({ user_id: job.customer_id, title: "Helpr responded to dispute", message: `The helpr has responded to the dispute on "${job.title}". Please review and mark resolved or escalate.`, type: "info", link: "/my-posts?filter=disputed" });
                              toast.success("Response submitted — poster will review");
                              setSubmittingResponse(false);
                              setRespondingJobId(null);
                              setDisputeResponse("");
                              window.location.reload();
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
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    If not resolved within 72 hours, payment auto-releases to you.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/messages?jobId=${app.job_id}&userId=${job.customer_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact Admin</Button>
                  </div>
                </div>
              );
            })()}

            {isCompleted && !isFullyDone && (
              <div className="px-4 py-3 border-t border-border/30 bg-muted/10 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                <PhotoProofGroup
                  jobId={app.job_id}
                  beforeUrls={jobAny.proof_before_urls || []}
                  afterUrls={jobAny.proof_after_urls || []}
                  canUpload={false}
                />
                {helperReviewedJobIds.has(app.job_id) ? (
                  <Button size="sm" variant="outline" className="w-full" disabled><Star className="w-4 h-4 mr-1" /> Reviewed ✓</Button>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" onClick={() => onHelperReview(app.job_id, job.customer_id, app.posterName || "Poster")}>
                    <Star className="w-4 h-4 mr-1" /> Review Poster
                  </Button>
                )}
              </div>
            )}

            {/* Fully done - collapsible with expand hint */}
            {isFullyDone && (
              <div className="px-4 py-1.5 border-t border-border/40 bg-muted/15 flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Reviewed ✓</span>
                <span className="text-xs text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
              </div>
            )}

            {isFullyDone && isExpanded && (
              <div className="px-4 py-3 border-t border-border/30 bg-muted/10 space-y-2.5" onClick={(e) => e.stopPropagation()}>
                <PhotoProofGroup
                  jobId={app.job_id}
                  beforeUrls={jobAny.proof_before_urls || []}
                  afterUrls={jobAny.proof_after_urls || []}
                  canUpload={false}
                />
              </div>
            )}

            {/* Footer: extra details (photos, requirements, group/recurring) */}
            {(!isFullyDone || isExpanded) && ((job.photos || []).length > 0 || job.is_recurring || job.is_group_job) && (
              <div className="px-4 py-2.5 border-t border-border/20 space-y-2">
                {(job.photos || []).length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(job.photos || []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <img src={url} alt={`Photo ${i + 1}`} className="w-24 h-16 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                      </a>
                    ))}
                  </div>
                )}
                {job.is_recurring && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="w-3 h-3 text-primary" />
                    <span>{job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Recurring"}{job.recurrence_end_date && ` until ${new Date(job.recurrence_end_date).toLocaleDateString()}`}</span>
                  </div>
                )}
                {job.is_group_job && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="w-3 h-3 text-primary" />
                    <span>{job.helpers_needed ? `${job.helpers_needed} helprs needed` : "Group task"}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
