import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, MapPin, DollarSign, XCircle, CheckCircle2, RotateCcw,
  Star, MessageSquare, Users, Pencil, AlertTriangle, RefreshCw,
  Rocket, Clock, Calendar, Timer, Navigation as NavigationIcon, Wrench,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobTracking } from "@/components/JobTracking";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";

import { getCityState } from "@/lib/locationUtils";
import { type Job, type Application, type EnrichedApplication, categoryColors } from "./activityConstants";

interface PostedJobsTabProps {
  jobs: Job[];
  applicantCounts: Record<string, number>;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  startRequestedJobIds: Set<string>;
  userId: string;
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
  onConfirmStart: (jobId: string) => void;
  onConfirmArrival: (jobId: string) => void;
  onConfirmWorking: (jobId: string) => void;
  onLoadApplications: (job: Job) => void;
  selectedJob: Job | null;
  setSelectedJob: (job: Job | null) => void;
  applications: EnrichedApplication[];
  onAcceptApplication: (app: EnrichedApplication) => void;
  onLoadInlineApplicants: (jobId: string) => void;
  inlineApplicants: Record<string, EnrichedApplication[]>;
  loadingApplicants: Record<string, boolean>;
}

export const PostedJobsTab = ({
  jobs, applicantCounts, expandedJobId, setExpandedJobId,
  helperNames, completedJobMeta, startRequestedJobIds, userId,
  onBoost, onEdit, onCancel, onComplete, completingJobId,
  onRevision, onNoShow, onTip, onReview, onDispute, onConfirmStart, onConfirmArrival, onConfirmWorking,
  onLoadApplications, selectedJob, setSelectedJob, applications,
  onAcceptApplication, onLoadInlineApplicants, inlineApplicants, loadingApplicants,
}: PostedJobsTabProps) => {
  const navigate = useNavigate();

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">No tasks match this filter.</p>
      </div>
    );
  }

  const helperName = (job: Job) => job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr";

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {jobs.map((job) => {
          const catStyle = categoryColors[job.category] || categoryColors.other;
          const ja = job as any;
          const status = job.status;
          const isOpen = status === "open";
          const isAccepted = status === "accepted";
          const isActive = status === "in_progress" || status === "revision_requested";
          const isCompleted = status === "completed";
          const isDisputed = status === "disputed";

          return (
            <div key={job.id} className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm hover:shadow-md transition-all duration-200">

              {/* ── HEADER ── */}
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className={`font-bold text-[15px] leading-snug truncate ${catStyle.title}`}>{job.title}</h3>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      {!job.start_time ? " · Flexible" : ` · ${new Date(`2000-01-01T${job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                    </span>
                    <a onClick={(e) => e.stopPropagation()} href={job.latitude && job.longitude ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}` : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                      <MapPin className="w-3 h-3" /><span className="truncate max-w-[140px]">{getCityState(job.location)}</span>
                    </a>
                    {job.estimated_hours && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {job.estimated_hours}h</span>}
                  </div>
                </div>
                <span className="flex items-center gap-0.5 font-bold text-primary text-sm shrink-0 bg-primary/8 px-2 py-0.5 rounded-full">
                  <DollarSign className="w-3.5 h-3.5" />{job.budget}
                </span>
              </div>

              {/* ── DESCRIPTION + ASSIGNED HELPER ── */}
              <div className="px-4 pb-2 space-y-2">
                {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{job.description}</p>
                )}
                {job.helper_id && !isOpen && (
                  <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-muted/40">
                    <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                      {helperName(job)[0].toUpperCase()}
                    </div>
                    <span className="text-xs text-muted-foreground">Assigned to</span>
                    <a href={`/user/${job.helper_id}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-primary hover:underline">{helperName(job)}</a>
                  </div>
                )}
                {/* Applicant count + expiry for open jobs */}
                {isOpen && (
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    {(applicantCounts[job.id] || 0) > 0 && (
                      <span className="flex items-center gap-1 text-primary font-medium"><Users className="w-3 h-3" /> {applicantCounts[job.id]} applicant{applicantCounts[job.id] !== 1 ? "s" : ""}</span>
                    )}
                    {job.expires_at && !job.helper_id && (() => {
                      const expired = new Date(job.expires_at) <= new Date();
                      const expiringSoon = differenceInHours(new Date(job.expires_at), new Date()) < 24;
                      const text = expired ? "Expired" : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left";
                      return <span className={`flex items-center gap-1 ${expiringSoon ? "text-destructive font-medium" : ""}`}><Timer className="w-3 h-3" /> {text}</span>;
                    })()}
                  </div>
                )}
              </div>

              {/* ── PROGRESS STEPS (accepted / in_progress) ── */}
              {(isAccepted || isActive) && (
                <div className="px-4 pb-2">
                  <div className="flex items-center gap-1.5 flex-wrap text-xs">
                    {/* Helper confirmed */}
                    {ja.helper_confirmed_at
                      ? <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">✓ Confirmed</span>
                      : isAccepted && <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">⏳ Awaiting confirmation</span>
                    }
                    {/* On the way */}
                    {ja.helper_on_the_way_at && <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">✓ On the way</span>}
                    {/* Arrived */}
                    {ja.helper_arrived_at && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Arrived</span>
                    )}
                    {/* Poster confirmed arrival */}
                    {ja.poster_confirmed_arrival_at && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Arrival confirmed</span>}
                    {/* Working confirmed */}
                    {ja.poster_confirmed_working_at && <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Working</span>}
                    {/* Helper marked complete */}
                    {ja.helper_completed_at && <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">✓ Helpr done</span>}
                    {/* Poster approved */}
                    {ja.poster_completed_at && <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">✓ Approved</span>}
                  </div>
                </div>
              )}

              {/* ── ACTIONS SECTION ── */}
              <div className="border-t border-border/30 bg-muted/8 px-4 py-3 space-y-2.5" onClick={(e) => e.stopPropagation()}>

                {/* === OPEN === */}
                {isOpen && (
                  <>
                    <Button size="sm" variant="outline" className="w-full border-primary text-primary hover:bg-primary/10" onClick={() => onLoadApplications(job)}>
                      <Users className="w-4 h-4 mr-1" /> Applicants{(applicantCounts[job.id] || 0) > 0 ? ` (${applicantCounts[job.id]})` : ""}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="flex-1 bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onBoost(job.id)}><Rocket className="w-4 h-4 mr-1" /> Boost</Button>
                      <Button size="sm" className="flex-1 bg-primary/10 text-primary hover:bg-primary/20 border-0" onClick={() => onEdit(job)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                      <Button size="sm" className="flex-1 bg-destructive/10 text-destructive hover:bg-destructive/20 border-0" onClick={() => onCancel(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
                    </div>
                  </>
                )}

                {/* === ACCEPTED === */}
                {isAccepted && (
                  <>
                    {/* Confirm Arrival — top priority when helper has arrived */}
                    {ja.helper_arrived_at && !ja.poster_confirmed_arrival_at && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-medium">{helperName(job)} says they've arrived</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">{new Date(ja.helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <Button size="sm" className="w-full" onClick={() => onConfirmArrival(job.id)}>
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Arrival
                        </Button>
                      </div>
                    )}
                    {/* Tracking */}
                    {job.helper_id && <JobTracking jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={true} />}
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                      {startRequestedJobIds.has(job.id) && !ja.helper_confirmed_at && (
                        <Button size="sm" className="flex-1" onClick={() => onConfirmStart(job.id)}><CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Start</Button>
                      )}
                      <Button size="sm" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-0" onClick={() => onCancel(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
                    </div>
                  </>
                )}

                {/* === IN PROGRESS / REVISION === */}
                {isActive && (
                  <>
                    {/* 1. Confirm Arrival (top priority) */}
                    {ja.helper_arrived_at && !ja.poster_confirmed_arrival_at && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-medium">{helperName(job)} says they've arrived</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">{new Date(ja.helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <Button size="sm" className="w-full" onClick={() => onConfirmArrival(job.id)}>
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Arrival
                        </Button>
                      </div>
                    )}

                    {/* 2. Confirm Working */}
                    {status === "in_progress" && !ja.poster_confirmed_working_at && ja.poster_confirmed_arrival_at && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                          <Wrench className="w-3.5 h-3.5 shrink-0" />
                          <span className="font-medium">Is {helperName(job)} working?</span>
                        </div>
                        <Button size="sm" className="w-full" onClick={() => onConfirmWorking(job.id)}>
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Working
                        </Button>
                      </div>
                    )}

                    {/* 3. Photo proof */}
                    {ja.helper_arrived_at && (
                      <PhotoProofGroup
                        jobId={job.id}
                        beforeUrls={ja.proof_before_urls || []}
                        afterUrls={ja.proof_after_urls || []}
                        canUploadBefore={false}
                        canUploadAfter={false}
                        requireAfter={true}
                        budget={job.budget}
                      />
                    )}

                    {/* 4. Revision notice */}
                    {status === "revision_requested" && (
                      <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 space-y-1.5">
                        <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                        {ja.revision_note && <p className="text-xs text-muted-foreground">{ja.revision_note}</p>}
                        {ja.revision_completed_at ? (
                          <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                            <p className="text-xs text-emerald-600 font-medium">✓ Helpr marked revision as fixed</p>
                            {ja.revision_acceptance_deadline && (
                              <DeadlineCountdown deadline={ja.revision_acceptance_deadline} expiredText="Acceptance deadline passed — payment releasing to helpr" consequenceText="Accept the fix, or dispute. If no action is taken, payment auto-releases to the helpr." variant="warning" />
                            )}
                          </div>
                        ) : ja.revision_deadline && (
                          <DeadlineCountdown deadline={ja.revision_deadline} expiredText="Revision deadline passed — you can now dispute or complete" consequenceText="Helpr must fix the revision before this deadline. After that, you can dispute or mark complete." variant="warning" />
                        )}
                      </div>
                    )}

                    {/* 5. Approve / Complete + Message */}
                    <div className="flex items-center gap-2">
                      {ja.helper_completed_at && (
                        <Button size="sm" className="flex-1" onClick={() => onComplete(job.id)} disabled={completingJobId === job.id || !!ja.poster_completed_at}>
                          <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === job.id ? "…" : ja.poster_completed_at ? "Approved ✓" : "Approve & Complete"}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                    </div>

                    {/* 6. Revision / No-Show / Dispute */}
                    {status === "in_progress" && !ja.poster_completed_at && (
                      <div className="flex items-center gap-2">
                        {ja.helper_completed_at && (
                          <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onRevision(job.id)}>
                            <AlertTriangle className="w-4 h-4 mr-1" /> Revision
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onNoShow(job.id)}>
                          <XCircle className="w-4 h-4 mr-1" /> No-Show
                        </Button>
                      </div>
                    )}
                    {(status === "revision_requested" || ja.revision_requested_at) && (
                      <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onDispute(job)}>
                        <AlertTriangle className="w-4 h-4 mr-1" /> Dispute
                      </Button>
                    )}

                    {/* Tracking */}
                    {job.helper_id && <JobTracking jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={true} />}

                    {/* Group helpers */}
                    {ja.is_group_job && <GroupJobHelpers jobId={job.id} helpersNeeded={ja.helpers_needed || 2} isOwner={true} />}
                  </>
                )}

                {/* === COMPLETED === */}
                {isCompleted && (() => {
                  const meta = completedJobMeta[job.id];
                  const hasTipped = meta?.tipped;
                  const hasReviewed = meta?.reviewed;
                  const name = helperName(job);
                  return (
                    <>
                      <PhotoProofGroup jobId={job.id} beforeUrls={ja.proof_before_urls || []} afterUrls={ja.proof_after_urls || []} canUpload={false} />
                      <div className="grid grid-cols-2 gap-2">
                        {!hasTipped ? (
                          <Button size="sm" className="w-full bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onTip(job.id, name)}>
                            <DollarSign className="w-4 h-4 mr-1" /> Tip
                          </Button>
                        ) : (
                          <Button size="sm" className="w-full bg-muted text-muted-foreground border-0" disabled><CheckCircle2 className="w-4 h-4 mr-1" /> Tipped ✓</Button>
                        )}
                        {!hasReviewed ? (
                          <Button size="sm" className="w-full bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onReview(job)}>
                            <Star className="w-4 h-4 mr-1" /> Review
                          </Button>
                        ) : (
                          <Button size="sm" className="w-full bg-muted text-muted-foreground border-0" disabled><CheckCircle2 className="w-4 h-4 mr-1" /> Reviewed ✓</Button>
                        )}
                      </div>
                      <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/post-job?rebook=${job.id}`)}>
                        <RotateCcw className="w-4 h-4 mr-1" /> Rebook
                      </Button>
                      {ja.revision_requested_at ? (
                        <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onDispute(job)}>
                          <AlertTriangle className="w-4 h-4 mr-1" /> Dispute
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onRevision(job.id)}>
                            <AlertTriangle className="w-4 h-4 mr-1" /> Request Revision
                          </Button>
                          <p className="text-[10px] text-muted-foreground text-center italic">Request a revision first before filing a dispute</p>
                        </>
                      )}
                    </>
                  );
                })()}

                {/* === DISPUTED === */}
                {isDisputed && (() => {
                  const disputeStatus = ja.dispute_status || "open";
                  const isDisputer = ja.disputed_by === userId;
                  return (
                    <>
                      {ja.helper_arrived_at && (
                        <PhotoProofGroup jobId={job.id} beforeUrls={ja.proof_before_urls || []} afterUrls={ja.proof_after_urls || []} canUploadBefore={false} canUploadAfter={false} requireAfter={true} budget={job.budget} />
                      )}
                      <div className="p-2.5 rounded-lg bg-destructive/5 border border-destructive/20 space-y-1.5">
                        <p className="text-xs text-destructive font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />
                          {disputeStatus === "escalated" ? "Escalated to Admin" : disputeStatus === "resolved" ? "Dispute Resolved" : "Dispute Under Review"}
                        </p>
                        <p className="text-xs text-muted-foreground">Payment is on hold pending resolution.</p>
                        {ja.dispute_reason && <p className="text-xs text-muted-foreground italic">"{ja.dispute_reason}"</p>}
                        {ja.dispute_helper_response && (
                          <div className="mt-1.5 p-2 rounded bg-muted/50">
                            <p className="text-[10px] text-muted-foreground font-medium">Helpr's response:</p>
                            <p className="text-xs text-foreground mt-0.5">"{ja.dispute_helper_response}"</p>
                          </div>
                        )}
                        {ja.dispute_deadline && disputeStatus !== "resolved" && (
                          <DeadlineCountdown deadline={ja.dispute_deadline} expiredText="Deadline passed — payment auto-releasing to helpr" consequenceText="Confirm the issue is fixed or escalate to admin. If no action is taken, payment auto-releases to the helpr." variant="destructive" />
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        You have 72 hours to confirm the issue is fixed or escalate. Otherwise payment auto-releases.
                      </p>
                      {isDisputer && disputeStatus === "open" && (
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={async (e) => {
                            e.stopPropagation();
                            const { error } = await supabase.from("jobs").update({ status: "completed" as any, dispute_status: "resolved", dispute_resolved_at: new Date().toISOString() } as any).eq("id", job.id);
                            if (error) { toast.error("Failed to resolve"); return; }
                            if (job.helper_id) await createNotification({ user_id: job.helper_id, title: "Dispute resolved ✓", message: `The poster confirmed the issue on "${job.title}" is resolved. Payment will be released.`, type: "payment", link: "/activity?tab=applied&filter=completed" });
                            toast.success("Dispute resolved — payment released to helpr");
                            window.location.reload();
                          }}><CheckCircle2 className="w-4 h-4 mr-1" /> Resolved</Button>
                          <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={async (e) => {
                            e.stopPropagation();
                            const { error } = await supabase.from("jobs").update({ dispute_status: "escalated" } as any).eq("id", job.id);
                            if (error) { toast.error("Failed to escalate"); return; }
                            const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
                            if (adminRoles) { for (const admin of adminRoles) { await createNotification({ user_id: admin.user_id, title: "🚨 Dispute escalated", message: `"${job.title}" dispute has been escalated and requires admin decision.`, type: "warning", link: "/admin" }); } }
                            toast.success("Dispute escalated to admin");
                            window.location.reload();
                          }}><AlertTriangle className="w-4 h-4 mr-1" /> Escalate</Button>
                        </div>
                      )}
                      {isDisputer && disputeStatus === "escalated" && (
                        <div className="text-xs text-center text-muted-foreground px-2 py-1.5 rounded bg-muted/50">Admin is reviewing. You'll be notified of the outcome.</div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                        <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Support</Button>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* ── FOOTER: Extra details ── */}
              {((job.photos || []).length > 0 || job.special_requirements?.trim() || job.is_recurring || job.is_group_job) && (
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
                  {job.special_requirements?.trim() && (
                    <div className="rounded-lg bg-secondary/30 p-2">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Special Requirements</p>
                      <p className="text-xs text-foreground">{job.special_requirements}</p>
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

      {/* Applicants full-screen view */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col animate-in slide-in-from-right duration-200">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
            <Button variant="ghost" size="sm" onClick={() => setSelectedJob(null)}><ArrowLeft className="w-4 h-4" /></Button>
            <div className="min-w-0 flex-1">
              <h2 className="font-display font-semibold text-foreground truncate">Applicants</h2>
              <p className="text-xs text-muted-foreground truncate">{selectedJob.title}</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {applications.length === 0 ? (
              <div className="text-center py-12">
                <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No applications yet.</p>
              </div>
            ) : (
              <div className="space-y-3 max-w-lg mx-auto">
                {applications.map((app) => (
                  <div key={app.id} className="p-4 rounded-xl border border-border bg-card space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <a href={`/user/${app.helper_id}`} className="font-medium text-primary hover:underline">{formatName(app.profiles?.full_name, "Helpr")}</a>
                        {app.profiles?.skills && <p className="text-xs text-muted-foreground">{app.profiles.skills}</p>}
                        {app.reviewCount !== undefined && app.reviewCount > 0 && (
                          <div className="flex items-center gap-1 mt-1">
                            <Star className="w-3 h-3 fill-accent text-accent" />
                            <span className="text-xs text-muted-foreground">{app.avgRating?.toFixed(1)} ({app.reviewCount} reviews)</span>
                          </div>
                        )}
                      </div>
                      {app.status === "pending" && <Button size="sm" onClick={() => onAcceptApplication(app)}>Select</Button>}
                      {app.status === "accepted" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary">Selected</span>}
                      {app.status === "rejected" && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-destructive/10 text-destructive">Declined</span>}
                    </div>
                    {app.message && (
                      <div className="rounded-lg bg-secondary/30 p-3 mt-2">
                        <p className="text-xs text-muted-foreground mb-0.5">Their message to you:</p>
                        <p className="text-sm text-foreground">{app.message}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
