import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarX2, CheckCircle2, MapPin, MessageSquare, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { queryKeys } from "@/lib/queryKeys";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { isNativePlatform } from "@/lib/nativeInit";
import { hasJobStarted } from "@/lib/dateUtils";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { arrivalVerdictMessage } from "@/lib/arrivalGate";
import { hasRequiredProof } from "@/lib/photoProofPolicy";
import { RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { useCrewSlot } from "@/hooks/useCrewSlot";
import {
  CrewActionError,
  confirmCrewSpot,
  crewMemberMarkArrival,
  crewMemberMarkDone,
  crewMemberOnTheWay,
  crewMemberStep,
  crewMinutesUntilDone,
  withCrewSlotStamps,
  type CrewMemberStep,
} from "@/lib/crewLifecycle";
import { JobStepCard } from "@/components/job-card/JobStepCard";
import { JobActionChip, JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { JobStepRowSlot } from "@/components/job-card/jobStepRow";
import { JobCountdown } from "@/components/job-card/JobCountdown";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { helperShareCount } from "@/lib/helperEarnings";
import { DirectionsButton } from "./DirectionsButton";
import { HelperPhotoAsk } from "./steps/HelperPhotoAsk";
import { JobStatusStrip } from "@/components/job-card/JobStatusStrip";
import { helperStatusLine, withDisputeSettling } from "@/components/job-card/jobStatusLine";
import type { AppliedApp, Job } from "../../../components/job-card/activityConstants";

/**
 * The collapsed card's one status line for a crew member (Q1382): the shared
 * helperStatusLine, read off the job AS THIS MEMBER LIVES IT (their own roster
 * stamps in place of the job's, which belong to nobody on a crew). Without it
 * the strip kept saying "Confirm you'll be there" after the member confirmed.
 * Shares CrewMemberSection's query key, so it costs no extra request.
 */
export function CrewStatusStrip({
  app,
  job,
  userId,
  unsettledDisputeJobIds,
}: {
  app: AppliedApp;
  job: Job;
  userId: string;
  unsettledDisputeJobIds: Parameters<typeof withDisputeSettling>[1];
}) {
  const slot = useCrewSlot(app.job_id, userId, true);
  return (
    <JobStatusStrip
      line={helperStatusLine({ ...app, job: withDisputeSettling(withCrewSlotStamps(job, slot.data), unsettledDisputeJobIds) })}
    />
  );
}

/**
 * A CREW MEMBER'S LIVE CARD (Q1382).
 *
 * A crew has no lead (Q407): this member's confirm, on-the-way, arrival and
 * Done are stamped on THEIR roster row by the crew RPCs (src/lib/crewLifecycle.ts),
 * so the single-Helpr sections (OfferedActions / ConfirmedSection /
 * ActiveJobSection), which read and write the job's own scalar stamps, can
 * never move a crew job: accept_job_offer refuses `group_job_not_supported`,
 * and the job's stamps belong to nobody. This section replaces them for a
 * crew member while the job is live, on the same JobStepCard shell, one
 * primary at a time, in the same words as the single-Helpr flow where the
 * step is the same.
 *
 * The step is read off the member's own row (`crewMemberStep`), never off the
 * job: the job's status is a crew-wide aggregate.
 */
export function CrewMemberSection({
  app,
  job,
  userId,
  isExpanded,
  navigate,
}: {
  app: AppliedApp;
  job: Job;
  userId: string;
  isExpanded: boolean;
  navigate: (to: string) => void;
}) {
  const queryClient = useQueryClient();
  const { request: requestPermission } = usePermissionRationale();
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Re-render every 30 s so the 30-minute floor's "Available in N min" counts
  // down and the Done button unlocks without a refresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const slotQuery = useCrewSlot(app.job_id, userId, true);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.activity.all });

  /** One fix for set-out and arrival. Null on any failure: both RPCs record
   *  the step without coordinates, and the arrival verdict says so. */
  const readFix = async (): Promise<{ lat: number; lng: number } | null> => {
    if (!isNativePlatform && !navigator.geolocation) return null;
    let fix: { lat: number; lng: number } | null = null;
    await requestPermission("location", async () => {
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ timeout: 15000, maximumAge: 30000 });
          fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch {
          // Silent on purpose: denied or no fix. Both RPCs record the step
          // without coordinates, and the arrival verdict tells the member so.
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            resolve();
          },
          () => resolve(),
          { timeout: 15000, maximumAge: 30000 },
        );
      });
    });
    return fix;
  };

  const run = async (source: string, fallback: string, action: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const message = await action();
      hapticSuccess();
      if (message) toast.success(message);
      await refresh();
    } catch (err) {
      hapticError();
      // A mapped refusal is the rule working: shown, not reported.
      const copy = err instanceof CrewActionError ? err.copy : null;
      if (!copy) {
        report(err instanceof CrewActionError ? err.original ?? err : err, {
          tags: { source: `CrewMemberSection.${source}` },
        });
      }
      toast.error(copy ?? fallback);
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = () =>
    run("confirm", "We couldn't confirm your spot. Please try again.", async () => {
      await confirmCrewSpot(app.job_id);
      return "You're confirmed for this crew.";
    });
  const onSetOut = () =>
    run("onTheWay", "We couldn't mark you on the way. Please try again.", async () => {
      await crewMemberOnTheWay(app.job_id, await readFix());
      return "You're on your way.";
    });
  const onArrive = () =>
    run("arrival", "We couldn't check you in. Please try again.", async () => {
      const verdict = await crewMemberMarkArrival(app.job_id, await readFix());
      return arrivalVerdictMessage(verdict);
    });
  const onDone = () =>
    run("markDone", "We couldn't mark your part done. Please try again.", async () => {
      const res = await crewMemberMarkDone(app.job_id);
      if (res.jobComplete) return "Your part is done, and so is the whole crew's.";
      return res.crewRemaining && res.crewRemaining > 0
        ? `Your part is done. Waiting on ${res.crewRemaining} more crew member${res.crewRemaining === 1 ? "" : "s"}.`
        : "Your part is done.";
    });

  // helper_cancel_booking has a crew branch: it takes only this member off and
  // reopens the spot; a strike only for a member who had confirmed (Q706).
  const onCancel = async () => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("helper_cancel_booking", { p_job_id: app.job_id });
    setBusy(false);
    if (error) {
      hapticError();
      const copy = rpcErrorMessage("helper_cancel_booking", error);
      if (!copy) report(error, { tags: { source: "CrewMemberSection.cancel" } });
      toast.error(copy ?? "We couldn't take you off this job. Please try again.");
      return;
    }
    setCancelOpen(false);
    const action = (data as { action?: string } | null)?.action;
    if (action === "pending_ban_review" || action === "permanent_ban") {
      window.location.assign("/account-banned");
      return;
    }
    hapticError(); // leaving a crew is not a success moment
    toast.warning(
      action === "temp_ban"
        ? "You're off this crew. Third strike: your account is suspended for 7 days."
        : action === "warning"
          ? "You're off this crew. Final warning: one more strike is a 7-day suspension."
          : action && action !== "none"
            ? "You're off this crew. This counts as a reliability strike."
            : "You're off this crew.",
    );
    await refresh();
    navigate("/jobs");
  };

  const slot = slotQuery.data;
  if (slotQuery.isError) {
    return isExpanded ? (
      <div className="px-4 py-3 border-t border-border/30">
        <p className="text-ds-13 text-muted-foreground text-center">
          We couldn't load your spot on this crew. Pull to refresh.
        </p>
        <ReportErrorScreen source="CrewMemberSection.slot" title="We couldn't load your spot on this crew." />
      </div>
    ) : null;
  }
  if (!slotQuery.isSuccess) return null;
  if (!slot) {
    return isExpanded ? (
      <div className="px-4 py-3 border-t border-border/30">
        <p className="text-ds-13 text-muted-foreground text-center">You're no longer on this job's crew.</p>
      </div>
    ) : null;
  }

  const step: CrewMemberStep = crewMemberStep(slot, job.status);
  // Confirming is a decision with a deadline, like an offer: it stays on the
  // collapsed card (OfferedActions does the same). Everything else is behind
  // the expand, as on every Jobs card.
  if (!isExpanded && step !== "confirm") return null;

  const startPassed = hasJobStarted(job.date_needed, job.start_time);
  const proofOk = hasRequiredProof(
    job as { require_photo_proof?: boolean | null },
    slot.proof_before_urls,
    slot.proof_after_urls,
  );
  const minutesLeft = crewMinutesUntilDone(slot);
  // The canonical group gate (helperShareCount), floored at 2: a crew is never one.
  const crewSize = Math.max(2, helperShareCount(job));

  // The same window helper_cancel_booking's crew branch admits: the job still
  // 'open' or 'accepted' (not once anyone has set out), before the start, and
  // this member's part not done.
  const canCancel =
    !startPassed &&
    (job.status === "open" || job.status === "accepted") &&
    (step === "confirm" || step === "waiting_for_crew" || step === "set_out");

  const messageChip = (
    <JobActionChip
      key="message"
      icon={MessageSquare}
      label="Message"
      ariaLabel="Message the person who posted this job"
      tone="message"
      onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}
    />
  );
  const cancelChip = canCancel ? (
    <JobActionChip
      key="cancel"
      icon={CalendarX2}
      label={step === "confirm" ? "Can't Make It" : "Cancel Job"}
      ariaLabel="Leave this crew? See what happens if you leave now"
      tone="danger"
      onClick={() => setCancelOpen(true)}
    />
  ) : null;

  const primary =
    step === "confirm" ? (
      <JobStepPrimaryButton icon={CheckCircle2} label={busy ? "…" : "Confirm My Spot"} onClick={onConfirm} disabled={busy} />
    ) : step === "set_out" ? (
      <JobStepPrimaryButton icon={Truck} label={busy ? "…" : "I'm On My Way"} onClick={onSetOut} disabled={busy} />
    ) : step === "arrive" ? (
      <JobStepPrimaryButton icon={MapPin} label={busy ? "…" : "I've Arrived"} onClick={onArrive} disabled={busy} />
    ) : step === "finish" && proofOk ? (
      <JobStepPrimaryButton
        icon={CheckCircle2}
        label={busy ? "…" : minutesLeft > 0 ? `Available in ${minutesLeft} min` : "Mark My Part Done"}
        onClick={onDone}
        disabled={busy || minutesLeft > 0}
      />
    ) : step === "done" ? (
      <JobStepPrimaryButton icon={CheckCircle2} label="Part Done" onClick={() => {}} disabled tone="done" />
    ) : null;

  const STATUS: Record<CrewMemberStep, string> = {
    confirm: "Confirm you'll be there so the person who posted this job knows their crew is set.",
    waiting_for_crew: "You're confirmed. You can head out once every spot on the crew is filled.",
    set_out: "You're confirmed. Tap I'm On My Way when you head out.",
    arrive: "You're on your way. Tap I've Arrived when you get there.",
    awaiting_poster:
      'You\'re checked in. The person who posted this job now taps "Confirm They Arrived" for you, then you can finish your part.',
    finish: proofOk
      ? "You're working. Mark your part done when you finish."
      : "You're working. Add before and after photos of your part, then mark it done.",
    done: job.helper_completed_at
      ? "Every part is done. The person who posted this job approves it next."
      : "Your part is done. The job is finished once every crew member marks theirs.",
  };

  const actions = [
    step !== "finish" && step !== "done" && step !== "awaiting_poster" ? (
      <DirectionsButton key="directions" location={job.location} />
    ) : null,
    messageChip,
    cancelChip,
    step === "awaiting_poster" || step === "finish" ? (
      <HelperPhotoAsk key="photo" jobId={app.job_id} job={job} step={step === "finish" ? "working" : "on_site"} />
    ) : null,
  ];

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <JobStepCard
        side="helper"
        step={`crew_${step}`}
        header={
          <div className="space-y-1">
            <h3
              className="font-display italic font-bold leading-tight text-headline-card"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Your part of a crew of {crewSize}
            </h3>
            <p className="text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.85)" }} data-crew-step={step}>
              {STATUS[step]}
            </p>
          </div>
        }
        notice={
          step === "set_out" || step === "waiting_for_crew" || step === "confirm" ? (
            <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
          ) : step === "finish" && proofOk && minutesLeft > 0 ? (
            <JobStepRowSlot slot="note">
              <p className="font-sans text-center text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Available in {minutesLeft} min — 30 minutes after arrival, to ensure quality.
              </p>
            </JobStepRowSlot>
          ) : null
        }
        primary={primary}
        soloChipKey="message"
        actions={actions}
        dialogs={
          <BrandConfirmDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title={step === "confirm" ? "Turn Down This Spot?" : "Leave This Crew?"}
            description={`Your spot on "${job.title}" reopens for other Helprs right away, and the person who posted it is told now.`}
            callout={
              step === "confirm"
                ? undefined
                : {
                    icon: CalendarX2,
                    text: `Leaving a crew you confirmed within 24 hours of the start counts as a reliability strike — ${RELIABILITY_LADDER_SENTENCE}.`,
                  }
            }
            primaryLabel={busy ? "Leaving…" : step === "confirm" ? "Turn Down" : "Leave Crew"}
            primaryTone="sienna"
            primaryDisabled={busy}
            onPrimary={() => void onCancel()}
            secondaryLabel="Cancel"
          />
        }
      />
    </div>
  );
}
