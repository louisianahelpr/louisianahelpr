import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  MapPin, DollarSign, CheckCircle2, RotateCcw,
  Star, MessageSquare, Users, AlertTriangle, RefreshCw,
  Rocket, Clock, ChevronDown, Calendar, Timer, ThumbsUp, ThumbsDown,
  Navigation as NavigationIcon,
} from "lucide-react";
import { formatDistanceToNow, differenceInHours } from "date-fns";
import { PhotoProof } from "@/components/PhotoProof";
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
      {apps.map((app) => (
        <div key={app.id} className="rounded-2xl border border-border/60 bg-card overflow-hidden cursor-pointer shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 transition-all" onClick={() => setExpandedJobId(expandedJobId === app.id ? null : app.id)}>
          {/* Top bar */}
          <div className="w-full px-4 py-2 border-b border-border/40 bg-muted/15 flex items-center justify-between text-left">
            <h3 className={`font-bold text-[15px] leading-snug min-w-0 truncate ${(categoryColors[app.job?.category || "other"] || categoryColors.other).title}`}>
              {app.job?.title || "Task"}
            </h3>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {app.job && (() => {
                const fee = app.job.platform_fee_amount ?? (app.job.budget * (app.job.platform_fee_percent ?? 15) / 100);
                const payout = app.job.budget - fee;
                return (
                  <span className="flex items-center gap-0.5 font-bold text-primary text-sm" title={`Budget: $${app.job.budget} · Fee: $${fee.toFixed(2)}`}>
                    <DollarSign className="w-3.5 h-3.5" />{payout.toFixed(2)}
                  </span>
                );
              })()}
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expandedJobId === app.id ? "rotate-180" : ""}`} />
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
                {app.job.expires_at && (() => {
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
              <div className="flex gap-2">
                <PhotoProof jobId={app.job_id} type="before" existingUrls={(app.job as any)?.proof_before_urls || []} onUploaded={() => {}} />
                <PhotoProof jobId={app.job_id} type="after" existingUrls={(app.job as any)?.proof_after_urls || []} onUploaded={() => {}} />
              </div>
              {app.job && app.job.budget >= 50 && !((app.job as any)?.proof_after_urls?.length > 0) && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> After-photos required for jobs $50+ before marking complete
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" className="w-full" onClick={() => onComplete(app.job_id)} disabled={completingJobId === app.job_id || !!(app.job as any)?.helper_completed_at}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />{completingJobId === app.job_id ? "…" : (app.job as any)?.helper_completed_at ? "Confirmed ✓" : "Mark Complete"}
                </Button>
                <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
              </div>
              {app.job?.status === "revision_requested" && (
                <Button size="sm" variant="outline" className="w-full" onClick={() => onResolveRevision(app.job_id)}><RefreshCw className="w-4 h-4 mr-1" /> Mark Fixed</Button>
              )}
            </div>
          )}

          {/* Disputed */}
          {app.status === "accepted" && app.job?.status === "disputed" && (
            <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs font-semibold text-red-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Dispute In Progress</p>
                {(app.job as any)?.dispute_reason && (
                  <p className="text-xs text-muted-foreground mt-1">Reason: {(app.job as any).dispute_reason}</p>
                )}
                {(app.job as any)?.disputed_at && (
                  <p className="text-[10px] text-muted-foreground mt-1">Filed {formatDistanceToNow(new Date((app.job as any).disputed_at), { addSuffix: true })}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="w-full" onClick={() => navigate(`/messages?jobId=${app.job_id}&userId=${app.job?.customer_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message Poster</Button>
                <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact Admin</Button>
              </div>
            </div>
          )}

          {/* Completed */}
          {app.status === "accepted" && app.job?.status === "completed" && (
            <div className="px-4 pb-3 space-y-2" onClick={(e) => e.stopPropagation()}>
              <PhotoProof jobId={app.job_id} type="before" existingUrls={(app.job as any)?.proof_before_urls || []} onUploaded={() => {}} />
              <PhotoProof jobId={app.job_id} type="after" existingUrls={(app.job as any)?.proof_after_urls || []} onUploaded={() => {}} />
              {helperReviewedJobIds.has(app.job_id) ? (
                <Button size="sm" variant="outline" className="w-full" disabled><Star className="w-4 h-4 mr-1" /> Reviewed ✓</Button>
              ) : (
                <Button size="sm" variant="outline" className="w-full" onClick={() => onHelperReview(app.job_id, app.job!.customer_id, app.posterName || "Poster")}>
                  <Star className="w-4 h-4 mr-1" /> Review Poster
                </Button>
              )}
            </div>
          )}

          {/* Expandable details */}
          <div className={`overflow-hidden transition-all duration-200 ease-in-out ${expandedJobId === app.id ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pb-4 space-y-3 border-t border-border/40">
              {app.job && app.job.description.trim().toLowerCase() !== (app.job.title || "").trim().toLowerCase() && (
                <div className="pt-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Description</p>
                  <p className="text-sm text-foreground leading-relaxed">{app.job.description}</p>
                </div>
              )}
              {app.job && (app.job.photos || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Photos</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {(app.job.photos || []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <img src={url} alt={`Photo ${i + 1}`} className="w-28 h-20 rounded-lg object-cover border border-border hover:border-primary transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {app.job?.estimated_hours && (
                <div className="rounded-lg bg-secondary/30 p-2.5">
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Est. Hours</p>
                  <p className="font-semibold text-foreground text-sm">{app.job.estimated_hours}h</p>
                </div>
              )}
              {app.job?.special_requirements && (
                <div className="rounded-lg bg-secondary/30 p-2.5">
                  <p className="text-[10px] text-muted-foreground mb-1">Special Requirements</p>
                  <p className="text-sm text-foreground">{app.job.special_requirements}</p>
                </div>
              )}
              {app.job?.is_recurring && (
                <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Recurring Task</p>
                    <p className="text-sm font-medium text-foreground">
                      {app.job.recurrence_interval ? `Every ${app.job.recurrence_interval}` : "Yes"}
                      {app.job.recurrence_end_date && ` until ${new Date(app.job.recurrence_end_date).toLocaleDateString()}`}
                    </p>
                  </div>
                </div>
              )}
              {app.job?.is_group_job && (
                <div className="rounded-lg bg-secondary/30 p-2.5 flex items-start gap-2">
                  <Users className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Group Task</p>
                    <p className="text-sm font-medium text-foreground">{app.job.helpers_needed ? `${app.job.helpers_needed} helprs needed` : "Multiple helprs needed"}</p>
                  </div>
                </div>
              )}
              {app.job && (
                <div className="pt-2 text-xs text-muted-foreground">
                  <span>Posted by <a href={`/user/${app.job.customer_id}`} className="font-medium text-primary hover:underline">{app.posterName}</a></span>
                </div>
              )}
              {app.message && <p className="text-sm text-muted-foreground">{app.message}</p>}
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
                  <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} />
                  <JobCheckins jobId={app.job_id} userId={userId} isHelper={true} isOwner={false} jobStatus={app.job?.status || ""} jobLatitude={(app.job as any)?.latitude} jobLongitude={(app.job as any)?.longitude} />
                </div>
              )}
              {/* Revision notice */}
              {app.job?.status === "revision_requested" && (app.job as any)?.revision_note && (
                <div className="p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                  <p className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Revision requested</p>
                  <p className="text-xs text-muted-foreground mt-1">{(app.job as any).revision_note}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
