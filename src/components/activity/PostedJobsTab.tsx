import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { formatName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, MapPin, DollarSign, XCircle, CheckCircle2, RotateCcw,
  Star, MessageSquare, Users, Pencil, AlertTriangle, RefreshCw,
  Rocket, Clock, Calendar, Timer, Navigation as NavigationIcon, Wrench, FileText,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { PhotoProof, PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking } from "@/components/JobTracking";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";
import { AttachmentLink } from "@/components/AttachmentLink";

import { getCityState } from "@/lib/locationUtils";
import { parseLocalDate } from "@/lib/dateUtils";
import { type Job, type Application, type EnrichedApplication, categoryColors } from "./activityConstants";

const JobCountdown = ({ dateNeeded, startTime, label }: { dateNeeded: string; startTime?: string | null; label: string }) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Parse date parts manually to avoid timezone shifts
  const [year, month, day] = dateNeeded.split("-").map(Number);
  const jobDate = new Date(year, month - 1, day);
  if (startTime) {
    const [h, m] = startTime.split(":").map(Number);
    jobDate.setHours(h, m, 0, 0);
  } else {
    jobDate.setHours(23, 59, 59, 0);
  }

  const diffMs = jobDate.getTime() - now.getTime();
  if (diffMs <= 0) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg border border-primary/30 bg-primary/10">
        <Timer className="w-4 h-4 text-primary shrink-0" />
        <p className="text-xs font-semibold text-primary">Job time has arrived!</p>
      </div>
    );
  }

  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;

  const timeStr = days > 0 ? `${days}d ${hours}h ${minutes}m` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  const isUrgent = totalMin < 720;
  const isCritical = totalMin < 120;

  const colorClasses = isCritical
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : isUrgent
    ? "border-accent/30 bg-accent/10 text-accent"
    : "border-primary/20 bg-primary/5 text-primary";

  return (
    <div className={`flex items-center gap-2 p-2.5 rounded-lg border ${colorClasses}`}>
      <Timer className="w-4 h-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold tabular-nums">{label}: {timeStr}</p>
        <p className="text-[10px] opacity-80 mt-0.5">
          {startTime
            ? new Date(jobDate).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : new Date(jobDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + " · Flexible"
          }
        </p>
      </div>
    </div>
  );
};

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

  const handleCardClick = (jobId: string, job: Job) => {
    if (job.status === "open" || job.status === "accepted") {
      onLoadInlineApplicants(jobId);
    }
  };

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">No tasks match this filter.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {jobs.map((job) => {
          const catStyle = categoryColors[job.category] || categoryColors.other;
          const meta = completedJobMeta[job.id];
          const isFullyCompleted = job.status === "completed" && meta?.tipped && meta?.reviewed;
          const isExpanded = expandedJobId === job.id;
          return (
            <div
              key={job.id}
              className={`group rounded-2xl border border-border/50 bg-card overflow-hidden relative shadow-sm hover:shadow-md hover:border-primary/25 transition-all duration-200 ${isFullyCompleted ? "cursor-pointer" : ""}`}
              onClick={isFullyCompleted ? () => setExpandedJobId(isExpanded ? null : job.id) : undefined}
            >
              {/* Top bar */}
              <div className="w-full px-4 py-2.5 border-b border-border/30 bg-gradient-to-r from-muted/20 to-transparent flex items-center justify-between text-left">
                <h3 className={`font-medium text-[15px] leading-snug truncate min-w-0 ${catStyle.title}`}>{job.title}</h3>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <span className="flex items-center gap-0.5 font-semibold text-primary text-sm bg-primary/8 px-2 py-0.5 rounded-full"><DollarSign className="w-3.5 h-3.5" />{job.budget}</span>
                  
                </div>
              </div>

              {/* Summary */}
              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center gap-2.5 flex-wrap text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 shrink-0" />
                    {parseLocalDate(job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {!job.start_time ? " · Flexible time" : ` · ${new Date(`2000-01-01T${job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                  </span>
                  {(() => {
                    const cityState = getCityState(job.location);
                    return (
                      <a onClick={(e) => e.stopPropagation()} href={job.latitude && job.longitude ? `https://www.google.com/maps?q=${job.latitude},${job.longitude}` : `https://www.google.com/maps/search/${encodeURIComponent(job.location)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                        <MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[140px]">{cityState}</span>
                      </a>
                    );
                  })()}
                  {job.estimated_hours && (
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3 shrink-0" /> {job.estimated_hours}h</span>
                  )}
                  {job.expires_at && !job.helper_id && (() => {
                    const expiryText = new Date(job.expires_at) <= new Date() ? "Expired" : formatDistanceToNow(new Date(job.expires_at), { addSuffix: false }) + " left";
                    const isExpiringSoon = differenceInHours(new Date(job.expires_at), new Date()) < 24;
                    return (<span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}><Timer className="w-3 h-3 shrink-0" /> {expiryText}</span>);
                  })()}
                  {(applicantCounts[job.id] || 0) > 0 && job.status === "open" && (
                    <span className="flex items-center gap-1 text-primary font-medium"><Users className="w-3 h-3 shrink-0" /> {applicantCounts[job.id]} applicant{applicantCounts[job.id] !== 1 ? "s" : ""}</span>
                   )}
                   {job.is_recurring && (
                     <span className="flex items-center gap-1"><RefreshCw className="w-3 h-3 shrink-0 text-primary" /> {job.recurrence_interval ? `Every ${job.recurrence_interval}` : "Recurring"}</span>
                   )}
                   {job.is_group_job && (
                     <span className="flex items-center gap-1"><Users className="w-3 h-3 shrink-0 text-primary" /> {job.helpers_needed ? `${job.helpers_needed} helprs` : "Group task"}</span>
                   )}
                 </div>
              {(job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() || job.special_requirements?.trim()) && (
                <div className="space-y-1.5">
                  {job.description.trim().toLowerCase() !== job.title.trim().toLowerCase() && (
                    <p className={`text-xs text-muted-foreground leading-relaxed ${isExpanded ? "" : "line-clamp-2"}`}>{job.description}</p>
                  )}
                  {isExpanded && job.special_requirements?.trim() && (
                    <div className="rounded-lg bg-secondary/30 p-2">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Special Requirements</p>
                      <p className="text-xs text-foreground">{job.special_requirements}</p>
                    </div>
                  )}
                  {(job.description.length > 100 || job.special_requirements?.trim()) && (
                    <button
                      type="button"
                      className="text-[10px] text-primary hover:underline"
                      onClick={(e) => { e.stopPropagation(); setExpandedJobId(isExpanded ? null : job.id); }}
                    >
                      {isExpanded ? "▲ Less" : "▼ More details"}
                    </button>
                  )}
                </div>
              )}

                {/* Assigned helper display */}
                {job.helper_id && (job.status === "accepted" || job.status === "in_progress" || job.status === "revision_requested" || job.status === "completed" || job.status === "disputed") && (
                  <div className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-muted/40">
                    <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                      {(helperNames[job.helper_id] || "H")[0].toUpperCase()}
                    </div>
                    <span className="text-xs text-muted-foreground">Offered to</span>
                    <a href={`/user/${job.helper_id}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-primary hover:underline">
                      {helperNames[job.helper_id] || "Helpr"}
                    </a>
                  </div>
                )}

                {/* Accepted status */}
                {job.status === "accepted" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {(job as any).helper_confirmed_at
                        ? <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">✓ {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} accepted</span>
                        : <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 font-medium">⏳ Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"} to accept</span>
                      }
                    </div>
                    {/* Job countdown */}
                    <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
                    {(job as any).helper_confirmed_at && (
                      <div className="space-y-1.5">
                        {(job as any).helper_arrived_at && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} says they've arrived</span>
                              <span className="ml-auto text-[10px] text-muted-foreground">{new Date((job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            {(job as any).poster_confirmed_arrival_at ? (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Arrival confirmed</span>
                            ) : (
                              <Button size="sm" className="w-full" onClick={() => onConfirmArrival(job.id)}>
                                <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Arrival
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}


                {(job.status === "in_progress" || job.status === "revision_requested") && (job as any).poster_confirmed_arrival_at && !(job as any).poster_confirmed_working_at && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">✓ Arrival confirmed</span>
                )}

                {/* Completion confirmation */}
                {(job.status === "in_progress" || job.status === "revision_requested") && ((job as any).poster_completed_at || (job as any).helper_completed_at) && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {(job as any).poster_completed_at && <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">✓ You confirmed</span>}
                    {(job as any).helper_completed_at && <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">✓ {job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} confirmed</span>}
                    {!(job as any).poster_completed_at && <span className="text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for you</span>}
                    {!(job as any).helper_completed_at && <span className="text-xs px-2.5 py-1 rounded-full bg-secondary/60 text-muted-foreground">Waiting for {job.helper_id ? helperNames[job.helper_id] || "helpr" : "helpr"}</span>}
                  </div>
                )}

                {/* Visible live tracking */}
                {(job.status === "accepted" || job.status === "in_progress") && job.helper_id && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <JobTracking jobId={job.id} helperId={job.helper_id} isHelper={false} isOwner={true} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={(job as any).helper_confirmed_at} posterConfirmedAt={(job as any).poster_confirmed_at} />
                  </div>
                )}

                {/* Revision notice */}
                {job.status === "revision_requested" && (
                  <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 space-y-1.5">
                    <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                    {(job as any).revision_note && <p className="text-xs text-muted-foreground">{(job as any).revision_note}</p>}
                    {(job as any).revision_completed_at && (
                      <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                        <p className="text-xs text-emerald-600 font-medium">✓ Helpr marked revision as fixed</p>
                        {(job as any).revision_acceptance_deadline && (
                          <DeadlineCountdown
                            deadline={(job as any).revision_acceptance_deadline}
                            expiredText="Acceptance deadline passed — payment releasing to helpr"
                            consequenceText="Accept the fix, or dispute. If no action is taken, payment auto-releases to the helpr."
                            variant="warning"
                          />
                        )}
                      </div>
                    )}
                    {!(job as any).revision_completed_at && (job as any).revision_deadline && (
                      <DeadlineCountdown
                        deadline={(job as any).revision_deadline}
                        expiredText="Revision deadline passed — you can now dispute or complete"
                        consequenceText="Helpr must fix the revision before this deadline. After that, you can dispute or mark complete."
                        variant="warning"
                      />
                    )}
                  </div>
                )}
              </div>

              

              {/* Completed hint */}
              {job.status === "completed" && (() => {
                const cMeta = completedJobMeta[job.id];
                const hasTipped = cMeta?.tipped;
                const hasReviewed = cMeta?.reviewed;
                if (hasTipped && hasReviewed) {
                  return (
                    <div className="px-4 py-1.5 border-t border-border/40 bg-muted/15 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Tipped & Reviewed</span>
                      <span className="text-xs text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  );
                }
                return (!hasTipped || !hasReviewed) ? (
                  <div className="px-4 py-1.5 border-t border-border/40 bg-muted/15">
                    <span className="text-xs text-muted-foreground">
                      {!hasTipped && !hasReviewed ? "Tap to tip & review" : !hasTipped ? "Tap to leave a tip" : "Tap to leave a review"}
                    </span>
                  </div>
                ) : null;
              })()}

              {/* Additional details - collapsible for fully completed jobs */}
              {(!isFullyCompleted || isExpanded) && (
              <div>
                <div className="px-4 py-3 space-y-3 border-t border-border/30">
                  {(job.photos || []).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {(job.photos || []).map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                            <img src={url} alt={`Photo ${i + 1}`} className="w-28 h-20 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}


                </div>

                {/* Features for active jobs */}
                {(job.status === "in_progress" || job.status === "accepted") && (
                  <div className="px-4 pb-3 space-y-3">
                    <JobConfirmation jobId={job.id} isOwner={true} isHelper={false} posterConfirmedAt={(job as any).poster_confirmed_at} helperConfirmedAt={(job as any).helper_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={(job as any).helper_on_the_way_at} />
                    {(job as any).is_group_job && <GroupJobHelpers jobId={job.id} helpersNeeded={(job as any).helpers_needed || 2} isOwner={true} />}
                    
                  </div>
                )}

                {/* Applicants button */}
                {job.status === "open" && (
                  <div className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="w-full border border-primary text-primary hover:bg-primary/10" onClick={() => onLoadApplications(job)}>
                      <Users className="w-4 h-4 mr-1" /> Applicants{(applicantCounts[job.id] || 0) > 0 ? ` (${applicantCounts[job.id]})` : ""}
                    </Button>
                  </div>
                )}

                {/* Actions */}
                <div className="border-t border-border/30 bg-muted/8 px-4 py-3">
                  <div className="space-y-2">
                    {job.status === "open" && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="flex-1 bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onBoost(job.id)}><Rocket className="w-4 h-4 mr-1" /> Boost</Button>
                        <Button size="sm" className="flex-1 bg-primary/10 text-primary hover:bg-primary/20 border-0" onClick={() => onEdit(job)}><Pencil className="w-4 h-4 mr-1" /> Edit</Button>
                        <Button size="sm" className="flex-1 bg-destructive/10 text-destructive hover:bg-destructive/20 border-0" onClick={() => onCancel(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
                      </div>
                    )}
                    {job.status === "accepted" && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground text-center">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Helpr must confirm 24 hours before the job starts — tracking actions unlock then
                        </p>
                        {startRequestedJobIds.has(job.id) && !(job as any).helper_confirmed_at && (
                          <Button size="sm" className="w-full" onClick={() => onConfirmStart(job.id)}><CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Start</Button>
                        )}
                        <div className="flex gap-2">
                          <Button size="sm" variant="destructive" className="flex-1" onClick={() => onCancel(job)}><XCircle className="w-4 h-4 mr-1" /> Cancel</Button>
                          <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                        </div>
                      </div>
                    )}
                    {(job.status === "in_progress" || job.status === "revision_requested") && (
                      <div className="space-y-2">
                        {/* Confirm Arrival notice */}
                        {(job as any).helper_arrived_at && !(job as any).poster_confirmed_arrival_at && (
                          <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-medium">{job.helper_id ? helperNames[job.helper_id] || "Helpr" : "Helpr"} says they've arrived</span>
                            <span className="ml-auto text-[10px] text-muted-foreground">{new Date((job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        {/* Confirm Arrival + No-Show side by side */}
                        {job.status === "in_progress" && (
                          <div className="flex items-center gap-2">
                            {!(job as any).poster_completed_at && !(job as any).helper_arrived_at && (() => {
                              const now = new Date();
                              const jobAny = job as any;
                              // 1hr after start time OR 1hr after on_the_way
                              let canNoShow = false;
                              if (jobAny.helper_on_the_way_at) {
                                canNoShow = now.getTime() - new Date(jobAny.helper_on_the_way_at).getTime() >= 60 * 60 * 1000;
                              }
                              if (job.start_time && job.date_needed) {
                                const base = parseLocalDate(job.date_needed);
                                const [h, m] = job.start_time.split(":").map(Number);
                                base.setHours(h, m, 0, 0);
                                const startPlus1h = new Date(base.getTime() + 60 * 60 * 1000);
                                if (now >= startPlus1h) canNoShow = true;
                              }
                              if (!canNoShow) return null;
                              return (
                                <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onNoShow(job.id)}>
                                  <XCircle className="w-4 h-4 mr-1" /> No-Show
                                </Button>
                              );
                            })()}
                            {(job as any).helper_arrived_at && !(job as any).poster_confirmed_arrival_at && (
                              <Button size="sm" className="flex-1" onClick={() => onConfirmArrival(job.id)}>
                                <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Arrival
                              </Button>
                            )}
                          </div>
                        )}
                        {/* Confirm Working */}
                        {job.status === "in_progress" && !(job as any).poster_confirmed_working_at && (job as any).poster_confirmed_arrival_at && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-600">
                              <Wrench className="w-3.5 h-3.5 shrink-0" />
                              <span className="font-medium">Is the helpr working?</span>
                            </div>
                            <Button size="sm" className="w-full" onClick={() => onConfirmWorking(job.id)}>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Confirm Working
                            </Button>
                          </div>
                        )}
                        {/* 72h countdown after helper marks complete */}
                        {(job as any).helper_completed_at && !(job as any).poster_completed_at && !(job as any).revision_requested_at && (
                          <DeadlineCountdown
                            deadline={new Date(new Date((job as any).helper_completed_at).getTime() + 72 * 60 * 60 * 1000).toISOString()}
                            expiredText="72 hours passed — payment auto-released to helpr"
                            consequenceText="Approve & complete or request a revision before the timer expires, or payment will auto-release to the helpr."
                            variant="warning"
                          />
                        )}
                        {/* Approve & Complete */}
                        {(job as any).helper_completed_at && (
                          <Button size="sm" className="w-full" onClick={() => onComplete(job.id)} disabled={completingJobId === job.id || !!(job as any).poster_completed_at}>
                            <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === job.id ? "…" : (job as any).poster_completed_at ? "Approved ✓" : "Approve & Complete"}
                          </Button>
                        )}
                        {/* Request Revision */}
                        {job.status === "in_progress" && !(job as any).poster_completed_at && (job as any).helper_completed_at && (
                          <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onRevision(job.id)}>
                            <AlertTriangle className="w-4 h-4 mr-1" /> Request Revision
                          </Button>
                        )}
                        {/* Message */}
                        <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
                        {/* Dispute available after revision requested */}
                        {(job.status === "revision_requested" || (job as any).revision_requested_at) && (
                          <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onDispute(job)}>
                            <AlertTriangle className="w-4 h-4 mr-1" /> Dispute
                          </Button>
                        )}
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
                            beforeUrls={(job as any).proof_before_urls || []}
                            afterUrls={(job as any).proof_after_urls || []}
                            canUpload={false}
                          />
                          {!hasTipped ? (
                            <Button size="sm" className="w-full bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onTip(job.id, helperName)}>
                              <DollarSign className="w-4 h-4 mr-1" /> Tip {helperName}
                            </Button>
                          ) : (
                            <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Tipped ✓
                            </Button>
                          )}
                          {!hasReviewed ? (
                            <Button size="sm" className="w-full bg-accent/15 text-accent-foreground hover:bg-accent/25 border-0" onClick={() => onReview(job)}>
                              <Star className="w-4 h-4 mr-1" /> Review
                            </Button>
                          ) : (
                            <Button size="sm" className="w-full bg-muted text-muted-foreground border-0 cursor-default" disabled>
                              <CheckCircle2 className="w-4 h-4 mr-1" /> Reviewed ✓
                            </Button>
                          )}
                          <Button size="sm" className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 border-0" onClick={() => navigate(`/post-job?rebook=${job.id}`)}>
                            <RotateCcw className="w-4 h-4 mr-1" /> Rebook
                          </Button>
                          {!(job as any).poster_completed_at && (
                            <>
                              {(job as any).revision_requested_at ? (
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
                          )}
                        </div>
                      );
                    })()}
                    {job.status === "disputed" && (() => {
                      const disputeStatus = (job as any).dispute_status || "open";
                      const isDisputer = (job as any).disputed_by === userId;
                      return (
                      <div className="space-y-2">
                        {(job as any).poster_confirmed_working_at && (
                          <PhotoProofGroup
                            jobId={job.id}
                            beforeUrls={(job as any).proof_before_urls || []}
                            afterUrls={(job as any).proof_after_urls || []}
                            canUploadBefore={false}
                            canUploadAfter={false}
                            requireAfter={true}
                            budget={job.budget}
                          />
                        )}
                        <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                          <p className="text-xs text-destructive font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> 
                            {disputeStatus === "escalated" ? "Escalated to Admin" : disputeStatus === "resolved" ? "Dispute Resolved" : "Dispute Under Review"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Payment is on hold pending resolution.</p>
                          {(job as any).dispute_reason && <p className="text-xs text-muted-foreground mt-1 italic">"{(job as any).dispute_reason}"</p>}
                          {(job as any).dispute_helper_response && (
                            <div className="mt-2 p-2 rounded bg-muted/50">
                              <p className="text-[10px] text-muted-foreground font-medium">Helpr's response:</p>
                              <p className="text-xs text-foreground mt-0.5">"{(job as any).dispute_helper_response}"</p>
                            </div>
                          )}
                          {(job as any).dispute_deadline && disputeStatus !== "resolved" && (
                            <DeadlineCountdown
                              deadline={(job as any).dispute_deadline}
                              expiredText="Deadline passed — payment auto-releasing to helpr"
                              consequenceText="Confirm the issue is fixed or escalate to admin. If no action is taken, payment auto-releases to the helpr."
                              variant="destructive"
                            />
                          )}
                        </div>
                        <div className="p-2 rounded-lg bg-muted/50 border border-border">
                          <p className="text-[10px] text-muted-foreground leading-relaxed">
                            <strong>Policy:</strong> You have 72 hours to confirm the issue is fixed or escalate to admin. If you do nothing, payment auto-releases to the helpr.
                          </p>
                        </div>
                        {/* Disputer actions: Mark Resolved or Escalate */}
                        {isDisputer && disputeStatus === "open" && (
                          <div className="grid grid-cols-2 gap-2">
                            <Button size="sm" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={async (e) => {
                              e.stopPropagation();
                              const { error } = await supabase.from("jobs").update({ status: "completed" as any, dispute_status: "resolved", dispute_resolved_at: new Date().toISOString() } as any).eq("id", job.id);
                              if (error) { toast.error("Failed to resolve"); return; }
                              if (job.helper_id) await createNotification({ user_id: job.helper_id, title: "Dispute resolved ✓", message: `The poster confirmed the issue on "${job.title}" is resolved. Payment will be released.`, type: "payment", link: "/my-jobs?filter=completed" });
                              toast.success("Dispute resolved — payment released to helpr");
                              window.location.reload();
                            }}><CheckCircle2 className="w-4 h-4 mr-1" /> Mark Resolved</Button>
                            <Button size="sm" variant="outline" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5" onClick={async (e) => {
                              e.stopPropagation();
                              const { error } = await supabase.from("jobs").update({ dispute_status: "escalated" } as any).eq("id", job.id);
                              if (error) { toast.error("Failed to escalate"); return; }
                              const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
                              if (adminRoles) { for (const admin of adminRoles) { await createNotification({ user_id: admin.user_id, title: "🚨 Dispute escalated", message: `"${job.title}" dispute has been escalated and requires admin decision.`, type: "warning", link: "/admin" }); } }
                              toast.success("Dispute escalated to admin for final decision");
                              window.location.reload();
                            }}><AlertTriangle className="w-4 h-4 mr-1" /> Escalate to Admin</Button>
                          </div>
                        )}
                        {isDisputer && disputeStatus === "escalated" && (
                          <div className="text-xs text-center text-muted-foreground px-2 py-1.5 rounded bg-muted/50">Admin is reviewing this dispute. You'll be notified of the outcome.</div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message Helpr</Button>
                          <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact Admin</Button>
                        </div>
                      </div>
                      );
                    })()}
                  </div>
                </div>
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
                  <div key={app.id} className="p-4 rounded-xl border border-border bg-card space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <a href={`/user/${app.helper_id}`} className="font-medium text-primary hover:underline">{formatName(app.profiles?.full_name, "Helpr")}</a>
                        {app.profiles?.skills && <p className="text-xs text-muted-foreground mt-0.5">{app.profiles.skills}</p>}
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

                    {/* Applicant message */}
                    {app.message && (
                      <div className="rounded-lg bg-primary/5 border border-primary/15 p-3">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Their Message</p>
                        <p className="text-sm text-foreground leading-relaxed">{app.message}</p>
                      </div>
                    )}

                    {/* Applicant attachments */}
                    {(app.attachment_urls || []).length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Attached Files</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(app.attachment_urls || []).map((url, i) => {
                            const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
                            return (
                              <AttachmentLink
                                key={i}
                                url={url}
                                index={i}
                                variant={isImage ? "thumb" : "chip"}
                              />
                            );
                          })}
                        </div>
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
