import { useState } from "react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { JobActionRow, JobActionChip } from "@/components/activity/JobActionRow";
import { RELIABILITY_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import { MessageSquare, CalendarX2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
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
      const msg = /already_started/.test(error.message)
        ? "The start time has passed — message the poster or contact support instead."
        : "We couldn't cancel the booking — please try again.";
      toast.error(msg);
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
        ? "Booking cancelled — third strike: your account is suspended for 7 days."
        : action === "warning"
          ? "Booking cancelled — final warning. One more strike is a 7-day suspension."
          : "Booking cancelled. This counts as a reliability strike.",
    );
    setCancelOpen(false);
    // The job left this list; the realtime jobs subscription refetches, but
    // navigating home is the honest immediate state.
    navigate("/my-jobs");
  };

  return (
    <div className="px-4 py-3 border-t border-[hsl(var(--olivewood)/0.1)] bg-card space-y-2.5" onClick={(e) => e.stopPropagation()}>
      {/* ONE box: the step rail AND the day-of confirmation that completes its
          "Confirmed" step. See HelperTrackerPanel — the confirmation used to be
          a second glass card BELOW the tracker with its own green primary, so
          the card offered two full-width green buttons at once and the wrong
          one ("On the Way") was reachable first.

          It still leads the section, which is the ordering the owner set
          ("confirmation needs to go before job starts because that comes
          first") — the confirmation is now simply inside the tracker rather
          than stacked above or below it. */}
      <HelperTrackerPanel app={app} job={job} userId={userId} initialTracking={initialTracking} onCantMakeIt={() => setCancelOpen(true)} />
      {/* Job countdown */}
      <JobCountdown dateNeeded={job.date_needed} startTime={job.start_time} label="Job starts in" />
      {/* The pets, and everything the owner already wrote down about them.
          Self-hides when the job has none, so no category gate is needed here.
          See JobPetCareSheet — before it, a sitter arrived knowing the address
          and the time and nothing about the animal. */}
      <JobPetCareSheet jobId={app.job_id} />
      {/* No "Add to Calendar" (owner, twice — here and on the offer card):
          "once they accept a job it will be on their calendar in the app".
          Handing the helpr an .ics to download and import is asking the user
          to do the app's job, on a job the app already knows the date of. */}
      {/* THREE PEERS, ONE ROW (owner, 2026-08-30: "directions messages and
          can't make it all need to be buttons in a row side by side").

          These were three different treatments stacked vertically — two
          full-width outline buttons and a bare centred text link — for three
          things a booked helpr does from this card. The shared JobActionRow /
          JobActionChip pair is the app's existing 3-up, so this row is the same
          component the posted card's chip rows render through rather than a
          parallel primitive.

          "Can't make it" is the exit, not a link: it opens the same
          reliability-ladder confirm the underlined link used to. `danger` is
          the tone every sanctioned-exit control in these rows already wears
          (Withdraw, Cancel, Dispute) and it is the only alarm colour on this
          card — the tracker's yellow means "current step" and lives in the
          panel above, so the two never collide. The full sentence survives in
          the accessible name; the visible label has ~92px at 320px.

          `columns` is passed deliberately: DirectionsButton self-hides on a job
          with no address, and two chips stranded in a three-column grid is what
          JobActionRow's explicit `columns` prop exists to prevent. */}
      <JobActionRow columns={job.location?.trim() ? 3 : 2}>
        <DirectionsButton location={job.location} variant="chip" />
        <JobActionChip
          icon={MessageSquare}
          label="Message"
          ariaLabel="Message the poster about this job"
          tone="message"
          onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}
        />
        <JobActionChip
          icon={CalendarX2}
          label="Can't Make It"
          ariaLabel="Can't make it? See what happens if you cancel this booking"
          tone="danger"
          onClick={() => setCancelOpen(true)}
        />
      </JobActionRow>
      <BrandConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel This Booking?"
        description={`"${job.title}" reopens for other Helprs right away, and the poster is told now — while there's still time to rebook.`}
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
        primaryLabel={cancelling ? "Cancelling…" : "Cancel My Booking"}
        primaryTone="sienna"
        primaryDisabled={cancelling}
        onPrimary={() => void handleCancelBooking()}
        secondaryLabel="Cancel"
      />
    </div>
  );
}
