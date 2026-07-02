import { Button } from "@/components/ui/button";
import { MessageSquare, CalendarPlus } from "lucide-react";
import { downloadIcs } from "@/lib/icalExport";
import { JobCountdown } from "@/components/activity/JobCountdown";
import { JobConfirmation } from "@/components/JobConfirmation";
import { JobTracking, type TrackingData } from "@/components/JobTracking";
import { WhatToBringChecklist } from "@/components/jobs/WhatToBringChecklist";
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
      {job.date_needed && (
        <button
          type="button"
          aria-label="Add to calendar"
          className="inline-flex items-center gap-1 text-ds-11 font-medium mt-1"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          onClick={() =>
            downloadIcs({
              id: job.id,
              title: job.title,
              location: job.location ?? null,
              description: job.description ?? null,
              dateNeeded: job.date_needed!,
              startTime: job.start_time ?? null,
              estimatedHours: typeof job.estimated_hours === "number" ? job.estimated_hours : null,
            })
          }
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          Add to Calendar
        </button>
      )}
      {/* Tracking — only active on the day of the job */}
      <JobTracking jobId={app.job_id} helperId={userId} isHelper={true} isOwner={false} jobDateNeeded={job.date_needed} jobStartTime={job.start_time} jobStatus={job.status} helperConfirmedAt={job.helper_confirmed_at} posterConfirmedAt={job.poster_confirmed_at} initialTracking={initialTracking} jobLatitude={job.latitude} jobLongitude={job.longitude} />
      {/* Job confirmation for helper */}
      <JobConfirmation jobId={app.job_id} isOwner={false} isHelper={true} posterConfirmedAt={job.poster_confirmed_at} helperConfirmedAt={job.helper_confirmed_at} dateNeeded={job.date_needed} jobStatus={job.status} helperOnTheWayAt={job.helper_on_the_way_at} />
      {/* Category-aware "what to bring" checklist — quiet pre-job
          packing prompt. Collapsed by default, ticks persist per
          job id. No-op when the category has no curated list. */}
      <WhatToBringChecklist jobId={app.job_id} category={job.category} />

      <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/messages")}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
    </div>
  );
}
