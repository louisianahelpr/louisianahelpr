import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { messageButtonStyle } from "@/components/activity/JobActionRow";
import { Button } from "@/components/ui/button";
import { AUTO_COMPLETE_HOURS, hoursToMs } from "../../../../supabase/functions/_shared/escrowTiming";
import { CheckCircle2, MessageSquare, RefreshCw, Check, ClipboardList, CalendarX2 } from "lucide-react";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import { PhotoProofGroup } from "@/components/PhotoProof";
import { hasRequiredProof } from "@/lib/photoProofPolicy";
import { report } from "@/lib/errorLogger";
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

  // ── The sanctioned exit for a job already underway ──
  // Server owns every part of this decision (helper_abort_job, migration
  // 20260825190000): which settlement path the job takes, and what the strike
  // costs. The client only states it truthfully before the tap.
  const [abortOpen, setAbortOpen] = useState(false);
  const [abortReason, setAbortReason] = useState("");
  const [aborting, setAborting] = useState(false);
  const [aborted, setAborted] = useState<"reopened" | "disputed" | null>(null);

  // Same predicate the RPC uses to pick its branch, so the money sentence in
  // the dialog is the one that will actually happen. If these ever drift the
  // SERVER wins — this is copy, not control flow.
  const abortWorkStarted =
    !!job.helper_arrived_at ||
    !!job.helper_completed_at ||
    (job.proof_before_urls?.length ?? 0) > 0 ||
    (job.proof_after_urls?.length ?? 0) > 0;

  const handleAbort = async () => {
    if (aborting) return; // double-fire guard: the dialog stays open on tap
    setAborting(true);
    const { data, error } = await supabase.rpc("helper_abort_job", {
      p_job_id: app.job_id,
      p_reason: abortReason.trim(),
    });
    setAborting(false);
    if (error) {
      hapticError();
      report(error, { tags: { source: "ActiveJobSection.helperAbortJob" } });
      toast.error(
        /not_abortable/.test(error.message)
          ? "This job has already moved on — pull to refresh and take another look."
          : "We couldn’t send that — check your connection and try again.",
        { action: { label: "Retry", onClick: () => void handleAbort() } },
      );
      return; // dialog stays open, reason preserved, primary re-enabled
    }
    hapticError(); // a strike is never a success moment
    const result = data as { action?: string; outcome?: string } | null;
    if (result?.action === "permanent_ban") {
      // Fourth strike. Mirror the decline / cancel-booking paths: hard-load so
      // the banned session is torn down rather than left live behind the list.
      window.location.assign("/account-banned");
      return;
    }
    const outcome = result?.outcome === "disputed" ? "disputed" : "reopened";
    setAborted(outcome);
    setAbortOpen(false);
    toast.warning(
      result?.action === "temp_ban"
        ? "We told the poster — third strike: your account is suspended for 7 days."
        : result?.action === "warning"
          ? "We told the poster — final warning. One more strike is a 7-day suspension."
          : outcome === "disputed"
            ? "We told the poster. Our team will review what you’re owed."
            : "We told the poster, and the job is open again. This counts as a reliability strike.",
    );
  };

  // Does THIS poster release instantly? Read once the banner could show;
  // false on any error — the 24h countdown is the safe default, instant is
  // only ever a nicer message. Column lands with migration 20260824238000;
  // a missing column just resolves to false.
  const { data: posterInstantRelease = false } = useQuery({
    queryKey: ["poster-instant-release", job.customer_id],
    enabled: !!job.helper_completed_at && !job.poster_completed_at && !!job.customer_id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("auto_release_on_complete")
        .eq("user_id", job.customer_id as string)
        .maybeSingle();
      // False stays the safe default (the 24h countdown renders), but the
      // failure must be observable — dropping it made a broken read look
      // exactly like "this poster doesn't auto-release".
      if (error) report(error, { severity: "warning", tags: { source: "ActiveJobSection.posterInstantRelease" } });
      return !!data?.auto_release_on_complete;
    },
  });

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
      <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} helperOnTheWayAt={job.helper_on_the_way_at} helperArrivedAt={job.helper_arrived_at} helperCompletedAt={job.helper_completed_at} posterCompletedAt={job.poster_completed_at} />

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
            <p className="text-ds-10 text-muted-foreground/70 pt-1">
              {posterInstantRelease
                ? "This poster releases payment instantly — it's on its way."
                : `If the poster doesn't respond within ${AUTO_COMPLETE_HOURS} hours, payment will automatically be released to you.`}
            </p>
          </div>
          {/* No countdown when the poster releases instantly (owner,
              2026-08-24): a 24h timer that ends within minutes is a lie. */}
          {job.helper_completed_at && !posterInstantRelease && (
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
      <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
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

      {/* Photo proof — anchored on the helper's own ARRIVAL, the same stamp
          that unlocks the payout button below. Gating this on the poster's
          working confirmation hid the uploader behind a stamp a ghosting
          poster never sets, while the payout button kept demanding the
          photos the helper had no way to add. */}
      {job.helper_arrived_at && (
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
          // ONE shared proof rule (photoProofPolicy) — the same predicate
          // JobTracking's Done step and completeJob's re-check enforce.
          const hasPhotos = hasRequiredProof(job, job.proof_before_urls, job.proof_after_urls);
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
        {/* The sanctioned exit for a job already underway. This REPLACES the
            stopgap line that used to sit here ("once a job starts it can only
            be completed or disputed") — true when it was written, and the
            defect: ghosting was the only remaining move AND the cheapest one,
            because it recorded no strike while every honest exit did. */}
        {aborted ? (
          <p className="font-serif italic text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {aborted === "disputed"
              ? "You’ve told the poster you can’t finish. Our team is reviewing what you’re owed — the payment stays in escrow until then."
              : "You’ve told the poster you can’t finish. The job is open to other Helprs again."}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setAbortOpen(true)}
            className="w-full text-center text-ds-11 font-serif italic underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            Can’t finish this job? See what happens
          </button>
        )}
        <BrandConfirmDialog
          open={abortOpen}
          onOpenChange={(next) => { if (!aborting) setAbortOpen(next); }}
          title="Can’t Finish This Job?"
          description=""
          callout={{
            icon: CalendarX2,
            text: `Stopping a job you committed to counts as a reliability strike — ${RELIABILITY_LADDER_SENTENCE}. Telling us costs exactly the same as going quiet, and going quiet costs the poster their whole day.`,
          }}
          primaryLabel={aborting ? "Sending…" : "I Can’t Finish"}
          primaryTone="sienna"
          primaryHaptic="warning"
          primaryDisabled={aborting || abortReason.trim().length < 5}
          onPrimary={(e) => { e.preventDefault(); void handleAbort(); }}
          secondaryLabel="Keep Working"
        >
          <div className="space-y-2.5">
            {/* The money outcome, stated plainly, before the tap. */}
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood))" }}>
              {abortWorkStarted
                ? "You’ve already started, so we won’t decide who’s owed what on our own. The poster’s payment stays in escrow and our team reviews it — you may still be paid for the part you did."
                : "You never started, so the poster is charged nothing. The job reopens for other Helprs right away and their payment stays protected in escrow."}
            </p>
            <label htmlFor={`abort-reason-${app.job_id}`} className="block text-ds-11 font-medium text-foreground">
              What happened? The poster sees this.
            </label>
            <Textarea
              id={`abort-reason-${app.job_id}`}
              value={abortReason}
              onChange={(e) => setAbortReason(e.target.value)}
              maxLength={1000}
              rows={3}
              disabled={aborting}
              placeholder="My van broke down and I can’t get back out there today."
            />
          </div>
        </BrandConfirmDialog>
      </div>
    </div>
  );
}
