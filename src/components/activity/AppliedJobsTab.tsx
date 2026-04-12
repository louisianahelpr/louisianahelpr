import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createNotification } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MapPin, DollarSign, CheckCircle2, RotateCcw,
  Star, MessageSquare, Users, AlertTriangle, RefreshCw,
  Rocket, Clock, ChevronDown, Calendar, Timer, ThumbsUp, ThumbsDown,
  Navigation as NavigationIcon, Send,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { PhotoProof, PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking } from "@/components/JobTracking";
import { JobCheckins } from "@/components/JobCheckins";
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

  if (apps.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">No applications match this filter.</p>
        <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {apps.map((app) => {
        const isNonExpandable = app.status === "rejected" || app.job?.status === "completed";
        return (
        <div key={app.id} className={`rounded-2xl border border-border/60 bg-card overflow-hidden ${isNonExpandable ? "" : "cursor-pointer"} shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 transition-all`} onClick={() => !isNonExpandable && setExpandedJobId(expandedJobId === app.id ? null : app.id)}>
          {/* Top bar */}
          <div className="w-full px-4 py-2 border-b border-border/40 bg-muted/15 flex items-center justify-between text-left">
            <h3 className={`font-bold text-[15px] leading-snug min-w-0 truncate ${(categoryColors[app.job?.category || "other"] || categoryColors.other).title}`}>
              {app.job?.title || "Task"}
            </h3>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {app.job && (() => {
                const helpers = app.job.is_group_job && app.job.helpers_needed ? app.job.helpers_needed : 1;
                const perHelper = app.job.budget / helpers;
                const commissionPercent = (app.job as any).helper_fee_percent ?? 10;
                const commission = (perHelper * commissionPercent) / 100;
                const payout = perHelper - commission + (app.job.urgent_fee ?? 0);
                return (
                  <span className="flex items-center gap-0.5 font-bold text-primary text-sm" title={`Budget: $${app.job.budget} · Platform Fee: ${commissionPercent}%`}>
                    <DollarSign className="w-3.5 h-3.5" />{payout.toFixed(2)}
                  </span>
                );
              })()}
              {!isNonExpandable && <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedJobId === app.id ? "rotate-180" : ""}`} />}
            </div>
          </div>

          {/* Summary */}
          {app.job && (
            <div className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 shrink-0" />
                  {new Date(app.job.date_needed).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {!app.job.start_time ? " · Flexible time" : ` · ${new Date(`2000-01-01T${app.job.start_time}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                </span>
                {(() => {
                  const locationParts = app.job!.location.split(",").map(s => s.trim());
                  let cityState = app.job!.location;
                  if (locationParts.length >= 2) {
                    const state = locationParts[locationParts.length - 1].replace(/\d{5}(-\d{4})?/, "").trim();
                    const city = locationParts[locationParts.length - 2];
                    cityState = `${city}, ${state}`;
                  }
                  return (
                    <a onClick={(e) => e.stopPropagation()} href={app.job!.latitude && app.job!.longitude ? `https://www.google.com/maps?q=${app.job!.latitude},${app.job!.longitude}` : `https://www.google.com/maps/search/${encodeURIComponent(app.job!.location)}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-primary transition-colors">
                      <MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-[140px]">{cityState}</span>
                    </a>
                  );
                })()}
                {app.job.expires_at && !app.job.helper_id && (() => {
                  const expiryText = new Date(app.job!.expires_at!) <= new Date() ? "Expired" : formatDistanceToNow(new Date(app.job!.expires_at!), { addSuffix: false }) + " left";
                  const isExpiringSoon = differenceInHours(new Date(app.job!.expires_at!), new Date()) < 24;
                  return (<span className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive font-medium" : ""}`}><Timer className="w-3 h-3 shrink-0" /> {expiryText}</span>);
                })()}
              </div>
              {app.posterName && (
                <div className="text-xs text-muted-foreground">
                  Posted by <a href={`/user/${app.job.customer_id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">{app.posterName}</a>
                </div>
              )}
            </div>
          )}

          {/* Offered: accept/decline */}
          {app.status === "accepted" && app.job?.status === "accepted" && !(app.job as any)?.helper_confirmed_at && (
            <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              {(app.job as any)?.response_deadline && (
                <div className="text-xs text-muted-foreground text-center px-2 py-1 rounded bg-muted/50">
                  <Clock className="w-3 h-3 inline mr-1" />
                  Respond by {new Date((app.job as any).response_deadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => onHelperResponse(app, true)}><ThumbsUp className="w-4 h-4 mr-1" /> Accept Job</Button>
                <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onHelperResponse(app, false)}><ThumbsDown className="w-4 h-4 mr-1" /> Decline</Button>
              </div>
            </div>
          )}

          {/* Accepted: On My Way / Arrived */}
          {app.status === "accepted" && app.job?.status === "accepted" && !!(app.job as any)?.helper_confirmed_at && (
            <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="text-xs text-center px-2 py-1.5 rounded bg-primary/10 text-primary font-medium">✓ You accepted this job</div>
              {(app.job as any)?.helper_on_the_way_at && (
                <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary">
                  <NavigationIcon className="w-3.5 h-3.5 shrink-0" /><span className="font-medium">On the way</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{new Date((app.job as any).helper_on_the_way_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              {(app.job as any)?.helper_arrived_at && (
                <div className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600">
                  <MapPin className="w-3.5 h-3.5 shrink-0" /><span className="font-medium">Arrived</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{new Date((app.job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              {!(app.job as any)?.helper_on_the_way_at && (
                <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => onMarkOnTheWay(app.job_id)} disabled={onTheWayLoading === app.job_id}>
                  <NavigationIcon className="w-4 h-4 mr-1" /> {onTheWayLoading === app.job_id ? "Updating…" : "On My Way"}
                </Button>
              )}
              {(app.job as any)?.helper_on_the_way_at && !(app.job as any)?.helper_arrived_at && (
                <Button size="sm" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => onMarkArrived(app.job_id)} disabled={arrivedLoading === app.job_id}>
                  <MapPin className="w-4 h-4 mr-1" /> {arrivedLoading === app.job_id ? "Updating…" : "I've Arrived"}
                </Button>
              )}
              <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
            </div>
          )}

          {/* Visible live tracking */}
          {app.status === "accepted" && (app.job?.status === "accepted" || app.job?.status === "in_progress") && (
            <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
              <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} />
            </div>
          )}

          {/* Visible live tracking */}
          {app.status === "accepted" && (app.job?.status === "accepted" || app.job?.status === "in_progress") && (
            <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
              <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} />
            </div>
          )}

          {/* In Progress / Revision */}
          {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "revision_requested") && (
            <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              {(app.job as any)?.helper_on_the_way_at && (
                <div className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground">
                  <NavigationIcon className="w-3 h-3 shrink-0" /><span>On the way</span>
                  <span className="ml-auto text-[10px]">{new Date((app.job as any).helper_on_the_way_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              {(app.job as any)?.helper_arrived_at && (
                <div className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-muted/50 text-muted-foreground">
                  <MapPin className="w-3 h-3 shrink-0" /><span>Arrived</span>
                  <span className="ml-auto text-[10px]">{new Date((app.job as any).helper_arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
              {!startRequestedJobIds.has(app.job_id) && (
                <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => onStartJob(app.job_id)} disabled={startJobLoading === app.job_id}>
                  <Rocket className="w-4 h-4 mr-1" /> {startJobLoading === app.job_id ? "Starting…" : "Start Job"}
                </Button>
              )}
              {startRequestedJobIds.has(app.job_id) && (
                <div className="text-xs text-center px-2 py-1.5 rounded bg-primary/10 text-primary font-medium">🚀 Job started</div>
              )}
              <JobCheckins jobId={app.job_id} userId={userId} isHelper={true} isOwner={false} jobStatus={app.job?.status || ""} jobLatitude={(app.job as any)?.latitude} jobLongitude={(app.job as any)?.longitude} />
              {/* Photo proof during active job */}
              <PhotoProofGroup
                jobId={app.job_id}
                beforeUrls={(app.job as any)?.proof_before_urls || []}
                afterUrls={(app.job as any)?.proof_after_urls || []}
                canUpload={true}
                requireAfter={true}
                budget={app.job?.budget || 0}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" className="w-full" onClick={() => onComplete(app.job_id)} disabled={completingJobId === app.job_id || !!(app.job as any)?.helper_completed_at}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === app.job_id ? "…" : (app.job as any)?.helper_completed_at ? "Confirmed ✓" : "Mark Complete"}
                </Button>
                <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
              </div>
              {app.job?.status === "revision_requested" && (
                <div className="space-y-2">
                  {(app.job as any)?.revision_note && (
                    <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                      <p className="text-xs text-muted-foreground mt-1">{(app.job as any).revision_note}</p>
                    </div>
                  )}
                  {(app.job as any)?.revision_deadline && !(app.job as any)?.revision_completed_at && (
                    <DeadlineCountdown
                      deadline={(app.job as any).revision_deadline}
                      expiredText="Revision deadline passed — poster can dispute or complete"
                      consequenceText="Fix the revision before the deadline. If not completed, the poster can file a dispute."
                      variant="warning"
                    />
                  )}
                  {(app.job as any)?.revision_completed_at ? (
                    <div className="space-y-2">
                      <div className="text-xs text-center px-2 py-1.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">✓ You marked this as fixed — waiting for poster to accept</div>
                      {(app.job as any)?.revision_acceptance_deadline && (
                        <DeadlineCountdown
                          deadline={(app.job as any).revision_acceptance_deadline}
                          expiredText="Poster didn't respond — payment auto-releasing to you"
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
            </div>
          )}
...
              {/* Completion status */}
              {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "revision_requested") && ((app.job as any)?.poster_completed_at || (app.job as any)?.helper_completed_at) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {(app.job as any)?.helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ You confirmed</span>}
                  {(app.job as any)?.poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">✓ Poster confirmed</span>}
                  {!(app.job as any)?.helper_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for you</span>}
                  {!(app.job as any)?.poster_completed_at && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">Waiting for poster</span>}
                </div>
              )}
              {/* Features for helper */}
              {app.status === "accepted" && (app.job?.status === "in_progress" || app.job?.status === "accepted") && (
                <div className="space-y-3">
                  <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={(app.job as any)?.poster_confirmed_at} helperConfirmedAt={(app.job as any)?.helper_confirmed_at} dateNeeded={app.job?.date_needed || ""} jobStatus={app.job?.status} />
                  <JobCheckins jobId={app.job_id} userId={userId} isHelper={true} isOwner={false} jobStatus={app.job?.status || ""} jobLatitude={(app.job as any)?.latitude} jobLongitude={(app.job as any)?.longitude} />
                </div>
              )}
              {/* Revision notice */}
              {app.job?.status === "revision_requested" && (app.job as any)?.revision_note && (
                <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                  <p className="text-xs text-muted-foreground mt-1">{(app.job as any).revision_note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
};
