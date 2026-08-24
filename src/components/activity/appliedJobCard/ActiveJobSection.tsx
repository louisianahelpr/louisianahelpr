import { useState } from "react";
import { messageButtonStyle } from "@/components/activity/JobActionRow";
import { Button } from "@/components/ui/button";
import { AUTO_COMPLETE_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";
import { CheckCircle2, MessageSquare, RefreshCw, Check, ClipboardList } from "lucide-react";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking, type TrackingData } from "@/components/JobTracking";
import { HelperRevisionCard } from "@/components/activity/HelperRevisionCard";
import type { AppliedApp, Job } from "../activityConstants";

interface ActiveJobSectionProps {
  app: AppliedApp;
  job: Job & { revision_note?: string | null };
  status: string;
  userId: string;
  initialTracking?: TrackingData | null;
  completingJobId: string | null;
  onComplete: (jobId: string) => void;
  onResolveRevision: (jobId: string) => void;
  navigate: (to: string) => void;
  setShowReportCard: (show: boolean) => void;
}

/** In Progress / Revision */
export function ActiveJobSection({
  app,
  job,
  status,
  userId,
  initialTracking,
  completingJobId,
  onComplete,
  onResolveRevision,
  navigate,
  setShowReportCard,
}: ActiveJobSectionProps) {
  const [resolving, setResolving] = useState(false);

  const handleMarkFixed = async () => {
    setResolving(true);
    try {
      await onResolveRevision(app.job_id);
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
      {/* Live tracking for in-progress jobs */}
      <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={(job as unknown as { helper_dayof_confirmed_at?: string | null }).helper_dayof_confirmed_at ?? null} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} helperOnTheWayAt={job.helper_on_the_way_at} helperArrivedAt={job.helper_arrived_at} helperCompletedAt={job.helper_completed_at} posterCompletedAt={job.poster_completed_at} />

      {/* Pet care report card — only for pet_care jobs */}
      {job.category === "pet_care" && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => setShowReportCard(true)}
        >
          <ClipboardList className="w-4 h-4 mr-1.5" />
          Send Report Card
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
            <p className="text-ds-10 text-muted-foreground/70 pt-1">If the poster doesn't respond within {AUTO_COMPLETE_HOURS} hours, payment will automatically be released to you.</p>
          </div>
          {job.helper_completed_at && (
            <div className="px-3 pb-2.5">
              <DeadlineCountdown
                deadline={new Date(new Date(job.helper_completed_at).getTime() + hoursToMs(AUTO_COMPLETE_HOURS)).toISOString()}
                expiredText={`${AUTO_COMPLETE_HOURS} hours passed — payment auto-releasing to you`}
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
      <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={(job as unknown as { helper_dayof_confirmed_at?: string | null }).helper_dayof_confirmed_at ?? null} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
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
              <div
                className="text-ds-11 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded font-medium w-full"
                style={{ background: "hsl(var(--success-tint))", color: "hsl(var(--success-ink))" }}
              ><Check className="w-3 h-3 shrink-0" strokeWidth={3} /> Marked as fixed — waiting for poster</div>
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
            <Button size="sm" variant="outline" className="w-full" disabled={resolving} onClick={handleMarkFixed}><RefreshCw className={`w-4 h-4 mr-1${resolving ? " animate-spin" : ""}`} /> {resolving ? "Marking…" : "Mark Fixed"}</Button>
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
        {/* Renders from ARRIVAL, not from the poster's working confirmation
            (owner, 2026-08-24): a poster who never confirms working must not
            be able to block the payout request — they keep the 24h review
            window instead. The 30-min floor measures from their confirmation
            when it exists, else from the helper's own arrival stamp. */}
        {!job.helper_completed_at && job.helper_arrived_at && (() => {
          const beforePhotos = job.proof_before_urls || [];
          const afterPhotos = job.proof_after_urls || [];
          const hasPhotos = beforePhotos.length > 0 && afterPhotos.length > 0;
          const workingStart = job.poster_confirmed_working_at
            ? new Date(job.poster_confirmed_working_at)
            : job.helper_arrived_at
              ? new Date(job.helper_arrived_at)
              : null;
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
                        boxShadow: "var(--elev-bark-raised)",
                      }
                    : undefined
                }
              >
                <CheckCircle2 className="w-4 h-4 mr-1" />
                {label === "Mark Complete" ? "I'm Done — Request Payout" : label}
              </Button>
              {tooEarly && (
                <p className="font-serif italic text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Available 30 minutes after arrival to ensure quality.
                </p>
              )}
            </>
          );
        })()}
        <Button size="sm" variant="outline" style={messageButtonStyle} className="w-full" onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
      </div>
    </div>
  );
}
