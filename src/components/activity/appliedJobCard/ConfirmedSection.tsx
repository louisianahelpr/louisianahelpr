import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { messageButtonStyle } from "@/components/activity/JobActionRow";
import { MessageSquare, CalendarX2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { JobPetCareSheet } from "@/components/activity/JobPetCareSheet";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking, type TrackingData } from "@/components/JobTracking";
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
  // (2 warnings → 7-day suspension → permanent ban). The dialog states that
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
      {/* Tracking — only active on the day of the job */}
      <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} helperOnTheWayAt={job.helper_on_the_way_at} helperArrivedAt={job.helper_arrived_at} helperCompletedAt={job.helper_completed_at} posterCompletedAt={job.poster_completed_at} />
      {/* Job confirmation for helper */}
      <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={job.helper_dayof_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
      <Button size="sm" variant="outline" style={messageButtonStyle} className="w-full" onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
      {/* Quiet, but present: the alternative to a sanctioned exit is a
          ghost, and a ghost is worse for everyone including the ghoster. */}
      <button
        type="button"
        onClick={() => setCancelOpen(true)}
        className="w-full text-center text-ds-11 font-serif italic underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
      >
        Can't make it? See what happens
      </button>
      <BrandConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel This Booking?"
        description={`"${job.title}" reopens for other Helprs right away, and the poster is told now — while there's still time to rebook.`}
        callout={{
          icon: CalendarX2,
          text: "Cancelling a job you committed to counts as a reliability strike: two strikes is a final warning, a third suspends your account for 7 days, a fourth is permanent.",
        }}
        primaryLabel={cancelling ? "Cancelling…" : "Cancel My Booking"}
        primaryTone="sienna"
        primaryDisabled={cancelling}
        onPrimary={() => void handleCancelBooking()}
        secondaryLabel="Keep the Job"
      />
    </div>
  );
}
