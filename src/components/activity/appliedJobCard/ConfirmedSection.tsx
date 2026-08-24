import { Button } from "@/components/ui/button";
import { messageButtonStyle } from "@/components/activity/JobActionRow";
import {MessageSquare } from "lucide-react";
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
      <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={(job as unknown as { helper_dayof_confirmed_at?: string | null }).helper_dayof_confirmed_at ?? null} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} helperOnTheWayAt={job.helper_on_the_way_at} helperArrivedAt={job.helper_arrived_at} helperCompletedAt={job.helper_completed_at} posterCompletedAt={job.poster_completed_at} />
      {/* Job confirmation for helper */}
      <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} helperDayofConfirmedAt={(job as unknown as { helper_dayof_confirmed_at?: string | null }).helper_dayof_confirmed_at ?? null} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
      <Button size="sm" variant="outline" style={messageButtonStyle} className="w-full" onClick={() => navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
    </div>
  );
}
