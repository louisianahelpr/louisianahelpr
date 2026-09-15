import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { supabase } from "@/integrations/supabase/client";
import { JobActionChip } from "@/components/activity/JobActionRow";
import { MessageSquare, CalendarX2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { hapticError, hapticLight } from "@/lib/haptics";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { Textarea } from "@/components/ui/textarea";
import { RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import { hasRequiredProof } from "@/lib/photoProofPolicy";
import { report } from "@/lib/errorLogger";
import { deriveCurrentStatusIdx, STATUS_IDX, type TrackingData } from "@/components/JobTracking";
import { HelperTrackerPanel } from "./HelperTrackerPanel";
import { deriveHelperStep, type HelperStepProps } from "./steps/stepContract";
import { EnRouteStep } from "./steps/EnRouteStep";
import { OnSiteStep } from "./steps/OnSiteStep";
import { WorkingStep } from "./steps/WorkingStep";
import { SubmittedStep } from "./steps/SubmittedStep";
import { RevisionStep } from "./steps/RevisionStep";
import type { AppliedApp, Job } from "../activityConstants";

/** The floor a job has to sit above before its payout can be requested. Same
 *  30 minutes JobTracking's Done gate and completeJob's re-check enforce. */
const MIN_WORK_MS = 30 * 60 * 1000;

interface ActiveJobSectionProps {
  app: AppliedApp;
  job: Job & { revision_note?: string | null };
  status: string;
  userId: string;
  initialTracking?: TrackingData | null;
  completingJobId: string | null;
  onComplete: (jobId: string) => void;
  onResolveRevision: (jobId: string) => void;
  /** Opens the existing helper-side DisputeDialog (ActivityDialogs' `disputeJob`
   *  state). Optional so a caller that has no dispute wiring simply gets no
   *  Report a Problem link rather than a dead control. */
  onOpenDispute?: () => void;
  navigate: (to: string) => void;
}

/**
 * The helper's live job card — CONTAINER ONLY.
 *
 * Owner, 2026-09-11: "there should not be so many different variations, each
 * step should be its own component." This file used to be 640 lines in which
 * every state was a conditional against every other, which is how the card
 * ended up with six layouts: three different action-row widths, an ask from the
 * wrong step rendering beside a payout request, and an escape that was a chip
 * in some states and an underlined link in others.
 *
 * What lives here now is only what OUTLIVES a step — the abort dialog and its
 * RPC, the payout-unlock timer, the poster's instant-release flag, and the
 * derivation of which step we are on. The shared controls (tracker, Message,
 * the Cancel Job chip, the Report a Problem chip) are built ONCE here and handed down, so a
 * step cannot restyle them. Everything visible is a step component rendering
 * through the shared {@link JobStepCard} shell.
 */
export function ActiveJobSection({
  app,
  job,
  status,
  userId,
  initialTracking,
  completingJobId,
  onComplete,
  onResolveRevision,
  onOpenDispute,
  navigate,
}: ActiveJobSectionProps) {
  const [resolving, setResolving] = useState(false);
  /** Reported up by HelperRevisionCard from the `job_revisions` row it reads.
   *  "Mark Fixed" may not exist before it is true — owner, 2026-09-11. */
  const [revisionAccepted, setRevisionAccepted] = useState(false);

  // ── THE 30-MINUTE WINDOW HAS TO ELAPSE ON SCREEN ──
  //
  // "Available in 25 min" was computed from Date.now() at render time on a
  // component with no timer of any kind, so a helper who opened /my-jobs at
  // minute 5 watched a frozen number on a disabled button until they navigated
  // away and came back. The unlock moment is a fixed point in time, so compute
  // it once and re-render on it — and only while the gate is actually closed.
  const payoutUnlocksAt = (() => {
    // The floor measures from the poster's working confirmation when it
    // exists, else from the helper's own arrival stamp — a ghosting poster
    // must not be able to hold the clock at zero.
    const workingStart = job.poster_confirmed_working_at ?? job.helper_arrived_at;
    return workingStart ? new Date(workingStart).getTime() + MIN_WORK_MS : null;
  })();
  const [now, setNow] = useState(() => Date.now());
  const payoutGateClosed =
    !job.helper_completed_at &&
    !!job.helper_arrived_at &&
    payoutUnlocksAt != null &&
    now < payoutUnlocksAt;
  useEffect(() => {
    if (!payoutGateClosed) return;
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [payoutGateClosed]);

  // ── The sanctioned exit, and the point at which it stops being offered ──
  //
  // Owner, 2026-08-30: "can't finish should not be an option." Taken literally
  // that strands the state machine, so the exit is not deleted, it is BOUNDED.
  // Owner, 2026-09-14 (VN-18) narrowed the bound and renamed it "Cancel Job":
  //
  //   accepted / confirmed (before "I'm On My Way") → Cancel Job is offered
  //   on the way / arrived / working / after        → no back-out at all
  //
  // `deriveCurrentStatusIdx` is the same derivation the step rail is drawn
  // from, so the chip and the rail can never disagree about where the job is.
  // It is also what picks the step component below — one derivation, not two.
  const trackerIdx =
    deriveCurrentStatusIdx({
      trackingStatus: initialTracking?.status ?? null,
      jobStatus: job.status,
      helperConfirmedAt: job.helper_confirmed_at,
      helperDayofConfirmedAt: job.helper_dayof_confirmed_at,
      jobDateNeeded: job.date_needed,
      posterConfirmedAt: job.poster_confirmed_at,
      helperOnTheWayAt: job.helper_on_the_way_at,
      helperArrivedAt: job.helper_arrived_at,
      helperArrivalVerifiedAt: job.helper_arrival_verified_at,
      posterConfirmedArrivalAt: job.poster_confirmed_arrival_at,
      helperArrivalNearMissAt: (job as { helper_arrival_near_miss_at?: string | null }).helper_arrival_near_miss_at,
      helperCompletedAt: job.helper_completed_at,
      posterCompletedAt: job.poster_completed_at,
    });
  const workUnderway = trackerIdx >= STATUS_IDX.working;
  const hasArrived = trackerIdx >= STATUS_IDX.arrived;
  const onTheWay = trackerIdx >= STATUS_IDX.on_the_way;
  const hasConfirmed = trackerIdx >= STATUS_IDX.confirmed;

  // Server owns every part of this decision (helper_abort_job, migration
  // 20260825190000): which settlement path the job takes, and what the strike
  // costs. The client only states it truthfully before the tap.
  const queryClient = useQueryClient();
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
      const fallback = "We couldn’t send that — check your connection and try again.";
      const code = rpcErrorCode("helper_abort_job", error);
      const copy = rpcErrorMessage("helper_abort_job", error) ?? fallback;
      if (code === "job_already_completed" || code === "job_not_found" || code === "not_authorized") {
        // The job moved on under this card (marked complete a moment ago,
        // removed, or no longer this person's). Retrying can only fail again,
        // so close the dialog and re-read the job instead of offering one.
        setAbortOpen(false);
        toast.error(copy);
        void queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });
        return;
      }
      if (code === "dispute_needs_description") {
        toast.error(copy);
        return; // dialog stays open with the reason, so it can be expanded
      }
      toast.error(copy, { action: { label: "Retry", onClick: () => void handleAbort() } });
      return; // dialog stays open, reason preserved, primary re-enabled
    }
    hapticError(); // a strike is never a success moment
    const result = data as { action?: string; outcome?: string } | null;
    if (result?.action === "pending_ban_review" || result?.action === "permanent_ban") {
      // Fourth strike — as of 20260829010000 a REVERSIBLE 7-day restriction
      // pending admin review, not an automatic permanent ban. Mirror the
      // decline / cancel-booking paths: hard-load so the restricted session is
      // torn down rather than left live behind the list.
      window.location.assign("/account-banned");
      return;
    }
    const outcome = result?.outcome === "disputed" ? "disputed" : "reopened";
    setAborted(outcome);
    setAbortOpen(false);
    toast.warning(
      result?.action === "temp_ban"
        ? "We told the person who posted this job — third strike: your account is suspended for 7 days."
        : result?.action === "warning"
          ? "We told the person who posted this job — final warning. One more strike is a 7-day suspension."
          : outcome === "disputed"
            ? "We told the person who posted this job. Our team will review what you’re owed."
            : "We told the person who posted this job, and the job is open again. This counts as a reliability strike.",
    );
  };

  // Does THIS poster release instantly? Read once the banner could show;
  // false on any error — the 24h countdown is the safe default, instant is
  // only ever a nicer message.
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

  // ── The controls every step shares, built exactly once ──
  const showExit = !aborted && hasConfirmed && !onTheWay;
  // Report a Problem: from On the Way onward — exactly where Cancel Job is gone
  // — so removing that control never removes the PATH. Never on a job already
  // in dispute (no double-file) and never once the job is done (owner,
  // 2026-09-14, VN-28: no report once done).
  const disputedAt = (job as { disputed_at?: string | null }).disputed_at ?? null;
  const showReport =
    !aborted &&
    onTheWay &&
    !!onOpenDispute &&
    !disputedAt &&
    job.status !== "disputed" &&
    job.status !== "completed" &&
    !job.poster_completed_at;

  const shared: HelperStepProps = {
    app,
    job,
    userId,
    initialTracking,
    // The SAME merged panel the scheduled card uses, so the tracker is one box
    // on both cards rather than two different ones.
    tracker: <HelperTrackerPanel app={app} job={job} userId={userId} initialTracking={initialTracking} />,
    messageChip: (
      <JobActionChip
        key="message"
        icon={MessageSquare}
        label="Message"
        ariaLabel="Message the person who posted this job"
        tone="message"
        onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}
      />
    ),
    exitChip: showExit ? (
      <JobActionChip
        key="exit"
        icon={CalendarX2}
        label="Cancel Job"
        ariaLabel="Cancel this job? See what happens if you cancel now"
        tone="danger"
        onClick={() => setAbortOpen(true)}
      />
    ) : null,
    // ── REPORT A PROBLEM, BESIDE MESSAGE ──
    // Owner, 2026-09-11: "report a problem add it only where necessary." It
    // appears at exactly the complement of the Cancel Job chip — removing a
    // CONTROL must not remove the PATH. Owner, 2026-09-14 (VN-19) reversed the
    // earlier "quiet link below the row" ruling: it is a danger-tone chip IN
    // the action row, beside Message. Same destination (the dispute dialog).
    reportChip: showReport ? (
      <JobActionChip
        key="report"
        icon={AlertTriangle}
        label="Report a Problem"
        ariaLabel="Report a problem — open a dispute about this job"
        tone="danger"
        onClick={() => {
          hapticLight();
          onOpenDispute?.();
        }}
      />
    ) : null,
    abortedNotice: aborted ? (
      <p className="font-sans text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        {aborted === "disputed"
          ? "You’ve cancelled this job and told the person who posted this job. Our team is reviewing what you’re owed — the payment is held safely until then."
          : "You’ve cancelled this job and told the person who posted this job. The job is open to other Helprs again."}
      </p>
    ) : null,
  };

  const payout = {
    // ONE shared proof rule (photoProofPolicy) — the same predicate
    // JobTracking's Done step and completeJob's re-check enforce.
    hasPhotos:
      !job.helper_completed_at &&
      !!job.helper_arrived_at &&
      hasRequiredProof(job, job.proof_before_urls, job.proof_after_urls),
    busy: completingJobId === app.job_id,
    // `now`, not `Date.now()` — the state the minute timer drives, which is
    // what makes the button re-enable itself while the helper is looking at it.
    tooEarly: payoutUnlocksAt != null && now < payoutUnlocksAt,
    minutesLeft: payoutUnlocksAt != null ? Math.ceil((payoutUnlocksAt - now) / 60000) : 0,
    onComplete: () => onComplete(app.job_id),
  };

  const step = deriveHelperStep({
    status,
    helperCompletedAt: job.helper_completed_at,
    workUnderway,
    hasArrived,
  });

  const body = (() => {
    switch (step) {
      case "revision":
        return (
          <RevisionStep
            {...shared}
            revisionAccepted={revisionAccepted}
            onRevisionAcceptedChange={setRevisionAccepted}
            resolving={resolving}
            onMarkFixed={handleMarkFixed}
          />
        );
      case "submitted":
        return <SubmittedStep {...shared} posterInstantRelease={posterInstantRelease} />;
      case "working":
        return <WorkingStep {...shared} payout={payout} />;
      case "on_site":
        return <OnSiteStep {...shared} payout={payout} />;
      default:
        return <EnRouteStep {...shared} />;
    }
  })();

  return (
    <>
      {body}
      <BrandConfirmDialog
        open={abortOpen}
        onOpenChange={(next) => { if (!aborting) setAbortOpen(next); }}
        title="Cancel This Job?"
        description=""
        callout={{
          icon: CalendarX2,
          text: `Cancelling a job you committed to counts as a reliability strike — ${RELIABILITY_LADDER_SENTENCE}. Telling us costs exactly the same as going quiet, and going quiet costs the person who posted it their whole day.`,
        }}
        primaryLabel={aborting ? "Sending…" : "Cancel Job"}
        primaryTone="sienna"
        primaryHaptic="warning"
        primaryDisabled={aborting || abortReason.trim().length < 5}
        onPrimary={(e) => { e.preventDefault(); void handleAbort(); }}
        secondaryLabel="Cancel"
      >
        <div className="space-y-2.5">
          {/* The money outcome, stated plainly, before the tap. */}
          <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood))" }}>
            {abortWorkStarted
              ? "You’ve already started, so we won’t decide who’s owed what on our own. Their payment is held safely and our team reviews it — you may still be paid for the part you did."
              : "You never started, so the person who posted it is charged nothing. The job reopens for other Helprs right away and their payment stays protected."}
          </p>
          <label htmlFor={`abort-reason-${app.job_id}`} className="block text-ds-11 font-medium text-foreground">
            What happened? The person who posted this job sees this.
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
    </>
  );
}
