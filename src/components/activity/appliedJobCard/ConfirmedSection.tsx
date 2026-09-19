import { useState } from "react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { JobActionChip } from "@/components/activity/JobActionRow";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import { MessageSquare, CalendarX2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { hasJobStarted } from "@/lib/dateUtils";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { DirectionsButton } from "./DirectionsButton";
import { JobPetCareSheet } from "@/components/activity/JobPetCareSheet";
import { HelperTrackerPanel } from "./HelperTrackerPanel";
import type { TrackingData } from "@/components/JobTracking";
import type { AppliedApp, Job } from "../activityConstants";

interface ConfirmedSectionProps {
  app: AppliedApp;
  job: Job;
  userId: string;
  initialTracking?: TrackingData | null;
  navigate: (to: string) => void;
}

/** Confirmed: show tracking + message */
export function ConfirmedSection({ app, job, userId, initialTracking, navigate }: ConfirmedSectionProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // helper_cancel_booking refuses once the scheduled start has passed
  // (job_already_started: now >= date_needed + COALESCE(start_time,'00:00') in
  // America/Chicago). Offering the chip in that window is a dead-end tap routed
  // to "contact support" — the exact ghosting the sanctioned exit exists to
  // prevent. auto-start-due-jobs runs every 15 min, so status stays 'accepted'
  // (this card keeps rendering) for up to 15 min AFTER start; a null-start
  // flexible job is "started" from midnight. Gate the chip on the SAME clock the
  // RPC uses — hasJobStarted → jobLocalStartMs defaults a null start to 00:00,
  // matching the RPC's COALESCE(...,'00:00'). Server guard still stands for
  // direct calls / stale tabs. Past start, the in-progress abort exit is the
  // right affordance, not cancel.
  const startPassed = hasJobStarted(job.date_needed, job.start_time);

  // The sanctioned exit (owner, 2026-08-24): cancelling a committed booking
  // reopens the job and counts a reliability strike on the shared ladder
  // (2 warnings → 7-day suspension → 7-day restriction pending admin review).
  // The dialog states that
  // BEFORE the tap — the consequence is the point, not a surprise.
  const handleCancelBooking = async () => {
    setCancelling(true);
    const { data, error } = await supabase.rpc("helper_cancel_booking", {
      p_job_id: app.job_id,
    });
    setCancelling(false);
    if (error) {
      hapticError();
      toast.error(
        rpcErrorMessage("helper_cancel_booking", error) ?? "We couldn't cancel this job — please try again.",
      );
      return;
    }
    hapticError(); // a strike is not a success moment
    const action = (data as { action?: string } | null)?.action;
    if (action === "pending_ban_review" || action === "permanent_ban") {
      // Fourth strike. As of 20260829010000 this is `pending_ban_review` — a
      // REVERSIBLE 7-day restriction while an admin decides. Mirror the decline
      // path (useOfferHandlers): not a toast — hard-load the banned screen so
      // the restricted session is torn down rather than left live behind
      // /my-jobs. The retired "permanent_ban" string is still handled for the
      // window between this code shipping and the migration reaching prod.
      window.location.assign("/account-banned");
      return;
    }
    toast.warning(
      action === "temp_ban"
        ? "Job cancelled — third strike: your account is suspended for 7 days."
        : action === "warning"
          ? "Job cancelled — final warning. One more strike is a 7-day suspension."
          : "Job cancelled. This counts as a reliability strike.",
    );
    setCancelOpen(false);
    // The job left this list; the realtime jobs subscription refetches, but
    // navigating home is the honest immediate state.
    navigate("/my-jobs");
  };

  /* No "Add to Calendar" (owner, twice — here and on the offer card): "once
     they accept a job it will be on their calendar in the app". Handing the
     helpr an .ics to download and import is asking the user to do the app's
     job, on a job the app already knows the date of.

     Rendered through the shared JobStepCard shell like every live step — this
     section used to hand-draw the identical container, which is how its row
     would have stayed stacked while the others went to one row (owner,
     2026-09-14, VN-21). */
  return (
    <JobStepCard
      side="helper"
      step="confirmed"
      /* ONE box: the step rail AND the day-of confirmation that completes its
         "Confirmed" step. See HelperTrackerPanel — the confirmation used to be
         a second glass card BELOW the tracker with its own green primary, so
         the card offered two full-width green buttons at once and the wrong
         one ("On the Way") was reachable first.

         It still leads the section, which is the ordering the owner set
         ("confirmation needs to go before job starts because that comes
         first") — the confirmation is now simply inside the tracker rather
         than stacked above or below it. Its button ("I'm Still On", then the
         tracker's "I'm On My Way") is the row's primary and portals into it. */
      header={<HelperTrackerPanel app={app} job={job} userId={userId} initialTracking={initialTracking} onCantMakeIt={() => setCancelOpen(true)} />}
      notice={
        <>
          <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
          {/* The pets, and everything the owner already wrote down about them.
              Self-hides when the job has none, so no category gate is needed here.
              See JobPetCareSheet — before it, a sitter arrived knowing the address
              and the time and nothing about the animal. */}
          <JobPetCareSheet jobId={app.job_id} />
        </>
      }
      /* THE PEERS, BESIDE THE PRIMARY ON ONE ROW (owner, 2026-08-30:
         "directions messages and can't make it all need to be buttons in a row
         side by side"; owner, 2026-09-14, VN-21: every button on one row, the
         primary leading). The shell lays them out and drops them to icon-only
         when four buttons do not fit with labels.

         "Cancel Job" is the exit, not a link: it opens the same
          reliability-ladder confirm the underlined link used to. Labelled
          "Cancel Job" (owner, 2026-09-14, VN-18: the back-out shown after the
          Helpr confirms and before On the Way says "Cancel Job") — the same
          words ActiveJobSection's chip and dialog use for that window, so the
          accepted and in-progress cards cannot name one exit two ways. `danger` is
          the tone every sanctioned-exit control in these rows already wears
          (Withdraw, Cancel, Dispute) and it is the only alarm colour on this
          card — the tracker's yellow means "current step" and lives in the
          panel above, so the two never collide. The full sentence survives in
          the accessible name.

          DirectionsButton self-hides on a job with no address; the shell
          counts what actually rendered. */
      actions={[
        <DirectionsButton key="directions" location={job.location} />,
        <JobActionChip
          key="message"
          icon={MessageSquare}
          label="Message"
          ariaLabel="Message the person who posted this job"
          tone="message"
          onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}
        />,
        ...(startPassed
          ? []
          : [
              <JobActionChip
                key="cancel"
                icon={CalendarX2}
                label="Cancel Job"
                ariaLabel="Cancel this job? See what happens if you cancel now"
                tone="danger"
                onClick={() => setCancelOpen(true)}
              />,
            ]),
      ]}
      dialogs={
      <BrandConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel This Job?"
        description={`"${job.title}" reopens for other Helprs right away, and the person who posted it is told now — while there's still time to rebook.`}
        callout={{
          icon: CalendarX2,
          // The shared statement, not a hand-typed one. This callout was the
          // last ladder description in the app still writing its own, and it
          // had drifted: it threatened "a fourth is permanent" when
          // helper_cancel_booking → apply_job_denial_consequence's fourth rung
          // is `pending_ban_review` — a reversible 7-day restriction an admin
          // then decides on (20260829030000: p_permanent_requires_review =>
          // true turns the 'permanent' effect into 'review'). Threatening an
          // automatic permanent ban on the SANCTIONED exit is what pushes a
          // helper to ghost instead, which is the behaviour this exit exists to
          // replace.
          text: `Cancelling a job you committed to counts as a reliability strike — ${RELIABILITY_LADDER_SENTENCE}.`,
        }}
        primaryLabel={cancelling ? "Cancelling…" : "Cancel Job"}
        primaryTone="sienna"
        primaryDisabled={cancelling}
        onPrimary={() => void handleCancelBooking()}
        secondaryLabel="Cancel"
      />
      }
    />
  );
}
